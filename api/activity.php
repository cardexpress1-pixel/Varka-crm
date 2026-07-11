<?php
// Журнал действий (бывшая коллекция Firestore activityLog).
// GET → последние 200 записей (новые первыми), POST {…запись…} → {ok}.
require_once __DIR__ . '/storage.php';
apiHeaders('GET, POST');

requireAuth();
$db = pdo();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $rows = $db->query('SELECT entry FROM activity_log ORDER BY id DESC LIMIT 200')->fetchAll();
    echo '[' . implode(',', array_column($rows, 'entry')) . ']';
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit;
}

$entry = jsonBody();
if (!$entry) { http_response_code(400); echo json_encode(['error' => 'entry required']); exit; }
$json = json_encode($entry, JSON_UNESCAPED_UNICODE);
if ($json === false || strlen($json) > 65000) {
    http_response_code(400); echo json_encode(['error' => 'Некорректная запись журнала']); exit;
}
$db->prepare('INSERT INTO activity_log (entry) VALUES (?)')->execute([$json]);
echo json_encode(['ok' => true]);
