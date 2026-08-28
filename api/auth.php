<?php
// POST {login, password} → {token, role}. Замена клиентского doLogin():
// проверка пароля теперь ТОЛЬКО на сервере (bcrypt), паролей в state больше нет.
require_once __DIR__ . '/storage.php';
apiHeaders('POST');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit;
}

$data     = jsonBody();
$login    = trim((string)($data['login'] ?? ''));
$password = trim((string)($data['password'] ?? ''));

if ($login === '' || $password === '') {
    http_response_code(400); echo json_encode(['error' => 'Введите логин и пароль']); exit;
}

// Лимит считает только НЕУДАЧНЫЕ попытки: 10 промахов / 15 минут с одного IP.
// Успешные входы лимит не расходуют — иначе смена за одним NAT-IP (весь цех
// через общий выход в интернет) заблокировала бы сама себя при обычном входе.
if (failedAttempts('login', clientIp(), 900) >= 10) {
    http_response_code(429);
    echo json_encode(['error' => 'Слишком много неудачных попыток входа, попробуйте позже']);
    exit;
}

// Второй, независимый лимит — по логину (03_SECURITY фикс 1, 28.08.2026): лимит
// по IP выше не тормозит подбор пароля к ОДНОЙ учётке с разных адресов. Тот же
// принцип двойного лимита, что у портала varka.kz (IP и email — раздельные
// бакеты) и уже применён в Baze (там наоборот, IP добавляли к учётному). Значения
// те же, что у уже действующего IP-лимита — отдельная причина, не отдельная цифра.
$loginKey = mb_strtolower($login);
if (failedAttempts('login_account', $loginKey, 900) >= 10) {
    http_response_code(429);
    echo json_encode(['error' => 'Слишком много неудачных попыток входа, попробуйте позже']);
    exit;
}

$q = pdo()->prepare("SELECT * FROM roles WHERE login = ? AND status = 'active'");
$q->execute([$login]);
$role = $q->fetch();

// Фиктивный bcrypt того же cost, что и боевые хэши (PASSWORD_BCRYPT без явного
// cost — по умолчанию 10): password_verify() выполняется БЕЗУСЛОВНО, даже когда
// роли нет. Раньше `||` замыкался на !$role и bcrypt не считался вовсе — время
// ответа отличало существующий логин от несуществующего (03_SECURITY фикс 3,
// 28.08.2026, по образцу Tracker/Baze).
const DUMMY_PASSWORD_HASH = '$2y$10$q1/pKBjiuqoC6Wy4fJJR1eVQl8IdplLykgd/9azkEQCApwiJGz10K';
$hashToCheck = ($role && $role['password_hash'] !== '') ? $role['password_hash'] : DUMMY_PASSWORD_HASH;
$passwordOk = password_verify($password, $hashToCheck);

if (!$role || $role['password_hash'] === '' || !$passwordOk) {
    logLoginAttempt($login, false);
    recordFailure('login', clientIp());
    recordFailure('login_account', $loginKey);
    http_response_code(401);
    echo json_encode(['error' => 'Неверный логин или пароль']);
    exit;
}

logLoginAttempt($login, true);
$token = createSession($role);

$tabs = json_decode($role['tabs'] ?? '[]', true) ?: [];
echo json_encode(['token' => $token, 'role' => [
    'id'         => $role['id'],
    'name'       => $role['name'],
    'login'      => $role['login'],
    'fullAccess' => (bool)$role['is_admin'], // историческое поле клиента
    'tabs'       => $tabs,
    'fields'     => json_decode($role['fields'] ?? '{}', true) ?: (object)[],
]], JSON_UNESCAPED_UNICODE);
