<?php
// POST {role_id} → {password}. Сбрасывает пароль ОДНОЙ роли на новый случайный,
// хэширует bcrypt и сохраняет только хэш. Пароль в открытом виде возвращается
// администратору РОВНО ОДИН РАЗ в этом ответе — нигде не логируется и не хранится
// (security-фикс 2026-08-27: раньше дефолтные пароли лежали открытым текстом
// в index.html, см. TRACEABILITY_Manufacture.md §4). Только админ.
require_once __DIR__ . '/storage.php';
apiHeaders('POST');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit;
}

requireAuth(true); // только админ

$data   = jsonBody();
$roleId = substr((string)($data['role_id'] ?? ''), 0, 64);
if ($roleId === '') {
    http_response_code(400); echo json_encode(['error' => 'Не указана роль']); exit;
}

$db  = pdo();
$chk = $db->prepare('SELECT id FROM roles WHERE id = ?');
$chk->execute([$roleId]);
if (!$chk->fetch()) {
    http_response_code(404); echo json_encode(['error' => 'Роль не найдена']); exit;
}

// 9 байт = 18 hex-символов, ~72 бита энтропии — читаемо для передачи сотруднику голосом/чатом.
$password = bin2hex(random_bytes(9));
$db->prepare('UPDATE roles SET password_hash = ? WHERE id = ?')
   ->execute([password_hash($password, PASSWORD_BCRYPT), $roleId]);

echo json_encode(['password' => $password], JSON_UNESCAPED_UNICODE);
