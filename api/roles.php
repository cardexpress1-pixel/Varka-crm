<?php
// GET → {roles:[{id,name}]}. Список ролей-должностей для админки ПОРТАЛА:
// в модалке сотрудника (varka.kz, «Пользователи и права») админ выбирает,
// какую роль Производства получит сотрудник при SSO-входе (решение владельца
// 2026-07-23: должность — информационное поле, роль назначается явно).
// Только админ (местный или портальный admin через SSO-цепочку requireAuth →
// verifyPortalToken). Пароли/вкладки не отдаются — только id и имя.
require_once __DIR__ . '/storage.php';
apiHeaders('GET');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit;
}

requireAuth(true);

$rows = pdo()->query('SELECT id, name FROM roles ORDER BY name')->fetchAll();
echo json_encode(['roles' => $rows], JSON_UNESCAPED_UNICODE);
