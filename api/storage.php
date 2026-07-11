<?php
// Общий слой API: PDO/MySQL, схема, сессии, requireAuth, rate limit.
// Паттерн перенесён из Tracker (api/storage.php), хранилище — MySQL вместо
// JSON-файлов: это и есть миграция с Firebase Firestore (ТЗ, лист 1 и 7).
require_once __DIR__ . '/config.php';

function pdo(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
            DB_USER, DB_PASS,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
             PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
        );
        bootstrapSchema($pdo);
    }
    return $pdo;
}

// Типы колонок без JSON-типа — чтобы работать одинаково на MySQL 5.7+ и MariaDB.
function bootstrapSchema(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS app_state (
        id TINYINT NOT NULL PRIMARY KEY,
        data LONGTEXT NOT NULL,
        rev BIGINT NOT NULL DEFAULT 0,
        updated_by VARCHAR(64) NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Роль в VarKa = учётка (admin/operator/варщик/приёмка), как в текущем
    // приложении. email и telegram_chat_id — задел под Identity Service и
    // Notification Service (ТЗ, листы 6 и 9), пока не используются.
    $pdo->exec("CREATE TABLE IF NOT EXISTS roles (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        name VARCHAR(190) NOT NULL,
        login VARCHAR(64) NOT NULL,
        password_hash VARCHAR(255) NOT NULL DEFAULT '',
        full_access TINYINT(1) NOT NULL DEFAULT 0,
        tabs MEDIUMTEXT NULL,
        fields MEDIUMTEXT NULL,
        email VARCHAR(190) NULL,
        telegram_chat_id VARCHAR(64) NULL,
        status ENUM('active','blocked') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_login (login)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS sessions (
        token CHAR(64) NOT NULL PRIMARY KEY,
        role_id VARCHAR(64) NOT NULL,
        login VARCHAR(64) NOT NULL,
        full_access TINYINT(1) NOT NULL DEFAULT 0,
        expires_at INT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Журнал действий приложения (бывшая коллекция Firestore activityLog):
    // запись хранится как JSON-строка целиком — формат задаёт клиент.
    $pdo->exec("CREATE TABLE IF NOT EXISTS activity_log (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        entry MEDIUMTEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Успешные и неудачные входы (паттерн logins.json/logins_failed.json из Tracker).
    $pdo->exec("CREATE TABLE IF NOT EXISTS login_log (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        login VARCHAR(64) NOT NULL,
        ok TINYINT(1) NOT NULL,
        ip VARCHAR(45) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS rate_limit (
        bucket VARCHAR(32) NOT NULL,
        k VARCHAR(128) NOT NULL,
        ts INT UNSIGNED NOT NULL,
        KEY idx_bucket_key (bucket, k, ts)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

// Единые заголовки ответа + CORS + обработка preflight. Вызывается первым
// в каждом эндпоинте.
function apiHeaders(string $methods): void {
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
    header("Access-Control-Allow-Methods: $methods, OPTIONS");
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
}

function jsonBody(): array {
    $data = json_decode(file_get_contents('php://input'), true);
    return is_array($data) ? $data : [];
}

function clientIp(): string {
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

function checkRateLimit(string $bucket, string $key, int $maxAttempts, int $windowSeconds): bool {
    $db = pdo();
    $key = substr($key, 0, 128);
    $now = time();
    $db->prepare('DELETE FROM rate_limit WHERE bucket = ? AND ts < ?')
       ->execute([$bucket, $now - $windowSeconds]);
    $q = $db->prepare('SELECT COUNT(*) AS c FROM rate_limit WHERE bucket = ? AND k = ?');
    $q->execute([$bucket, $key]);
    if ((int)$q->fetch()['c'] >= $maxAttempts) return false;
    $db->prepare('INSERT INTO rate_limit (bucket, k, ts) VALUES (?, ?, ?)')
       ->execute([$bucket, $key, $now]);
    return true;
}

function logLoginAttempt(string $login, bool $ok): void {
    pdo()->prepare('INSERT INTO login_log (login, ok, ip) VALUES (?, ?, ?)')
         ->execute([substr($login, 0, 64), $ok ? 1 : 0, clientIp()]);
}

// TTL сессии 12 часов — то же значение, что было у sessionStorage-сессии
// клиента (SESSION_TTL_MS в index.html), теперь источник правды — сервер.
function createSession(array $role): string {
    $db = pdo();
    $db->prepare('DELETE FROM sessions WHERE expires_at < ?')->execute([time()]);
    $token = bin2hex(random_bytes(32));
    $db->prepare('INSERT INTO sessions (token, role_id, login, full_access, expires_at)
                  VALUES (?, ?, ?, ?, ?)')
       ->execute([$token, $role['id'], $role['login'], (int)$role['full_access'],
                  time() + 60 * 60 * 12]);
    return $token;
}

function bearerToken(): string {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!$authHeader && function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) {
            if (strtolower($k) === 'authorization') { $authHeader = $v; break; }
        }
    }
    if (!preg_match('/^Bearer\s+(.+)$/i', trim($authHeader), $m)) return '';
    return $m[1];
}

function currentSession(): ?array {
    $token = bearerToken();
    if ($token === '' || strlen($token) > 64) return null;
    $q = pdo()->prepare('SELECT token, role_id, login, full_access, expires_at
                         FROM sessions WHERE token = ?');
    $q->execute([$token]);
    $s = $q->fetch();
    if (!$s || (int)$s['expires_at'] < time()) return null;
    return $s;
}

// Жёсткая проверка: 401 без сессии, 403 если нужен полный доступ, а его нет.
// Готовность к Identity Service (ТЗ, лист 7, п.2): когда появится центральный
// сервис, сюда добавится проверка его токена как второй источник сессии —
// сигнатура и вызывающий код не изменятся.
function requireAuth(bool $fullAccessOnly = false): array {
    $session = currentSession();
    if (!$session) {
        http_response_code(401);
        echo json_encode(['error' => 'Требуется авторизация']);
        exit;
    }
    if ($fullAccessOnly && !(int)$session['full_access']) {
        http_response_code(403);
        echo json_encode(['error' => 'Недостаточно прав']);
        exit;
    }
    return $session;
}

// Синхронизация ролей из присланного state в таблицу roles.
// Пароли НИКОГДА не сохраняются в app_state: непустой role.password
// хешируется (bcrypt) в таблицу и вырезается из JSON. Так редактор ролей в
// админке продолжает работать без изменений на клиенте.
function syncRolesFromState(array &$state): void {
    if (!isset($state['roles']) || !is_array($state['roles'])) return;
    $db = pdo();
    $seenIds = [];
    $hasFullAccess = false;

    foreach ($state['roles'] as &$r) {
        if (!is_array($r) || !isset($r['id'], $r['login'])) continue;
        $id    = substr((string)$r['id'], 0, 64);
        $login = substr(trim((string)$r['login']), 0, 64);
        if ($id === '' || $login === '') continue;
        $seenIds[] = $id;
        $full = !empty($r['fullAccess']) ? 1 : 0;
        if ($full) $hasFullAccess = true;

        $newHash = '';
        if (isset($r['password']) && trim((string)$r['password']) !== '') {
            $newHash = password_hash(trim((string)$r['password']), PASSWORD_BCRYPT);
        }
        unset($r['password'], $r['plain_password']);

        $db->prepare('INSERT INTO roles (id, name, login, password_hash, full_access, tabs, fields)
                      VALUES (?, ?, ?, ?, ?, ?, ?)
                      ON DUPLICATE KEY UPDATE
                        name = VALUES(name), login = VALUES(login),
                        full_access = VALUES(full_access),
                        tabs = VALUES(tabs), fields = VALUES(fields),
                        password_hash = IF(VALUES(password_hash) <> \'\', VALUES(password_hash), password_hash)')
           ->execute([
                $id,
                substr((string)($r['name'] ?? $login), 0, 190),
                $login,
                $newHash,
                $full,
                json_encode($r['tabs']   ?? [], JSON_UNESCAPED_UNICODE),
                json_encode($r['fields'] ?? (object)[], JSON_UNESCAPED_UNICODE),
           ]);
    }
    unset($r);

    // Защита от самоблокировки: нельзя сохранить state, в котором не осталось
    // ни одной роли с полным доступом — иначе в админку больше никто не войдёт.
    if (!$hasFullAccess) {
        http_response_code(400);
        echo json_encode(['error' => 'Нельзя удалить/отключить последнюю роль с полным доступом']);
        exit;
    }

    // Роль, удалённая в админке, удаляется и из таблицы (доступ отзывается сразу).
    if ($seenIds) {
        $ph = implode(',', array_fill(0, count($seenIds), '?'));
        $db->prepare("DELETE FROM sessions WHERE role_id NOT IN ($ph)")->execute($seenIds);
        $db->prepare("DELETE FROM roles WHERE id NOT IN ($ph)")->execute($seenIds);
    }
}
