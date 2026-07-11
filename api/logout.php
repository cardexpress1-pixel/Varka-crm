<?php
// POST → удаляет токен на сервере (реальная инвалидация, как в Tracker после аудита).
require_once __DIR__ . '/storage.php';
apiHeaders('POST');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit;
}
$token = bearerToken();
if ($token !== '' && strlen($token) <= 64) {
    pdo()->prepare('DELETE FROM sessions WHERE token = ?')->execute([$token]);
}
echo json_encode(['ok' => true]);
