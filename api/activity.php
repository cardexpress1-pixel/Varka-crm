<?php
// Журнал действий (бывшая коллекция Firestore activityLog).
// GET → последние 200 записей (новые первыми), ТОЛЬКО админ (как eventlog в Tracker).
// POST {…запись…} → {ok}. Автора (кто/какая роль) проставляет СЕРВЕР из сессии,
// клиентские userId/userName/role игнорируются — иначе журнал можно подделать.
require_once __DIR__ . '/storage.php';
apiHeaders('GET, POST');

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    requireAuth(true); // журнал аудита виден только админ-панели
    $rows = pdo()->query('SELECT entry FROM activity_log ORDER BY id DESC LIMIT 200')->fetchAll();
    echo '[' . implode(',', array_column($rows, 'entry')) . ']';
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit;
}

$session = requireAuth();

// Rate limit: 100 запросов/мин на сессию — тот же принцип и механизм, что
// MFG-007 (api/state.php), см. комментарий там. Реализовано 2026-08-25 (ТЗ MFG-008).
if (failedAttempts('activity-write', $session['token_hash'], 60) >= 100) {
    http_response_code(429);
    echo json_encode(['error' => 'Слишком много запросов, попробуйте позже'], JSON_UNESCAPED_UNICODE);
    exit;
}
recordFailure('activity-write', $session['token_hash']);

$in = jsonBody();
if (!$in) { http_response_code(400); echo json_encode(['error' => 'entry required']); exit; }

// Доверенные поля — из сессии; из клиента берём только описание действия.
$q = pdo()->prepare('SELECT name FROM roles WHERE id = ?');
$q->execute([$session['role_id']]);
$roleName = ($q->fetch()['name'] ?? $session['login']);

$entry = [
    'userId'    => $session['role_id'],
    'userName'  => $session['login'],
    'role'      => (int)$session['is_admin'] ? 'admin' : 'user',
    'roleName'  => $roleName,
    'action'    => substr((string)($in['action'] ?? ''), 0, 300),
    'target'    => substr((string)($in['target'] ?? ''), 0, 300),
    'details'   => $in['details'] ?? new stdClass(),
    'before'    => $in['before'] ?? null,
    'after'     => $in['after']  ?? null,
    'tsMs'      => (int)round(microtime(true) * 1000),
    'createdAt' => date('c'),
];
$json = json_encode($entry, JSON_UNESCAPED_UNICODE);
if ($json === false || strlen($json) > 65000) {
    http_response_code(400); echo json_encode(['error' => 'Некорректная запись журнала']); exit;
}
pdo()->prepare('INSERT INTO activity_log (entry) VALUES (?)')->execute([$json]);
echo json_encode(['ok' => true]);
