<?php
/** Local-only WordPress shim. No environment/configuration file or network is read. */
define('ABSPATH', __DIR__ . '/preview-root/');
define('OBJECT', 'OBJECT');
define('INRCY_TRIAL_SIGNUP_TOKEN', 'synthetic-local-token-never-valid-in-production');
define('CMPLZ_URL', 'https://cmp.example.invalid/');
define('CMPLZ_VERSION', 'synthetic-cmp');
$GLOBALS['basic_test_hooks'] = array();
$GLOBALS['basic_test_shortcodes'] = array();
$GLOBALS['basic_test_state'] = array();

function add_action($name, $callback, $priority = 10, $args = 1) { $GLOBALS['basic_test_hooks'][$name][$priority][] = $callback; }
function add_filter($name, $callback, $priority = 10, $args = 1) { add_action($name, $callback, $priority, $args); }
function has_action($name, $callback) { foreach (($GLOBALS['basic_test_hooks'][$name] ?? array()) as $priority => $callbacks) { foreach ($callbacks as $registered) { if ($registered === $callback) { return $priority; } } } return false; }
function do_action($name) { $args = array_slice(func_get_args(), 1); $hooks = $GLOBALS['basic_test_hooks'][$name] ?? array(); ksort($hooks); foreach ($hooks as $callbacks) { foreach ($callbacks as $callback) { call_user_func_array($callback, $args); } } }
function apply_filters($name, $value) { $args = array_slice(func_get_args(), 2); $hooks = $GLOBALS['basic_test_hooks'][$name] ?? array(); ksort($hooks); foreach ($hooks as $callbacks) { foreach ($callbacks as $callback) { $value = call_user_func_array($callback, array_merge(array($value), $args)); } } return $value; }
function add_shortcode($name, $callback) { $GLOBALS['basic_test_shortcodes'][$name] = $callback; }
function shortcode_exists($name) { return isset($GLOBALS['basic_test_shortcodes'][$name]); }
function has_shortcode($content, $name) { return (bool) preg_match('/\[' . preg_quote($name, '/') . '(?:\s|\])/', $content); }
function shortcode_parse_atts($text) { $attrs = array(); preg_match_all('/([a-z_]+)\s*=\s*(?:"([^"]*)"|\x27([^\x27]*)\x27)/', $text, $matches, PREG_SET_ORDER); foreach ($matches as $match) { $attrs[$match[1]] = $match[2] !== '' ? $match[2] : ($match[3] ?? ''); } return $attrs; }
function shortcode_atts($defaults, $attributes, $name = '') { return array_merge($defaults, array_intersect_key((array) $attributes, $defaults)); }
function do_shortcode($content) { return preg_replace_callback('/\[(\[?)([a-z_-]+)([^\]]*)\](\]?)/', function ($match) { if ($match[1] === '[' && $match[4] === ']') { return substr($match[0], 1, -1); } $callback = $GLOBALS['basic_test_shortcodes'][$match[2]] ?? null; return $callback ? call_user_func($callback, shortcode_parse_atts($match[3])) : $match[0]; }, $content); }
function esc_html($value) { return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function esc_attr($value) { return esc_html($value); }
function esc_url($value) { $value = (string) $value; return preg_match('/^(?:https?:|mailto:|tel:|\/|#)/i', $value) ? esc_attr($value) : ''; }
function esc_url_raw($value) { return filter_var($value, FILTER_VALIDATE_URL) ? $value : ''; }
function sanitize_text_field($value) { return trim(strip_tags((string) $value)); }
function sanitize_key($value) { return preg_replace('/[^a-z0-9_-]/', '', strtolower((string) $value)); }
function wp_unslash($value) { return is_string($value) ? stripslashes($value) : $value; }
function wp_kses_post($html) { $html = preg_replace('/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/i', '', $html); return strip_tags($html, '<h1><h2><h3><h4><p><strong><em><ul><ol><li><a><br><hr><div><span><table><thead><tbody><tr><th><td><section><article><nav><details><summary>'); }
function is_email($value) { return (bool) filter_var($value, FILTER_VALIDATE_EMAIL); }
function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
function wp_parse_url($value) { return parse_url($value); }
function maybe_serialize($value) { return is_array($value) || is_object($value) ? serialize($value) : $value; }
function wp_cache_delete($key, $group = '') { return true; }
function wp_generate_uuid4() { return 'synthetic-' . bin2hex(random_bytes(8)); }
class BasicTestDatabase {
    public $options = 'synthetic_options';
    public function prepare($sql) { return array('sql' => $sql, 'args' => array_slice(func_get_args(), 1)); }
    public function query($query) {
        if (is_array($query) && $query['sql'] === "INSERT IGNORE INTO synthetic_options (option_name, option_value, autoload) VALUES (%s, %s, 'no')" && $query['args'][0] === INRCY_BASIC_SITE_CREATION_LOCK) {
            $name = $query['args'][0];
            if (array_key_exists($name, $GLOBALS['basic_test_state']['options'])) { return 0; }
            $GLOBALS['basic_test_state']['options'][$name] = $query['args'][1]; return 1;
        }
        if (!is_array($query) || $query['sql'] !== 'DELETE FROM synthetic_options WHERE option_name = %s AND option_value = %s' || $query['args'][0] !== INRCY_BASIC_SITE_CREATION_LOCK) { throw new Exception('Unexpected synthetic database query.'); }
        $name = $query['args'][0]; $expected = $query['args'][1];
        if (array_key_exists($name, $GLOBALS['basic_test_state']['options']) && maybe_serialize($GLOBALS['basic_test_state']['options'][$name]) === $expected) { unset($GLOBALS['basic_test_state']['options'][$name]); return 1; }
        return 0;
    }
    public function get_var($query) {
        if (!is_array($query) || $query['sql'] !== 'SELECT option_value FROM synthetic_options WHERE option_name = %s' || $query['args'][0] !== INRCY_BASIC_SITE_CREATION_LOCK) { throw new Exception('Unexpected synthetic database read.'); }
        return $GLOBALS['basic_test_state']['options'][$query['args'][0]] ?? null;
    }
}
$GLOBALS['wpdb'] = new BasicTestDatabase();
function is_wp_error($value) { return $value instanceof BasicTestError; }
class BasicTestError { public $message; public function __construct($message) { $this->message = $message; } }
class BasicTestJsonResponse extends Exception { public $payload; public $status; public function __construct($payload, $status) { parent::__construct('Synthetic JSON response'); $this->payload = $payload; $this->status = $status; } }
function wp_die($message, $title = '', $args = array()) { throw new Exception(strip_tags($message)); }
function wp_send_json_error($value, $status = 200) { throw new BasicTestJsonResponse(array('success' => false, 'data' => $value), $status); }
function wp_send_json_success($value, $status = 200) { throw new BasicTestJsonResponse(array('success' => true, 'data' => $value), $status); }
function get_option($key, $default = false) { return array_key_exists($key, $GLOBALS['basic_test_state']['options']) ? $GLOBALS['basic_test_state']['options'][$key] : $default; }
function update_option($key, $value, $autoload = null) { $GLOBALS['basic_test_state']['options'][$key] = $value; $GLOBALS['basic_test_state']['optionWrites'][] = array('key' => $key, 'autoload' => $autoload); return true; }
function add_option($key, $value, $deprecated = '', $autoload = true) { if (array_key_exists($key, $GLOBALS['basic_test_state']['options'])) { return false; } return update_option($key, $value, $autoload); }
function delete_option($key) { unset($GLOBALS['basic_test_state']['options'][$key]); return true; }
function get_post($id = null) { $id = $id ? (is_object($id) ? $id->ID : $id) : $GLOBALS['basic_test_state']['currentId']; return $GLOBALS['basic_test_state']['posts'][(int) $id] ?? null; }
function get_the_title($post) { return $post->post_title ?? ''; }
function get_the_excerpt($post) { return $post->post_excerpt ?? ''; }
function get_the_date($format, $post) { return '2026-11-20'; }
function get_the_post_thumbnail($post, $size, $attrs = array()) { return ''; }
function wp_strip_all_tags($value) { return strip_tags($value); }
function wpautop($value) { return '<p>' . $value . '</p>'; }
function strip_shortcodes($value) { return preg_replace('/\[[^\]]+\]/', '', $value); }
function get_category_by_slug($slug) { return $slug === 'publication' ? (object) array('term_id' => 90, 'name' => 'Publication', 'slug' => 'publication') : false; }
class WP_Query {
    public $posts = array();
    public $max_num_pages = 1;
    public function __construct($args) {
        if (($args['post_type'] ?? null) !== 'post' || ($args['post_status'] ?? null) !== 'publish' || ($args['has_password'] ?? null) !== false) { throw new Exception('Editorial listing requested non-public posts.'); }
        if (isset($args['cat'])) {
            $this->max_num_pages = 3;
            foreach (($GLOBALS['basic_test_state']['editorialPosts'] ?? array()) as $entry) {
                if (($entry['category'] ?? null) === $args['cat'] && ($entry['fixturePage'] ?? 1) === $args['paged']) { $this->posts[] = get_post($entry['ID']); }
            }
        }
    }
}
function get_page_uri($post) { $post = get_post($post); return !$post ? '' : ($post->post_parent ? get_page_uri($post->post_parent) . '/' : '') . $post->post_name; }
function get_page_by_path($path, $output = OBJECT, $type = 'page') { foreach ($GLOBALS['basic_test_state']['posts'] as $post) { if (get_page_uri($post) === trim($path, '/')) { return $post; } } return null; }
function wp_insert_post($input, $error = false) { $id = count($GLOBALS['basic_test_state']['posts']) + 20000; $GLOBALS['basic_test_state']['posts'][$id] = (object) array_merge(array('ID' => $id, 'post_parent' => 0, 'post_status' => 'draft', 'post_content' => ''), $input); $GLOBALS['basic_test_state']['inserts'][] = $GLOBALS['basic_test_state']['posts'][$id]; return $id; }
function is_singular($type = '') { return true; }
function is_admin() { return false; }
function is_user_logged_in() { return !empty($GLOBALS['basic_test_state']['admin']); }
function current_user_can($capability) { return !empty($GLOBALS['basic_test_state']['admin']); }
function is_preview() { return !empty($GLOBALS['basic_test_state']['preview']); }
function wp_create_nonce($action) { return 'synthetic-' . $action; }
function wp_verify_nonce($nonce, $action) { return $nonce === wp_create_nonce($action); }
function check_admin_referer($action) { $nonce = $_POST['_wpnonce'] ?? ($_GET['_wpnonce'] ?? ''); if (!is_string($nonce) || !wp_verify_nonce($nonce, $action)) { throw new Exception('Synthetic admin nonce rejected'); } return true; }
function check_ajax_referer($action, $key, $die = true) { return isset($_POST[$key]) && wp_verify_nonce($_POST[$key], $action); }
function home_url($path = '') { return rtrim($GLOBALS['basic_test_state']['origin'], '/') . '/' . ltrim($path, '/'); }
function get_permalink($post = null) { return home_url('/' . get_page_uri($post) . '/'); }
function admin_url($path = '') { return home_url('/wp-admin/' . $path); }
function plugin_dir_url($file) { return home_url('/wp-content/plugins/inrcy-basic-signup/'); }
function add_query_arg($values, $url) { $separator = strpos($url, '?') === false ? '?' : '&'; return $url . $separator . http_build_query($values); }
function get_edit_post_link($id, $context = '') { return admin_url('post.php?post=' . (int) $id . '&action=edit'); }
function wp_safe_redirect($url) { $GLOBALS['basic_test_state']['redirect'] = $url; }
function nocache_headers() { $GLOBALS['basic_test_state']['noCache'] = true; }
function status_header($status) { $GLOBALS['basic_test_state']['httpStatus'] = $status; }
function disabled($checked, $current = true, $echo = true) { $result = $checked == $current ? 'disabled="disabled"' : ''; if ($echo) { echo $result; } return $result; }
function checked($checked, $current = true, $echo = true) { $result = $checked == $current ? 'checked="checked"' : ''; if ($echo) { echo $result; } return $result; }
function add_options_page() {}
function wp_nonce_field($action) { echo '<input type="hidden" name="_wpnonce" value="' . esc_attr(wp_create_nonce($action)) . '">'; }
function submit_button($text, $type = '') { echo '<button type="submit">' . esc_html($text) . '</button>'; }
function wp_enqueue_style($handle, $src, $dependencies = array(), $version = '') { $GLOBALS['basic_test_state']['styles'][$handle] = $src . '?ver=' . $version; }
function wp_style_is($handle, $status = 'enqueued') { return isset($GLOBALS['basic_test_state']['styles'][$handle]); }
function cmplz_get_option($name) { return $name === 'use_document_css' && empty($GLOBALS['basic_test_state']['cmpGrid']); }
class BasicTestCmpDocument { public function inline_styles() { echo '<style id="basic-test-cmp-inline">/* synthetic vendor custom styling */</style>'; } }
class COMPLIANZ { public static $document; }
COMPLIANZ::$document = new BasicTestCmpDocument();
function wp_enqueue_script($handle, $src, $dependencies = array(), $version = '', $footer = false) { $GLOBALS['basic_test_state']['scripts'][$handle] = $src . '?ver=' . $version; }
function wp_dequeue_script($handle) { unset($GLOBALS['basic_test_state']['scripts'][$handle]); }
function wp_dequeue_style($handle) { unset($GLOBALS['basic_test_state']['styles'][$handle]); }
function wp_localize_script($handle, $name, $value) { foreach ($value as $key => $entry) { if (is_bool($entry)) { $value[$key] = $entry ? '1' : ''; } } $GLOBALS['basic_test_state']['config'][$handle] = array($name, $value); }
function language_attributes() { echo 'lang="fr"'; }
function bloginfo($name) { if ($name === 'charset') { echo 'UTF-8'; } }
function body_class($class) { echo 'class="' . esc_attr(implode(' ', apply_filters('body_class', array('elementor-kit-1363', $class)))) . '"'; }
function wp_body_open() {}
function have_posts() { if (empty($GLOBALS['basic_test_state']['looped'])) { return true; } return false; }
function the_post() { $GLOBALS['basic_test_state']['looped'] = true; }
function the_content() { echo do_shortcode(get_post()->post_content); }
function wp_head() {
    echo '<title>' . esc_html(apply_filters('pre_get_document_title', 'Aperçu local Basique')) . '</title>';
    foreach ($GLOBALS['basic_test_state']['styles'] as $source) { echo '<link rel="stylesheet" href="' . esc_url($source) . '">'; }
    do_action('wp_head');
    $robots = apply_filters('wp_robots', array()); if (!empty($robots['noindex'])) { echo '<meta name="robots" content="noindex,nofollow">'; }
    if (!empty($GLOBALS['basic_test_state']['collision'])) { echo '<style>body.elementor-kit-1363{color:white;background:transparent;font-family:Georgia,serif;font-size:21px;line-height:1.9}</style>'; }
}
function wp_footer() {
    $consent = !empty($GLOBALS['basic_test_state']['marketingConsent']) ? 'true' : 'false';
    echo '<script>window.cmplz_has_consent=function(){return ' . $consent . ';};window.__basicPreviewPixel=[];window.fbq=function(){window.__basicPreviewPixel.push(Array.from(arguments));};window.jQuery=function(target){return{on:function(name,callback){target.addEventListener(name.split(".")[0],function(event){callback(event,...(event.detail||[]));});return this;},off:function(){return this;},trigger:function(name,args){target.dispatchEvent(new CustomEvent(name,{bubbles:true,detail:args||[]}));return this;}}};</script>';
    echo '<script src="' . esc_url(home_url('/__basic-preview/meta-attribution.js')) . '"></script>';
    foreach ($GLOBALS['basic_test_state']['scripts'] as $handle => $source) {
        if (isset($GLOBALS['basic_test_state']['config'][$handle])) { $config = $GLOBALS['basic_test_state']['config'][$handle]; echo '<script>window.' . $config[0] . '=' . wp_json_encode($config[1], JSON_HEX_TAG | JSON_HEX_AMP) . ';</script>'; }
        echo '<script src="' . esc_url($source) . '"></script>';
    }
}
function wp_remote_post($url, $options) {
    $GLOBALS['basic_test_state']['remoteCalls'][] = array('url' => $url, 'options' => $options);
    if (empty($GLOBALS['basic_test_state']['mockRemote'])) { throw new Exception('All real HTTP calls are blocked in the preview runtime.'); }
    return $GLOBALS['basic_test_state']['mockRemote'];
}
function wp_remote_retrieve_response_code($response) { return $response['response']['code'] ?? 0; }
function wp_remote_retrieve_body($response) { return $response['body'] ?? ''; }

require dirname(__DIR__, 2) . '/ops/wordpress-basic-signup/inrcy-basic-signup.php';
add_shortcode('inrcy_directory', function () {
    $url = esc_url(get_permalink());
    return '<div class="inrcy-directory"><form class="inrcy-directory__filters" method="get" action="' . $url . '" role="search"><label>Recherche <input name="q"></label></form><a href="' . $url . '?inrcy_page=2&amp;ville=Bruxelles">Page 2</a><a href="https://app.inrcy.com/badge/synthetic-public-business">Ouvrir le badge</a></div>';
});
add_shortcode('cmplz-document', function ($attributes) {
    $GLOBALS['basic_test_state']['cookieShortcode'] = $attributes;
    return '<div id="cmplz-document" class="cmplz-document cookie-statement cmplz-document-eu"><h2>Préférences de cookies de test</h2><p><a href="https://inrcy.com/">Site iNrCy</a> <a href="https://www.inrcy.com/politique-de-confidentialite/">Confidentialité</a> <a href="https://inrcy.com/politique-de-cookies-ue/">Cookies</a></p><p><a href="#cookie-preferences">Aller aux préférences</a> <a href="https://provider.example.invalid/privacy">Fournisseur externe</a></p><div id="cmplz-cookies-overview"></div><div id="cmplz-manage-consent-container"><button type="button" data-cookie-choice="deny">Refuser</button><button type="button" data-cookie-choice="allow">Accepter</button></div><h3 id="cookie-preferences">Vos préférences de test</h3></div>';
});

function basic_test_reset($view = 'home', $options = array()) {
    $_GET = $options['query'] ?? array(); $_POST = array(); $_SERVER['REQUEST_METHOD'] = 'GET';
    $pages = inrcy_basic_site_pages();
    if (!isset($pages[$view])) { throw new Exception('Unknown preview view.'); }
    $root = (object) array('ID' => 12815, 'post_name' => 'basique', 'post_parent' => 0, 'post_status' => 'publish', 'post_content' => '[inrcy_basic_signup]');
    $GLOBALS['basic_test_state'] = array_merge(array('origin' => 'https://inrcy.com', 'posts' => array(12815 => $root), 'currentId' => 12815,
        'options' => array(INRCY_BASIC_SIGNUP_PAGE_OPTION => 12815, INRCY_BASIC_SITE_ENABLED_OPTION => '1'), 'admin' => false, 'preview' => false,
        'styles' => array(), 'scripts' => array(), 'config' => array(), 'inserts' => array(), 'optionWrites' => array(), 'remoteCalls' => array(),
        'looped' => false, 'collision' => true, 'legalFixture' => true, 'useWorkLegal' => false, 'marketingConsent' => false), $options);
    if (!empty($options['cmpMissing'])) { unset($GLOBALS['basic_test_shortcodes']['cmplz-document']); }
    if (!empty($options['rootPassword'])) { $root->post_password = $options['rootPassword']; }
    if (isset($options['rootContent'])) { $root->post_content = $options['rootContent']; }
    foreach (($options['editorialPosts'] ?? array()) as $post) {
        $GLOBALS['basic_test_state']['posts'][(int) $post['ID']] = (object) array_merge(array('post_type' => 'post', 'post_password' => '', 'post_parent' => 0), $post);
    }
    if ($view !== 'home') { $id = 12900 + array_search($view, array_keys($pages), true); $GLOBALS['basic_test_state']['posts'][$id] = (object) array('ID' => $id, 'post_name' => $pages[$view]['slug'], 'post_parent' => 12815, 'post_status' => 'draft', 'post_content' => '[inrcy_basic_page view="' . $view . '"]'); $GLOBALS['basic_test_state']['currentId'] = $id; }
    foreach (($options['children'] ?? array()) as $key => $settings) {
        if (!isset($pages[$key]) || $key === 'home') { throw new Exception('Unknown fixture child.'); }
        $id = 13000 + array_search($key, array_keys($pages), true);
        $GLOBALS['basic_test_state']['posts'][$id] = (object) array('ID' => $id, 'post_name' => $pages[$key]['slug'], 'post_parent' => 12815, 'post_status' => $settings['status'] ?? 'draft', 'post_password' => $settings['password'] ?? '', 'post_content' => $settings['content'] ?? '[inrcy_basic_page view="' . $key . '"]');
    }
}

add_filter('inrcy_basic_site_legal_bundle', function ($bundle) {
    if (!empty($GLOBALS['basic_test_state']['legalUnavailable'])) { return array('documents' => array(), 'consent_html' => ''); }
    if (empty($GLOBALS['basic_test_state']['legalFixture'])) { return $bundle; }
    if (!empty($bundle['consent_html']) && !empty($bundle['documents']['terms']['reviewed']) && !empty($bundle['documents']['privacy']['reviewed']) && !empty($bundle['documents']['legal']['reviewed'])) { return $bundle; }
    $files = array('terms' => '01-cga-abonnement-direct.html', 'privacy' => '02-confidentialite-abonnement-direct.html', 'legal' => '03-mentions-legales-abonnement-direct.html');
    foreach ($files as $key => $name) {
        $path = dirname(__DIR__, 3) . '/basic-site-legal/' . $name;
        $html = !empty($GLOBALS['basic_test_state']['useWorkLegal']) && is_file($path) ? file_get_contents($path) : '<h2>Document synthétique de test</h2><p>Ce contenu de test n’a aucune portée juridique.</p>';
        $bundle['documents'][$key] = array('title' => inrcy_basic_site_pages()[$key]['heading'], 'html' => $html, 'reviewed' => true);
    }
    $consent_path = dirname(__DIR__, 3) . '/basic-site-legal/consentement.html';
    $bundle['consent_html'] = !empty($GLOBALS['basic_test_state']['useWorkLegal']) && is_file($consent_path) ? file_get_contents($consent_path) : 'J’accepte les <a href="/basique/conditions/">conditions de test</a> et consulte la <a href="/basique/confidentialite/">confidentialité de test</a>.';
    return $bundle;
});

function basic_test_render_document($view = 'home', $options = array()) {
    basic_test_reset($view, $options);
    do_action('template_redirect');
    do_action('wp_enqueue_scripts');
    $template = apply_filters('template_include', dirname(__DIR__, 2) . '/ops/wordpress-basic-signup/basic-page.php');
    ob_start(); include $template; return ob_get_clean();
}

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    $mode = $argv[1] ?? 'render'; $view = $argv[2] ?? 'home'; $options = json_decode($argv[3] ?? '{}', true) ?: array();
    if ($mode === 'render') { echo basic_test_render_document($view, $options); }
    elseif ($mode === 'prepare') {
        basic_test_reset('home', $options); $original = clone get_post(12815);
        $first = inrcy_basic_site_prepare_pages(); $second = inrcy_basic_site_prepare_pages();
        echo wp_json_encode(array('first' => $first, 'second' => $second, 'inserts' => $GLOBALS['basic_test_state']['inserts'], 'rootUnchanged' => get_post(12815) == $original, 'canEnable' => (bool) inrcy_basic_site_can_enable(), 'options' => $GLOBALS['basic_test_state']['options']));
    } elseif ($mode === 'enable') {
        basic_test_reset('home', $options); echo wp_json_encode(array('canEnable' => (bool) inrcy_basic_site_can_enable()));
    } elseif ($mode === 'locking') {
        basic_test_reset('home', $options); $first = inrcy_basic_site_acquire_lock(); $second = inrcy_basic_site_acquire_lock();
        $replacement = (string) time() . ':replacement-worker'; $GLOBALS['basic_test_state']['options'][INRCY_BASIC_SITE_CREATION_LOCK] = $replacement;
        $releasedWrong = inrcy_basic_site_release_lock($first); $preserved = get_option(INRCY_BASIC_SITE_CREATION_LOCK) === $replacement;
        $GLOBALS['basic_test_state']['options'][INRCY_BASIC_SITE_CREATION_LOCK] = (string) (time() - INRCY_BASIC_SITE_CREATION_LOCK_TTL - 1) . ':crashed-worker';
        $recovered = inrcy_basic_site_acquire_lock();
        echo wp_json_encode(array('firstAcquired' => is_string($first), 'secondRejected' => $second === false, 'wrongReleaseRejected' => !$releasedWrong, 'replacementPreserved' => $preserved, 'staleRecovered' => is_string($recovered)));
    } elseif ($mode === 'seo') {
        basic_test_reset($view, $options); $old = 'Ancienne offre générale de test';
        echo wp_json_encode(array('meta' => inrcy_basic_site_metadata(), 'schema' => inrcy_basic_site_schema(),
            'rankTitle' => apply_filters('rank_math/frontend/title', $old), 'rankDescription' => apply_filters('rank_math/frontend/description', $old),
            'rankSocial' => apply_filters('rank_math/opengraph/facebook/og_description', $old), 'rankCanonical' => apply_filters('rank_math/frontend/canonical', 'https://inrcy.com/'),
            'rankSchema' => apply_filters('rank_math/json_ld', array('old' => $old))));
    } elseif ($mode === 'view') {
        basic_test_reset($view, $options); $_GET = $options['query'] ?? array(); echo wp_json_encode(array('view' => inrcy_basic_site_view(), 'preview' => (bool) inrcy_basic_site_preview()));
    } elseif ($mode === 'catalogue') {
        basic_test_reset($view, $options); echo wp_json_encode(inrcy_basic_site_catalogue());
    } elseif ($mode === 'gate') {
        basic_test_reset($view, $options); do_action('template_redirect');
        echo wp_json_encode(array('blocked' => inrcy_basic_site_child_blocked(), 'status' => $GLOBALS['basic_test_state']['httpStatus'] ?? 200,
            'noCache' => !empty($GLOBALS['basic_test_state']['noCache']), 'shortcode' => do_shortcode('[inrcy_basic_page view="signup"]')));
    } elseif ($mode === 'submit') {
        basic_test_reset('signup', $options); $_SERVER['REQUEST_METHOD'] = 'POST'; $_POST = $options['post'] ?? array();
        try { inrcy_basic_signup_submit(); } catch (BasicTestJsonResponse $response) { echo wp_json_encode(array('status' => $response->status, 'response' => $response->payload, 'remoteCalls' => $GLOBALS['basic_test_state']['remoteCalls'])); }
    } elseif ($mode === 'admin-denial') {
        basic_test_reset('home', $options); $errors = array();
        foreach (array('admin_post_inrcy_basic_site_prepare', 'admin_post_inrcy_basic_site_enable') as $hook) {
            try { do_action($hook); } catch (Exception $error) { $errors[$hook] = $error->getMessage(); }
        }
        echo wp_json_encode(array('errors' => $errors, 'inserts' => count($GLOBALS['basic_test_state']['inserts']), 'optionWrites' => count($GLOBALS['basic_test_state']['optionWrites'])));
    } else { throw new Exception('Unknown fixture action.'); }
}
