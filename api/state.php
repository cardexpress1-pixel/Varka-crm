<?php
// Состояние приложения (бывший документ Firestore varka/state).
// GET [?rev=N] → {rev, data} | {rev, unchanged:true} если N == текущему rev.
// POST {baseRev, data} → {rev} | 409 {rev, data} при конфликте версий.
require_once __DIR__ . '/storage.php';
apiHeaders('GET, POST');

$session = requireAuth();
$db = pdo();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $row = $db->query('SELECT data, rev FROM app_state WHERE id = 1')->fetch();
    if (!$row) { echo '{"rev":0,"data":null}'; exit; }
    // Условный GET: фоновый опрос присылает свой rev; если он совпал — не гоняем
    // ~650КБ состояния впустую, отвечаем крошечным ответом (экономия трафика/CPU
    // шаред-хостинга при опросе с каждого устройства раз в 15с).
    $clientRev = isset($_GET['rev']) ? (int)$_GET['rev'] : -1;
    if ($clientRev === (int)$row['rev']) {
        echo '{"rev":' . (int)$row['rev'] . ',"unchanged":true}';
        exit;
    }
    // data — уже готовая JSON-строка, вклеиваем без повторного кодирования.
    echo '{"rev":' . (int)$row['rev'] . ',"data":' . $row['data'] . '}';
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit;
}

$body = jsonBody();
if (!isset($body['data']) || !is_array($body['data'])) {
    http_response_code(400); echo json_encode(['error' => 'data required']); exit;
}
$baseRev = (int)($body['baseRev'] ?? -1);
$state   = $body['data'];

// Тот же принцип оптимистичной блокировки, что был у _rev в Firestore:
// сохранение поверх чужой более новой версии отклоняется, клиент забирает
// актуальную и повторяет мердж.
$db->beginTransaction();
try {
    // Берём data сразу вместе с rev под локом — при 409 свежая версия уже на
    // руках, второй SELECT не нужен.
    $row = $db->query('SELECT data, rev FROM app_state WHERE id = 1 FOR UPDATE')->fetch();
    $currentRev = $row ? (int)$row['rev'] : 0;

    if ($row && $baseRev !== $currentRev) {
        $db->rollBack();
        http_response_code(409);
        echo '{"error":"conflict","rev":' . (int)$row['rev'] . ',"data":' . $row['data'] . '}';
        exit;
    }

    // Роли может менять только админ. Для обычного пользователя подменяем
    // присланные roles авторитетной копией из БД — иначе любой залогиненный
    // POST'ом переписал бы права/пароли (эскалация до админа).
    if ((int)$session['is_admin']) {
        syncRolesFromState($state); // хеширует и вырезает пароли ролей ДО записи JSON
    } else {
        $state['roles'] = rolesForState();
    }

    $newRev = $currentRev + 1;
    $state['_rev'] = $newRev; // легаси-поле, его читает клиентский код мерджа
    $json = json_encode($state, JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        $db->rollBack();
        http_response_code(400); echo json_encode(['error' => 'Некорректный JSON в data']); exit;
    }

    if ($row) {
        $db->prepare('UPDATE app_state SET data = ?, rev = ?, updated_by = ? WHERE id = 1')
           ->execute([$json, $newRev, $session['login']]);
    } else {
        $db->prepare('INSERT INTO app_state (id, data, rev, updated_by) VALUES (1, ?, ?, ?)')
           ->execute([$json, $newRev, $session['login']]);
    }
    $db->commit();
    echo json_encode(['rev' => $newRev]);
} catch (ApiRuleException $e) {
    if ($db->inTransaction()) $db->rollBack();
    http_response_code(400);
    echo json_encode(['error' => $e->getMessage()]);
} catch (Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    http_response_code(500);
    echo json_encode(['error' => 'Ошибка сохранения состояния']);
}
