<?php
/** php -n -S 127.0.0.1:8789 -t preview-root preview-router.php */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') { http_response_code(405); header('Allow: GET'); echo 'POST and other mutations are blocked in this local preview.'; return; }
$authority = $_SERVER['HTTP_HOST'] ?? '';
if (!preg_match('/^127\.0\.0\.1:([0-9]{1,5})$/D', $authority, $host_match) || (int) $host_match[1] < 1024 || (int) $host_match[1] > 65535) { http_response_code(400); echo 'Only the explicit local preview address is accepted.'; return; }
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$plugin = dirname(__DIR__, 2) . '/ops/wordpress-basic-signup/';
$assets = array('basic-access.css', 'basic-access.js', 'basic-signup.css', 'basic-signup.js', 'basic-site.css', 'basic-home-native.css', 'basic-site.js', 'basic-meta-attribution.js', 'logo-inrcy-transparent.png');
foreach ($assets as $asset) {
    if ($path === '/wp-content/plugins/inrcy-basic-signup/' . $asset) { header('Content-Type: ' . (substr($asset, -4) === '.css' ? 'text/css' : (substr($asset, -3) === '.js' ? 'text/javascript' : 'image/png'))); readfile($plugin . $asset); return; }
}
if ($path === '/__basic-preview/meta-attribution.js') { header('Content-Type: text/javascript'); readfile(dirname(__DIR__, 2) . '/ops/wordpress-meta-attribution/inrcy-meta-attribution.js'); return; }
if ($path === '/favicon.ico') { http_response_code(204); return; }
if ($path === '/') { header('Location: /basique/', true, 302); return; }
require __DIR__ . '/wp-runtime.php';
$routes = array(); foreach (inrcy_basic_site_pages() as $view => $page) { $routes['/basique/' . ($page['slug'] ? $page['slug'] . '/' : '')] = $view; }
if (!isset($routes[$path])) { http_response_code(404); echo 'Unknown local preview route.'; return; }
header('Cache-Control: no-store'); header('Content-Type: text/html; charset=UTF-8'); header('X-Robots-Tag: noindex, nofollow');
echo basic_test_render_document($routes[$path], array('origin' => 'http://' . $authority, 'useWorkLegal' => true, 'query' => $_GET));
