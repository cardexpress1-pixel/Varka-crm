<?php
// Одноразовый импорт данных из экспорта Firestore. ТОЛЬКО CLI:
//   php import.php /путь/к/папке/экспорта [--force]
// Ожидает файлы varka_state.json и activityLog.json (декодированные, см.
// scripts экспорта от 2026-07-11). Пароли ролей хешируются в bcrypt и
// вырезаются из state до записи в БД.
if (php_sapi_name() !== 'cli') { http_response_code(403); exit('CLI only'); }
require_once __DIR__ . '/storage.php';

$dir   = $argv[1] ?? '';
$force = in_array('--force', $argv, true);
if ($dir === '' || !is_dir($dir)) exit("usage: php import.php <export_dir> [--force]\n");

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

// Роли: bcrypt для паролей из экспорта, зачистка паролей из JSON.
$roles = $state['roles'] ?? [];
if (!$roles) exit("в state нет ролей — впускать будет некого, импорт прерван\n");
foreach ($state['roles'] as &$r) {
    $pwd = trim((string)($r['password'] ?? ''));
    if ($pwd === '') echo "ВНИМАНИЕ: у роли {$r['login']} пустой пароль — вход будет невозможен до задания пароля в админке\n";
    unset($r['password'], $r['plain_password']);
    $db->prepare('INSERT INTO roles (id, name, login, password_hash, full_access, tabs, fields)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                  ON DUPLICATE KEY UPDATE name=VALUES(name), login=VALUES(login),
                    password_hash=VALUES(password_hash), full_access=VALUES(full_access),
                    tabs=VALUES(tabs), fields=VALUES(fields)')
       ->execute([
            substr((string)$r['id'], 0, 64),
            substr((string)($r['name'] ?? $r['login']), 0, 190),
            substr(trim((string)$r['login']), 0, 64),
            $pwd !== '' ? password_hash($pwd, PASSWORD_BCRYPT) : '',
            !empty($r['fullAccess']) ? 1 : 0,
            json_encode($r['tabs']   ?? [], JSON_UNESCAPED_UNICODE),
            json_encode($r['fields'] ?? (object)[], JSON_UNESCAPED_UNICODE),
       ]);
    echo "роль: {$r['login']} — импортирована\n";
}
unset($r);

$rev = max((int)($state['_rev'] ?? 0), 1);
$state['_rev'] = $rev;
$json = json_encode($state, JSON_UNESCAPED_UNICODE);
$db->prepare('REPLACE INTO app_state (id, data, rev, updated_by) VALUES (1, ?, ?, ?)')
   ->execute([$json, $rev, 'import']);
echo 'app_state: импортирован, rev ' . $rev . ', ' . strlen($json) . " байт\n";

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
