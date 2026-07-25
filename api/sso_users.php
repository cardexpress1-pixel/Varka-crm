<?php
// Доступы сотрудников портала (2026-07-25, «галочная» модель). Только админ.
//   GET  → {users:[{portal_user_id, email, name, role_id, role_name, level}]}
//   POST {portal_user_id, role_id|null, level|null}
// ДВЕ независимые вещи (2026-07-25, единое понятие доступов):
//   role_id — ДОЛЖНОСТЬ: какие разделы человек видит (модель Производства);
//   level   — УРОВЕНЬ: что может делать — viewer «Просмотр» / manager
//             «Редактирование» / admin «Админ», одинаково во всех проектах.
// Портал даёт только факт доступа; и должность, и уровень выбираются здесь
// (Настройки → Доступы). Должности берём из api/roles.php. Сброс кэша verify —
// чтобы изменения применились сразу (иначе до 60 сек).
require_once __DIR__ . '/storage.php';
apiHeaders('GET, POST');

requireAuth(true); // только админ Производства

$db = pdo();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $rows = $db->query(
        "SELECT m.portal_user_id, m.email, m.name, m.role_id, m.level, r.name AS role_name
           FROM sso_role_map m
           LEFT JOIN roles r ON r.id = m.role_id
          ORDER BY m.name"
    )->fetchAll();
    echo json_encode(['users' => $rows], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($method === 'POST') {
    $b = jsonBody();
    $uid = (int) ($b['portal_user_id'] ?? 0);
    $roleId = (isset($b['role_id']) && $b['role_id'] !== '' && $b['role_id'] !== null)
        ? substr((string) $b['role_id'], 0, 64) : null;

    if ($uid <= 0) {
        http_response_code(400); echo json_encode(['error' => 'Не указан сотрудник']); exit;
    }
    if ($roleId !== null) {
        $chk = $db->prepare('SELECT id FROM roles WHERE id = ?');
        $chk->execute([$roleId]);
        if (!$chk->fetch()) {
            http_response_code(400); echo json_encode(['error' => 'Роль не найдена']); exit;
        }
    }

    // Уровень доступа: что человек может делать (отдельно от должности).
    $level = isset($b['level']) ? trim((string) $b['level']) : '';
    if ($level !== '' && !in_array($level, ['viewer', 'manager', 'admin'], true)) {
        http_response_code(400);
        echo json_encode(['error' => 'Неизвестный уровень доступа'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    if ($level === '') $level = 'viewer'; // безопасный дефолт

    $name  = (isset($b['name'])  && $b['name']  !== '' && $b['name']  !== null) ? substr((string) $b['name'], 0, 190)  : null;
    $email = (isset($b['email']) && $b['email'] !== '' && $b['email'] !== null) ? substr((string) $b['email'], 0, 190) : null;

    // Upsert: строки может ещё не быть (сотрудник не заходил после выдачи доступа) —
    // заводим её, чтобы доступ можно было настроить заранее. name/email обновляем,
    // только если пришли (COALESCE не затирает уже сохранённые значения на null).
    $db->prepare('INSERT INTO sso_role_map (portal_user_id, email, name, role_id, level) VALUES (?, ?, ?, ?, ?)
                  ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), level = VALUES(level),
                    email = COALESCE(VALUES(email), email),
                    name  = COALESCE(VALUES(name),  name)')
       ->execute([$uid, $email, $name, $roleId, $level]);

    // Сброс кэша verify: назначенная роль применяется сразу, а не через ≤60 сек.
    // Кэш ключуется по токену (не по человеку), поэтому чистим целиком — операция
    // редкая (действие админа).
    $db->exec('DELETE FROM portal_verify_cache');

    echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
