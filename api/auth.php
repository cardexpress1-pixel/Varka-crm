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

// 10 попыток / 15 минут с одного IP (тот же лимит, что у Tracker).
if (!checkRateLimit('login', clientIp(), 10, 900)) {
    http_response_code(429);
    echo json_encode(['error' => 'Слишком много попыток входа, попробуйте позже']);
    exit;
}

$q = pdo()->prepare("SELECT * FROM roles WHERE login = ? AND status = 'active'");
$q->execute([$login]);
$role = $q->fetch();

if (!$role || !password_verify($password, $role['password_hash'])) {
    logLoginAttempt($login, false);
    http_response_code(401);
    echo json_encode(['error' => 'Неверный логин или пароль']);
    exit;
}

logLoginAttempt($login, true);
$token = createSession($role);

echo json_encode(['token' => $token, 'role' => [
    'id'         => $role['id'],
    'name'       => $role['name'],
    'login'      => $role['login'],
    'fullAccess' => (bool)$role['full_access'],
    'tabs'       => json_decode($role['tabs'] ?? '[]', true) ?: [],
    'fields'     => json_decode($role['fields'] ?? '{}', true) ?: (object)[],
]], JSON_UNESCAPED_UNICODE);
