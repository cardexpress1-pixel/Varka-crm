<?php
// Общий слой API: PDO/MySQL, схема, сессии, requireAuth, rate limit.
// Паттерн перенесён из Tracker (api/storage.php), хранилище — MySQL вместо
// JSON-файлов: это и есть миграция с Firebase Firestore (ТЗ, лист 1 и 7).
require_once __DIR__ . '/config.php';

// Признак «админа» в этом приложении — доступ к вкладке 'admin' (админ-панель,
// где редактируются роли). Флага fullAccess у боевых ролей нет; источник правды —
// наличие этой вкладки. См. syncRolesFromState() и requireAuth().
const ADMIN_TAB = 'admin';

// Исключение бизнес-правила: эндпоинт ловит его и отдаёт HTTP-код сам,
// storage-слой не печатает ответ и не делает exit (пригоден и для CLI-импорта).
class ApiRuleException extends RuntimeException {}

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
        ensureViewerRole($pdo);
        ensureSsoRoleMapTable($pdo);
    }
    return $pdo;
}

// Карта «сотрудник портала → роль-должность Производства» (2026-07-25, переход на
// «галочную» модель: портал даёт только доступ, а КОНКРЕТНУЮ роль назначает админ
// ВНУТРИ Производства — Настройки → Доступы). Ключ — стабильный portal_user_id;
// email/name — для показа в списке. role_id NULL = роль ещё не назначена (действует
// минимальный «Просмотр»). Строка появляется сама при первом SSO-входе сотрудника.
// Идемпотентная миграция со своим флаг-файлом: на проде .schema_ok уже стоит,
// bootstrapSchema() не перезапустится (как ensureViewerRole).
function ensureSsoRoleMapTable(PDO $pdo): void {
    $flag = __DIR__ . '/.ssorolemap_ok';
    if (file_exists($flag)) return;
    $pdo->exec("CREATE TABLE IF NOT EXISTS sso_role_map (
        portal_user_id INT NOT NULL PRIMARY KEY,
        email VARCHAR(190) NULL,
        name VARCHAR(190) NULL,
        role_id VARCHAR(64) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    file_put_contents($flag, date('c'));
}

// Роль «Просмотр» (решение владельца 2026-07-23): для сотрудников портала,
// которым Производство нужно только смотреть — назначается в модалке
// сотрудника на портале, как остальные роли. Честность набора вкладок:
// серверного read-only в Производстве нет, поэтому роли даны только
// просмотровые экраны без рабочих кнопок (дашборд, отчёты, журнал).
// Локального пароля нет (случайный хеш) — вход только через SSO портала.
// Идемпотентный сид со своим флаг-файлом: .schema_ok на проде уже стоит,
// bootstrapSchema() не перезапустится. Дальше роль живёт как обычная —
// редактируется/удаляется в редакторе ролей админки (флаг не даст сиду
// воскресить осознанно удалённую роль).
function ensureViewerRole(PDO $pdo): void {
    $flag = __DIR__ . '/.viewerrole_ok';
    if (file_exists($flag)) return;
    $pdo->prepare("INSERT IGNORE INTO roles (id, name, login, password_hash, is_admin, tabs, fields)
                   VALUES ('viewer', 'Просмотр', 'viewer', ?, 0, ?, ?)")
        ->execute([
            password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            json_encode(['dashboard', 'reports', 'journal']),
            json_encode(['client' => true, 'note' => true, 'priority' => true]),
        ]);
    file_put_contents($flag, date('c'));
}

// Схема создаётся один раз: флаг-файл рядом с data-каталогом снимает 6× DDL
// с КАЖДОГО запроса (включая опрос /state и публичный /report). Удалите файл
// .schema_ok, если поменяли DDL и нужно пересоздать/дополнить таблицы.
function bootstrapSchema(PDO $pdo): void {
    $flag = __DIR__ . '/.schema_ok';
    if (file_exists($flag)) return;

    // Типы колонок без JSON-типа — чтобы работать одинаково на MySQL 5.7+ и MariaDB.
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
        is_admin TINYINT(1) NOT NULL DEFAULT 0,
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
        is_admin TINYINT(1) NOT NULL DEFAULT 0,
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

    @file_put_contents($flag, date('c') . "\n");
}

// Единые заголовки ответа + CORS + обработка preflight. Вызывается первым
// в каждом эндпоинте. $origin позволяет публичному /report открыть CORS всем.
function apiHeaders(string $methods, string $origin = ALLOWED_ORIGIN): void {
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: ' . $origin);
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

// Читает число неудачных попыток в окне БЕЗ записи новой (успешные входы не
// расходуют лимит — иначе смена за одним NAT-IP блокирует сама себя).
function failedAttempts(string $bucket, string $key, int $windowSeconds): int {
    $db = pdo();
    $key = substr($key, 0, 128);
    $db->prepare('DELETE FROM rate_limit WHERE bucket = ? AND ts < ?')
       ->execute([$bucket, time() - $windowSeconds]);
    $q = $db->prepare('SELECT COUNT(*) AS c FROM rate_limit WHERE bucket = ? AND k = ?');
    $q->execute([$bucket, $key]);
    return (int)$q->fetch()['c'];
}

function recordFailure(string $bucket, string $key): void {
    pdo()->prepare('INSERT INTO rate_limit (bucket, k, ts) VALUES (?, ?, ?)')
         ->execute([$bucket, substr($key, 0, 128), time()]);
}

// Пишет попытку входа и в login_log (для SQL-разбора), и — при неудаче — в
// activity_log, чтобы серия подборов была видна админу прямо в журнале
// действий (регрессия аудита §6 иначе теряется: login_log в UI не показан).
function logLoginAttempt(string $login, bool $ok): void {
    $db = pdo();
    $db->prepare('INSERT INTO login_log (login, ok, ip) VALUES (?, ?, ?)')
       ->execute([substr($login, 0, 64), $ok ? 1 : 0, clientIp()]);
    if (!$ok) {
        $entry = [
            'userName'  => $login !== '' ? $login : '—',
            'role'      => '—',
            'action'    => 'Неудачная попытка входа',
            'target'    => $login,
            'details'   => ['ip' => clientIp()],
            'tsMs'      => (int)round(microtime(true) * 1000),
            'createdAt' => date('c'),
        ];
        $db->prepare('INSERT INTO activity_log (entry) VALUES (?)')
           ->execute([json_encode($entry, JSON_UNESCAPED_UNICODE)]);
    }
    // Ротация: изредка подрезаем логи до последних 5000 (в UI видно только 200).
    if (($login[0] ?? 'x') <= '3') { // дешёвый ~19%-й сэмпл без random-функций
        pruneLog('activity_log', 5000);
        pruneLog('login_log', 5000);
    }
}

// Оставляет только последние $keep строк таблицы с автоинкрементным id.
function pruneLog(string $table, int $keep): void {
    $db = pdo();
    $max = (int)$db->query("SELECT COALESCE(MAX(id),0) AS m FROM $table")->fetch()['m'];
    if ($max > $keep) {
        $db->prepare("DELETE FROM $table WHERE id < ?")->execute([$max - $keep]);
    }
}

// TTL сессии 12 часов — то же значение, что было у sessionStorage-сессии
// клиента (SESSION_TTL_MS в index.html), теперь источник правды — сервер.
function createSession(array $role): string {
    $db = pdo();
    $db->prepare('DELETE FROM sessions WHERE expires_at < ?')->execute([time()]);
    $token = bin2hex(random_bytes(32));
    $db->prepare('INSERT INTO sessions (token, role_id, login, is_admin, expires_at)
                  VALUES (?, ?, ?, ?, ?)')
       ->execute([$token, $role['id'], $role['login'], (int)$role['is_admin'],
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
    $q = pdo()->prepare('SELECT token, role_id, login, is_admin, expires_at
                         FROM sessions WHERE token = ?');
    $q->execute([$token]);
    $s = $q->fetch();
    if ($s && (int)$s['expires_at'] >= time()) return $s;
    return verifyPortalToken($token);
}

// SSO-слой поверх локального логина (шаг 5 ТЗ) — токен портала (varka.kz)
// как второй источник сессии, ровно то место, о котором предупреждал
// комментарий выше у requireAuth(). Portal и Manufacture — общий origin
// (varka.kz / varka.kz/manufacture), поэтому portal_token из sessionStorage
// портала уже доступен фронтенду Manufacture напрямую.
//
// В Manufacture роль = должность (admin/operator/warshchik/intake — набор
// вкладок), не человек, поэтому уровни портала view/edit нельзя однозначно
// сопоставить с конкретной ролью-должностью. SSO пускает ТОЛЬКО уровень
// 'admin' — полный доступ (is_admin, tabs не нужны); 'edit'/'view' — реальная
// роль-должность по имени job_title из портала (см. elseif ниже, 2026-07-23);
// 'none'/нет должности — отказ. Открытый вопрос из 01_IDENTITY_SERVICE_SPEC.md
// (раздел 6) про персональные роли закрыт этим маппингом.
//
// Кэш в отдельной таблице (не JSON-файл — Manufacture целиком на MySQL),
// TTL 60 сек, чтобы не бить по сети на каждый запрос.
function verifyPortalToken(string $token): ?array {
    $db = pdo();
    $db->exec("CREATE TABLE IF NOT EXISTS portal_verify_cache (
        token VARCHAR(64) PRIMARY KEY,
        session_json TEXT NOT NULL,
        expires_at INT UNSIGNED NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $now = time();
    $db->prepare('DELETE FROM portal_verify_cache WHERE expires_at < ?')->execute([$now]);

    $q = $db->prepare('SELECT session_json FROM portal_verify_cache WHERE token = ?');
    $q->execute([$token]);
    $row = $q->fetch();
    if ($row) {
        return json_decode($row['session_json'], true) ?: null;
    }

    $context = stream_context_create([
        'http' => [
            'method'  => 'POST',
            'header'  => "Authorization: Bearer $token\r\nContent-Type: application/json\r\n",
            'content' => '{}',
            'timeout' => 3,
            'ignore_errors' => true,
        ],
    ]);
    $response = @file_get_contents('https://varka.kz/api/verify', false, $context);
    $data = $response !== false ? json_decode($response, true) : null;

    $session = null;
    if (is_array($data) && !empty($data['permissions'])) {
        $level = 'none';
        $portalRoleId = null;
        foreach ($data['permissions'] as $p) {
            if (($p['project_code'] ?? '') === 'manufacture') {
                $level = $p['level'];
                $portalRoleId = $p['project_role_id'] ?? null;
                break;
            }
        }
        // «Галочная» модель (2026-07-25): портал даёт только ДОСТУП (любой уровень !=
        // none), а конкретную роль-должность назначает админ ВНУТРИ Производства
        // (Настройки → Доступы, таблица sso_role_map). Уровни view/edit/admin с
        // портала больше не решают роль напрямую — они лишь «пускать/нет».
        if ($level !== 'none') {
            $uid   = (int) ($data['user_id'] ?? 0);
            $email = $data['email'] ?? null;
            $name  = $data['full_name'] ?? ($email ?? 'Портал');
            $login = $email ?? ('portal:' . $uid);

            // Запомнить/обновить личность в карте доступов (роль НЕ трогаем — её
            // ставит админ). Строка появляется при первом входе — тогда сотрудник
            // виден в «Настройки → Доступы».
            if ($uid > 0) {
                $db->prepare('INSERT INTO sso_role_map (portal_user_id, email, name) VALUES (?, ?, ?)
                              ON DUPLICATE KEY UPDATE email = VALUES(email), name = VALUES(name)')
                   ->execute([$uid, $email, $name]);
            }

            $roleId = null; $isAdmin = 0; $resolved = false;

            // 1) Явно назначенная внутри Производства роль — приоритет.
            if ($uid > 0) {
                $mid = $db->prepare('SELECT role_id FROM sso_role_map WHERE portal_user_id = ?');
                $mid->execute([$uid]);
                $mapped = $mid->fetchColumn();
                if ($mapped) {
                    $rq = $db->prepare('SELECT id, is_admin FROM roles WHERE id = ?');
                    $rq->execute([$mapped]);
                    if ($role = $rq->fetch()) { $roleId = $role['id']; $isAdmin = (int) $role['is_admin']; $resolved = true; }
                }
            }

            // 2) Переходный fallback (пока роль не назначили внутри) — сохраняет
            //    прежнее поведение, чтобы деплой никого не выкинул: портальный admin →
            //    админ (bootstrap, чтобы было кому раздать роли), иначе прежний
            //    project_role_id с портала.
            if (!$resolved) {
                if ($level === 'admin') {
                    $isAdmin = 1; $resolved = true; // role_id=null → whoami даёт синт. админа
                } elseif ($portalRoleId !== null && $portalRoleId !== '') {
                    $rq = $db->prepare('SELECT id, is_admin FROM roles WHERE id = ?');
                    $rq->execute([$portalRoleId]);
                    if ($role = $rq->fetch()) { $roleId = $role['id']; $isAdmin = (int) $role['is_admin']; $resolved = true; }
                }
            }

            // 3) Доступ есть, роль не определена → минимальный «Просмотр» (viewer).
            if (!$resolved) {
                if ($role = $db->query("SELECT id, is_admin FROM roles WHERE id = 'viewer'")->fetch()) {
                    $roleId = $role['id']; $isAdmin = (int) $role['is_admin']; $resolved = true;
                }
            }

            if ($resolved) {
                $session = [
                    'token'      => $token,
                    'role_id'    => $roleId,
                    'login'      => $login,
                    'name'       => $name,
                    'is_admin'   => $isAdmin,
                    'expires_at' => $now + 60 * 60 * 24 * 7,
                ];
            }
        }
    }

    // Кэшируем и отрицательный результат — иначе невалидный/недостаточный
    // токен будет бить по сети на каждый запрос.
    $db->prepare('INSERT INTO portal_verify_cache (token, session_json, expires_at) VALUES (?, ?, ?)
                  ON DUPLICATE KEY UPDATE session_json = VALUES(session_json), expires_at = VALUES(expires_at)')
       ->execute([$token, json_encode($session), $now + 60]);

    return $session;
}

// Жёсткая проверка: 401 без сессии, 403 если нужен админ, а сессия не админская.
// Готовность к Identity Service (ТЗ, лист 7, п.2): когда появится центральный
// сервис, сюда добавится проверка его токена как второй источник сессии —
// сигнатура и вызывающий код не изменятся.
function requireAuth(bool $adminOnly = false): array {
    $session = currentSession();
    if (!$session) {
        http_response_code(401);
        echo json_encode(['error' => 'Требуется авторизация']);
        exit;
    }
    if ($adminOnly && !(int)$session['is_admin']) {
        http_response_code(403);
        echo json_encode(['error' => 'Недостаточно прав']);
        exit;
    }
    return $session;
}

function roleIsAdmin(array $r): bool {
    $tabs = $r['tabs'] ?? [];
    return is_array($tabs) && in_array(ADMIN_TAB, $tabs, true);
}

// Собирает список ролей из таблицы для встраивания в app_state (без паролей).
// Используется, когда НЕ-админ сохраняет state: его версия roles игнорируется и
// заменяется авторитетной из БД, чтобы обычный пользователь не мог подменить
// роли/права прямым POST.
function rolesForState(): array {
    $rows = pdo()->query('SELECT id, name, login, is_admin, tabs, fields FROM roles')->fetchAll();
    $out = [];
    foreach ($rows as $r) {
        $out[] = [
            'id'         => $r['id'],
            'name'       => $r['name'],
            'login'      => $r['login'],
            'tabs'       => json_decode($r['tabs'] ?? '[]', true) ?: [],
            'fields'     => json_decode($r['fields'] ?? '{}', true) ?: (object)[],
            'fullAccess' => (bool)$r['is_admin'], // историческое поле клиента
        ];
    }
    return $out;
}

// Синхронизация ролей из присланного state в таблицу roles. ТОЛЬКО для админа
// (вызывающий обязан это проверить). Пароли НИКОГДА не сохраняются в app_state:
// непустой role.password хешируется (bcrypt) в таблицу и вырезается из JSON.
// Бросает ApiRuleException при нарушении бизнес-правила (эндпоинт → HTTP-код).
function syncRolesFromState(array &$state): void {
    if (!isset($state['roles']) || !is_array($state['roles'])) return;
    $db = pdo();

    // Предпроход: собираем валидные id и вырезаем пароли из JSON СРАЗУ (даже у
    // ролей, которые ниже отсеются по continue — иначе plaintext уедет в state).
    $seenIds = [];
    $hasAdmin = false;
    foreach ($state['roles'] as &$r) {
        if (!is_array($r)) continue;
        $plain = isset($r['password']) ? trim((string)$r['password']) : '';
        unset($r['password'], $r['plain_password']);
        $r['_plain'] = $plain; // временно, снимем после upsert
        $id    = isset($r['id']) ? substr((string)$r['id'], 0, 64) : '';
        $login = isset($r['login']) ? substr(trim((string)$r['login']), 0, 64) : '';
        if ($id === '' || $login === '') { $r['_skip'] = true; continue; }
        $seenIds[] = $id;
        if (roleIsAdmin($r)) $hasAdmin = true;
    }
    unset($r);

    // Защита от самоблокировки: хотя бы одна роль с доступом к админ-панели
    // должна остаться, иначе управлять ролями станет некому.
    if (!$hasAdmin) {
        throw new ApiRuleException('Нельзя удалить/отключить последнюю роль с доступом к админ-панели');
    }

    // Удаляем исчезнувшие роли и их сессии ДО upsert — чтобы перенос логина с
    // удаляемой роли на другую не столкнулся по UNIQUE(login) со строкой,
    // которую всё равно удаляем (иначе ON DUPLICATE перезапишет чужую строку).
    if ($seenIds) {
        $ph = implode(',', array_fill(0, count($seenIds), '?'));
        $db->prepare("DELETE FROM sessions WHERE role_id NOT IN ($ph)")->execute($seenIds);
        $db->prepare("DELETE FROM roles WHERE id NOT IN ($ph)")->execute($seenIds);
    }

    $up = $db->prepare('INSERT INTO roles (id, name, login, password_hash, is_admin, tabs, fields)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                          name = VALUES(name), login = VALUES(login),
                          is_admin = VALUES(is_admin),
                          tabs = VALUES(tabs), fields = VALUES(fields),
                          password_hash = IF(VALUES(password_hash) <> \'\', VALUES(password_hash), password_hash)');

    foreach ($state['roles'] as &$r) {
        if (!is_array($r)) continue;
        $plain = $r['_plain'] ?? '';
        $skip  = !empty($r['_skip']);
        unset($r['_plain'], $r['_skip']);
        if ($skip) continue;
        $up->execute([
            substr((string)$r['id'], 0, 64),
            substr((string)($r['name'] ?? $r['login']), 0, 190),
            substr(trim((string)$r['login']), 0, 64),
            $plain !== '' ? password_hash($plain, PASSWORD_BCRYPT) : '',
            roleIsAdmin($r) ? 1 : 0,
            json_encode($r['tabs']   ?? [], JSON_UNESCAPED_UNICODE),
            json_encode($r['fields'] ?? (object)[], JSON_UNESCAPED_UNICODE),
        ]);
    }
    unset($r);
}
