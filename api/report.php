<?php
// ПУБЛИЧНЫЙ read-only эндпоинт для сводного дашборда портала
// (ТЗ, лист 7, чек-лист п.4: портал получает данные проекта только отсюда,
// прямого доступа к БД у портала нет). Отдаёт только обезличенные агрегаты —
// никаких имён, логинов, рецептур и журналов.
require_once __DIR__ . '/storage.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=60');

$row = pdo()->query('SELECT data, rev, updated_at FROM app_state WHERE id = 1')->fetch();
if (!$row) { echo json_encode(['project' => 'manufacture', 'ready' => false]); exit; }

$state = json_decode($row['data'], true) ?: [];

$byStatus = [];
foreach (($state['batches'] ?? []) as $b) {
    $s = (string)($b['status'] ?? 'unknown');
    $byStatus[$s] = ($byStatus[$s] ?? 0) + 1;
}

echo json_encode([
    'project'   => 'manufacture',
    'ready'     => true,
    'updatedAt' => $row['updated_at'],
    'rev'       => (int)$row['rev'],
    'batches'   => ['total' => count($state['batches'] ?? []), 'byStatus' => $byStatus],
    'recipes'   => ['total' => count($state['recipes'] ?? [])],
    'clients'   => ['total' => count($state['clients'] ?? [])],
    'requests'  => ['total' => count($state['requests'] ?? [])],
], JSON_UNESCAPED_UNICODE);
