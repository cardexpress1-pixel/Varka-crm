<?php
// GET → {role}. "Кто я" по текущему токену — нужен для SSO-сессий портала:
// в отличие от auth.php, у них нет пары логин/пароль, только готовый токен
// (см. verifyPortalToken() в storage.php), а фронтенду для рендера нужен
// объект role той же формы, что отдаёт auth.php при обычном логине.
require_once __DIR__ . '/storage.php';
apiHeaders('GET');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit;
}

$session = requireAuth();

if ($session['role_id'] !== null) {
    $q = pdo()->prepare('SELECT id, name, login, is_admin, tabs, fields FROM roles WHERE id = ?');
    $q->execute([$session['role_id']]);
    $role = $q->fetch();
    if ($role) {
        echo json_encode(['role' => [
            'id'         => $role['id'],
            'name'       => $role['name'],
            'login'      => $role['login'],
            'fullAccess' => (bool)$role['is_admin'],
            'tabs'       => json_decode($role['tabs'] ?? '[]', true) ?: [],
            'fields'     => json_decode($role['fields'] ?? '{}', true) ?: (object)[],
        ]], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

// SSO-сессия (нет локальной роли-должности) — синтетический админ-объект.
// verifyPortalToken() пускает по SSO только уровень 'admin', так что
// fullAccess здесь всегда true (см. комментарий в storage.php).
echo json_encode(['role' => [
    'id'         => null,
    'name'       => $session['name'] ?? $session['login'],
    'login'      => $session['login'],
    'fullAccess' => (bool)$session['is_admin'],
    'tabs'       => ['admin'],
    'fields'     => (object)[],
]], JSON_UNESCAPED_UNICODE);
