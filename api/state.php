<?php
// Состояние приложения (бывший документ Firestore varka/state).
// GET [?rev=N] → {rev, data} | {rev, unchanged:true} если N == текущему rev.
// POST {baseRev, data} → {rev} | 409 {rev, data} при конфликте версий.
require_once __DIR__ . '/storage.php';
apiHeaders('GET, POST');

$session = requireAuth();
$db = pdo();

// Фикс FINDING_orphaned_zayavki_page.md §6 (2026-08-25): ключи без легитимных
// потребителей ни у одной роли — вырезаются из отдаваемого state для всех
// сессий. Рецептуры дополнительно скрыты от цеховых терминалов: состав
// партии уже денормализован в batch.ingredients в момент создания варки
// (mkBatch()/calcIngredients() в index.html), сам шаблон рецептуры этим
// ролям не показывается ни в одном экране (FINDING §6.3).
const STATE_KEYS_DROP_ALWAYS = ['requests', 'sheetsUrl'];
const STATE_KEYS_DROP_SHOPFLOOR = ['recipes'];
const SHOPFLOOR_ROLE_IDS = ['warshchik', 'intake'];

// Продолжение фикса (2026-08-25, точная матрица потребителей по роли —
// FINDING_orphaned_zayavki_page.md §6.6 + диагностика этой сессии,
// ТЗ §5.2). В отличие от recipes выше, набор исключаемых ключей у каждой
// роли свой — не сводится к одному общему списку для «цеха», поэтому
// карта роль → ключи, а не ещё один STATE_KEYS_DROP_* + список ролей.
// `batches` сюда намеренно не входит: warshchik/intake рендерят обзорную
// панель по ВСЕМ реакторам/линиям сразу (index.html:6150-6167,
// index.html:6440-6450) — им нужен близкий к полному массив, простым
// исключением ключа не сузить (см. ТЗ §5.2).
const STATE_KEYS_DROP_BY_ROLE = [
    'warshchik' => ['clients', 'workdayHours', 'pouringLines'],
    'intake'    => ['clients', 'workdayHours', 'reactors'],
    'viewer'    => ['clients'],
];

// Вырезает ключи из уже готовой JSON-строки state перед отдачей клиенту.
// Не трогает то, что пишется в БД (сохранение по-прежнему работает с
// полным state) — только то, что уходит наружу в HTTP-ответе. Единая
// точка для обоих мест, где api/state.php отдаёт содержимое data целиком
// (GET и POST-409), чтобы фильтр нельзя было обойти конфликтным POST'ом.
function filterStateJsonForSession(string $json, array $session): string {
    $data = json_decode($json, true);
    if (!is_array($data)) return $json;
    foreach (STATE_KEYS_DROP_ALWAYS as $k) unset($data[$k]);
    if (in_array($session['role_id'] ?? null, SHOPFLOOR_ROLE_IDS, true)) {
        foreach (STATE_KEYS_DROP_SHOPFLOOR as $k) unset($data[$k]);
    }
    foreach (STATE_KEYS_DROP_BY_ROLE[$session['role_id'] ?? ''] ?? [] as $k) {
        unset($data[$k]);
    }
    return json_encode($data, JSON_UNESCAPED_UNICODE);
}

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
    // data — готовая JSON-строка из БД; фильтруется по роли сессии перед отдачей.
    echo '{"rev":' . (int)$row['rev'] . ',"data":' . filterStateJsonForSession($row['data'], $session) . '}';
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit;
}

// Уровень «Просмотр» (2026-07-25) — только чтение: сохранение состояния запрещено.
// Это ЕДИНСТВЕННАЯ точка записи данных приложения (клиент шлёт сюда весь state),
// поэтому одной проверки достаточно, чтобы «Просмотр» ничего не изменил. Клиент
// дополнительно прячет кнопки, но источник правды — здесь.
if (sessionLevel($session) === 'viewer') {
    http_response_code(403);
    echo json_encode(['error' => 'Уровень «Просмотр» не может изменять данные'], JSON_UNESCAPED_UNICODE);
    exit;
}

// Rate limit: 100 запросов/мин на сессию (не на IP — эндпоинт авторизованный,
// ключ — bearer-токен сессии). Решение владельца (аудит «День 0»), реализовано
// 2026-08-25 (ТЗ MFG-007). Переиспользует общий механизм rate_limit
// (failedAttempts/recordFailure, api/storage.php:198-213) — изначально
// написан для лимита неудачных попыток входа, здесь считает КАЖДЫЙ запрос
// в бакете 'state-write', не только неудачные.
if (failedAttempts('state-write', $session['token'], 60) >= 100) {
    http_response_code(429);
    echo json_encode(['error' => 'Слишком много запросов, попробуйте позже'], JSON_UNESCAPED_UNICODE);
    exit;
}
recordFailure('state-write', $session['token']);

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
        echo '{"error":"conflict","rev":' . (int)$row['rev'] . ',"data":' . filterStateJsonForSession($row['data'], $session) . '}';
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
