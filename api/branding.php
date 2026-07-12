<?php
// Логотип компании. Раньше жил как base64 прямо внутри app_state.data (до ~350КБ,
// больше половины state — см. комментарий в api/state.php) и качался ПОЛНОСТЬЮ на
// каждой загрузке страницы. Теперь — обычный статический файл: браузер скачивает
// его один раз и дальше берёт из HTTP-кэша, а в state остаётся только короткая
// ссылка (state.companyLogoUrl).
require_once __DIR__ . '/storage.php';
apiHeaders('POST, DELETE');
$session = requireAuth(true); // тот же доступ, что и раньше был у раздела брендинга — только админ

define('LOGO_DIR', __DIR__ . '/../uploads');
define('MAX_LOGO_BYTES', 400 * 1024); // с запасом над клиентским лимитом 250КБ

function logoPathFor(string $ext): string {
    return LOGO_DIR . '/company-logo.' . $ext;
}

function clearExistingLogoFiles(): void {
    foreach (['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'] as $ext) {
        $p = logoPathFor($ext);
        if (file_exists($p)) @unlink($p);
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    clearExistingLogoFiles();
    echo json_encode(['ok' => true]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Method not allowed']); exit;
}

$body = jsonBody();
$dataUrl = (string)($body['dataUrl'] ?? '');
if (!preg_match('#^data:image/(png|jpe?g|svg\+xml|webp|gif);base64,(.+)$#', $dataUrl, $m)) {
    http_response_code(400); echo json_encode(['error' => 'Некорректный формат изображения']); exit;
}
$mime  = strtolower($m[1]);
$ext   = $mime === 'jpeg' ? 'jpg' : ($mime === 'svg+xml' ? 'svg' : $mime);
$bytes = base64_decode($m[2], true);
if ($bytes === false || strlen($bytes) > MAX_LOGO_BYTES) {
    http_response_code(400); echo json_encode(['error' => 'Файл слишком большой или повреждён']); exit;
}

if (!is_dir(LOGO_DIR)) @mkdir(LOGO_DIR, 0755, true);
clearExistingLogoFiles(); // старый файл мог быть другого формата (png vs jpg) — не оставляем мусор
file_put_contents(logoPathFor($ext), $bytes);

echo json_encode(['url' => 'uploads/company-logo.' . $ext . '?v=' . time()]);
