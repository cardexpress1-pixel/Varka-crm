<?php
// Одноразовый импорт данных из экспорта Firestore. ТОЛЬКО CLI:
//   php import.php /путь/к/папке/экспорта [--force]
// Ожидает файлы varka_state.json и activityLog.json (декодированные, см.
// scripts экспорта от 2026-07-11). Роли и пароли обрабатывает та же
// syncRolesFromState(), что и штатное сохранение, — без дублирования логики.
if (php_sapi_name() !== 'cli') { http_response_code(403); exit('CLI only'); }
require_once __DIR__ . '/storage.php';

// Аргумент через $argv — предпочтительно. Фолбэк на дефолтный путь
// (../../import_private от api/, т.е. рядом с папкой сайта) — на некоторых
// панелях Планировщик задач не пробрасывает "аргументы" в $argv для типа
// "Выполнить PHP-скрипт", тогда единственный способ узнать путь — это
// местоположение самого скрипта.
$dir   = $argv[1] ?? (dirname(__DIR__, 2) . '/import_private');
$force = in_array('--force', $argv, true);
if ($dir === '' || !is_dir($dir)) exit("usage: php import.php <export_dir> [--force] (пробовал: $dir)\n");

$stateFile = $dir . '/varka_state.json';
$logFile   = $dir . '/activityLog.json';
if (!file_exists($stateFile)) exit("not found: $stateFile\n");

$state = json_decode(file_get_contents($stateFile), true);
if (!is_array($state)) exit("varka_state.json: invalid JSON\n");

$db = pdo();

$existing = $db->query('SELECT rev FROM app_state WHERE id = 1')->fetch();
if ($existing && !$force) {
    exit("app_state уже заполнен (rev {$existing['rev']}). Повторный импорт затрёт данные — запустите с --force, если это осознанно.\n");
}

// Предупреждение о ролях без пароля (после хеширования войти под ними будет
// нельзя, пока админ не задаст пароль в админ-панели).
foreach (($state['roles'] ?? []) as $r) {
    if (is_array($r) && trim((string)($r['password'] ?? '')) === '') {
        echo "ВНИМАНИЕ: у роли " . ($r['login'] ?? '?') . " пустой пароль — вход невозможен до задания пароля в админке\n";
    }
}

$db->beginTransaction();
try {
    // Та же синхронизация, что и в state.php: хеширует пароли (bcrypt), вырезает
    // их из JSON, проверяет наличие админ-роли, чистит исчезнувшие роли/сессии.
    syncRolesFromState($state);

    $rev = max((int)($state['_rev'] ?? 0), 1);
    $state['_rev'] = $rev;
    $json = json_encode($state, JSON_UNESCAPED_UNICODE);
    $db->prepare('REPLACE INTO app_state (id, data, rev, updated_by) VALUES (1, ?, ?, ?)')
       ->execute([$json, $rev, 'import']);
    $db->commit();
    echo 'app_state: импортирован, rev ' . $rev . ', ' . strlen($json) . " байт\n";
    echo 'roles: ' . count($state['roles'] ?? []) . " синхронизировано (пароли захешированы)\n";
} catch (ApiRuleException $e) {
    $db->rollBack();
    exit('ОШИБКА: ' . $e->getMessage() . "\n");
} catch (Throwable $e) {
    $db->rollBack();
    exit('ОШИБКА импорта: ' . $e->getMessage() . "\n");
}

if (file_exists($logFile)) {
    $entries = json_decode(file_get_contents($logFile), true) ?: [];
    if ($force) $db->exec('TRUNCATE activity_log');
    $ins = $db->prepare('INSERT INTO activity_log (entry) VALUES (?)');
    // Экспорт отсортирован новые-первыми; вставляем старые-первыми, чтобы
    // порядок id совпадал с хронологией.
    foreach (array_reverse($entries) as $e) {
        unset($e['_id']);
        $ins->execute([json_encode($e, JSON_UNESCAPED_UNICODE)]);
    }
    echo 'activity_log: ' . count($entries) . " записей\n";
}

echo "ИМПОРТ ЗАВЕРШЁН\n";
