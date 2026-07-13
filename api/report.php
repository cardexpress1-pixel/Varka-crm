<?php
// ПУБЛИЧНЫЙ read-only эндпоинт для сводного дашборда портала
// (ТЗ, лист 7, чек-лист п.4: портал получает данные проекта только отсюда,
// прямого доступа к БД у портала нет). Отдаёт только обезличенные агрегаты —
// никаких имён, логинов, рецептур и журналов. Партии — производственные
// объекты, не люди, поэтому (в отличие от Tracker) детализация "варка N
// сегодня" не идентифицирует конкретного человека — эндпоинт остаётся
// публичным без авторизации.
//
// Блок 'pulse' повторяет renderPulseDay()/getBatchStage() из index.html
// (тот же продукт, тот же смысл цифр на дашборде портала и в самой
// Manufacture) — только для сегодняшних варок (brewDate = сегодня).
require_once __DIR__ . '/storage.php';
apiHeaders('GET', '*'); // публичный обезличенный агрегат; OPTIONS-preflight обработан
header('Cache-Control: public, max-age=60');

function getBatchStage(array $b): string {
    $status = $b['status'] ?? null;
    if ($status === 'cancelled') return 'cancelled';
    if ($status === 'deleted') return 'deleted';

    $assigned = !empty($b['assignedToBrewing']) || !empty($b['sentToBrewing']);
    if (!$assigned) return 'queued';

    if ($status !== 'active' && $status !== 'done' && empty($b['brewStartedAt'])) return 'assigned';
    if ($status !== 'done' && empty($b['brewEndedAt'])) return 'brewing';
    if (empty($b['sentToPouring']) || empty($b['pouringStartedAt'])) return 'brewed';
    if (empty($b['pouringEndedAt'])) return 'pouring';
    if (!array_key_exists('factQty', $b) || $b['factQty'] === null) return 'poured';
    return 'finished';
}

function taraOf(array $b, array $recipesBySku): float {
    if (!empty($b['tara'])) return (float)$b['tara'];
    $sku = $b['sku'] ?? null;
    if ($sku !== null && isset($recipesBySku[$sku]['tara'])) return (float)$recipesBySku[$sku]['tara'];
    return 0.0;
}

function volOf(array $b, array $recipesBySku): float {
    if (isset($b['volume']) && $b['volume'] > 0) return (float)$b['volume'];
    return (float)($b['planQty'] ?? 0) * taraOf($b, $recipesBySku);
}

$row = pdo()->query('SELECT data, rev, updated_at FROM app_state WHERE id = 1')->fetch();
if (!$row) { echo json_encode(['project' => 'manufacture', 'ready' => false]); exit; }

$state = json_decode($row['data'], true) ?: [];
$batches = $state['batches'] ?? [];

$byStatus = [];
foreach ($batches as $b) {
    $s = (string)($b['status'] ?? 'unknown');
    $byStatus[$s] = ($byStatus[$s] ?? 0) + 1;
}

$recipesBySku = [];
foreach (($state['recipes'] ?? []) as $r) {
    if (isset($r['sku'])) $recipesBySku[$r['sku']] = $r;
}

$today = date('Y-m-d');
$periodBatches = array_values(array_filter($batches, function ($b) use ($today) {
    $status = $b['status'] ?? null;
    return ($b['brewDate'] ?? null) === $today && $status !== 'deleted' && $status !== 'cancelled';
}));

$brewedStages = ['brewed', 'pouring', 'poured', 'finished'];
$awaitingStages = ['brewed', 'pouring', 'poured'];

$brewedB = [];
$releasedB = [];
$awaitingB = [];
$liveReactors = [];
foreach ($periodBatches as $b) {
    $stage = getBatchStage($b);
    $hasFactQty = array_key_exists('factQty', $b) && $b['factQty'] !== null;

    if (in_array($stage, $brewedStages, true)) $brewedB[] = $b;
    if ($hasFactQty) $releasedB[] = $b;
    if (in_array($stage, $awaitingStages, true) && !$hasFactQty) $awaitingB[] = $b;
    if (($stage === 'brewing' || $stage === 'pouring') && !empty($b['reactor'])) {
        $liveReactors[$b['reactor']] = true;
    }
}

$brewedKg = array_sum(array_map(fn($b) => volOf($b, $recipesBySku), $brewedB));
$avgBrewKg = count($brewedB) ? $brewedKg / count($brewedB) : 0;
$releasedQty = array_sum(array_map(fn($b) => (float)($b['factQty'] ?? 0), $releasedB));
$awaitingKg = array_sum(array_map(fn($b) => volOf($b, $recipesBySku), $awaitingB));

$skuSet = [];
foreach ($releasedB as $b) {
    $sku = $b['sku'] ?? ($b['name'] ?? null);
    if ($sku !== null) $skuSet[$sku] = true;
}

$reactorsTotal = count($state['reactors'] ?? []);
$reactorsOccupied = count($liveReactors);
$reactorsFree = max(0, $reactorsTotal - $reactorsOccupied);

echo json_encode([
    'project'   => 'manufacture',
    'ready'     => true,
    'updatedAt' => $row['updated_at'],
    'rev'       => (int)$row['rev'],
    'batches'   => ['total' => count($batches), 'byStatus' => $byStatus],
    'recipes'   => ['total' => count($state['recipes'] ?? [])],
    'clients'   => ['total' => count($state['clients'] ?? [])],
    'requests'  => ['total' => count($state['requests'] ?? [])],
    'pulse'     => [
        'batchesToday'     => count($periodBatches),
        'batchesFinished'  => count($releasedB),
        'brewedTons'       => round($brewedKg / 1000, 2),
        'avgBrewKg'        => round($avgBrewKg),
        'releasedQty'      => (int)round($releasedQty),
        'skuCount'         => count($skuSet),
        'reactorsOccupied' => $reactorsOccupied,
        'reactorsTotal'    => $reactorsTotal,
        'reactorsFree'     => $reactorsFree,
        'awaitingTons'     => round($awaitingKg / 1000, 2),
        'awaitingCount'    => count($awaitingB),
    ],
], JSON_UNESCAPED_UNICODE);
