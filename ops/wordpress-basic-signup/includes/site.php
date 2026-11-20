<?php
if (!defined('ABSPATH')) { exit; }
define('INRCY_BASIC_SITE_ENABLED_OPTION', 'inrcy_basic_site_enabled');
define('INRCY_BASIC_SITE_PAGES_OPTION', 'inrcy_basic_site_page_ids');
define('INRCY_BASIC_SITE_CREATION_LOCK', 'inrcy_basic_site_creation_lock');
define('INRCY_BASIC_SITE_CREATION_LOCK_TTL', 300);

function inrcy_basic_site_pages() {
    return array(
        'home' => array('slug' => '', 'title' => 'Accueil', 'heading' => 'iNrCy Basique'),
        'blog' => array('slug' => 'blog', 'title' => 'Blog', 'heading' => 'Notre Blog'),
        'directory' => array('slug' => 'annuaire', 'title' => 'iNr’Annuaire', 'heading' => 'iNr’Annuaire'),
        'features' => array('slug' => 'fonctionnalites', 'title' => 'Fonctionnalités', 'heading' => 'Les outils du pack Basique'),
        'pricing' => array('slug' => 'tarif', 'title' => 'Tarif', 'heading' => 'Un pack clair pour votre activité'),
        'faq' => array('slug' => 'faq', 'title' => 'FAQ', 'heading' => 'Vos questions, simplement'),
        'signup' => array('slug' => 'inscription', 'title' => 'Inscription', 'heading' => 'Créons votre compte iNrCy'),
        'contact' => array('slug' => 'contact', 'title' => 'Contact', 'heading' => 'Parlons de votre activité'),
        'terms' => array('slug' => 'conditions', 'title' => 'Conditions d’abonnement', 'heading' => 'Conditions d’abonnement'),
        'privacy' => array('slug' => 'confidentialite', 'title' => 'Confidentialité', 'heading' => 'Politique de confidentialité'),
        'cookies' => array('slug' => 'cookies', 'title' => 'Cookies', 'heading' => 'Cookies et préférences'),
        'legal' => array('slug' => 'mentions-legales', 'title' => 'Mentions légales', 'heading' => 'Mentions légales'),
    );
}

function inrcy_basic_site_preview() {
    if (!is_user_logged_in() || !current_user_can('manage_options')) { return false; }
    if (is_preview()) { return true; }
    return isset($_GET['inrcy_basic_preview'], $_GET['_wpnonce']) && $_GET['inrcy_basic_preview'] === '1' && is_string($_GET['_wpnonce'])
        && wp_verify_nonce(sanitize_text_field(wp_unslash($_GET['_wpnonce'])), 'inrcy_basic_site_preview');
}

function inrcy_basic_site_enabled() {
    return get_option(INRCY_BASIC_SITE_ENABLED_OPTION, '0') === '1';
}

function inrcy_basic_site_view() {
    $pages = inrcy_basic_site_pages();
    $post = get_post();
    if (!$post) { return 'home'; }
    if (inrcy_basic_site_preview() && isset($_GET['inrcy_basic_view']) && is_string($_GET['inrcy_basic_view']) && isset($pages[$_GET['inrcy_basic_view']])) {
        return (string) $_GET['inrcy_basic_view'];
    }
    return inrcy_basic_site_content_view($post->post_content) ?: 'home';
}

function inrcy_basic_site_content_view($content) {
    if (preg_match('/(?<!\[)\[inrcy_basic_page\b([^\]]*)\](?!\])/', (string) $content, $matches)) {
        $attributes = shortcode_parse_atts($matches[1]);
        $view = is_array($attributes) ? ($attributes['view'] ?? 'home') : 'home';
        $pages = inrcy_basic_site_pages();
        return is_string($view) && isset($pages[$view]) ? $view : null;
    }
    return null;
}

function inrcy_basic_site_has_legacy_shortcode($content) {
    return (bool) preg_match('/(?<!\[)\[inrcy_basic_signup(?:\s[^\]]*)?\](?!\])/', (string) $content);
}

function inrcy_basic_site_rendered() {
    if (!inrcy_basic_signup_is_page()) { return false; }
    $post = get_post();
    return inrcy_basic_site_enabled() || inrcy_basic_site_preview();
}

function inrcy_basic_site_child_blocked() {
    $post = get_post();
    return inrcy_basic_signup_is_page() && $post && has_shortcode((string) $post->post_content, 'inrcy_basic_page')
        && !inrcy_basic_site_enabled() && !inrcy_basic_site_preview();
}

function inrcy_basic_site_unavailable_message() {
    return '<p role="status">Cet espace est momentanément indisponible.</p>';
}

add_action('template_redirect', function () {
    if (!inrcy_basic_site_child_blocked()) { return; }
    status_header(503);
    nocache_headers();
    header('X-Robots-Tag: noindex, nofollow', true);
}, 0);
add_filter('template_include', function ($template) {
    return inrcy_basic_site_child_blocked() ? __DIR__ . '/../templates/unavailable.php' : $template;
}, 999);

function inrcy_basic_site_url($view = 'home', $preview = null) {
    $pages = inrcy_basic_site_pages();
    $view = isset($pages[$view]) ? $view : 'home';
    if ($preview === null) { $preview = inrcy_basic_site_preview(); }
    if ($preview) {
        return add_query_arg(array('inrcy_basic_preview' => '1', 'inrcy_basic_view' => $view, '_wpnonce' => wp_create_nonce('inrcy_basic_site_preview')), home_url('/basique/'));
    }
    return home_url('/basique/' . ($pages[$view]['slug'] !== '' ? $pages[$view]['slug'] . '/' : ''));
}

function inrcy_basic_tools() {
    return array(
        'booster' => 'Booster', 'inr-studio' => 'iNr’Studio', 'inr-ads' => 'iNr’ADS',
        'inr-agent' => 'iNr’Agent', 'inr-calendar' => 'iNr’Calendar', 'inr-badge' => 'iNr’Badge',
        'emailing' => 'Emailing', 'reputation' => 'Réputation',
    );
}

function inrcy_basic_current_tool() {
    $tool = $_GET['outil'] ?? null;
    return is_string($tool) && isset(inrcy_basic_tools()[$tool]) ? $tool : null;
}

function inrcy_basic_tool_url($slug, $preview = null) {
    return add_query_arg(array('outil' => $slug), inrcy_basic_site_url('features', $preview));
}

function inrcy_basic_site_login_url() {
    return 'https://app.inrcy.com/login?entry=basique';
}

function inrcy_basic_site_asset_url($name) {
    return plugin_dir_url(dirname(__DIR__) . '/inrcy-basic-signup.php') . $name;
}

// Run before the unchanged global attribution snippet; its shared guard prevents
// a second initializer. This dedicated copy waits for DOM/CMP readiness itself.
add_action('wp_head', function () {
    if (!inrcy_basic_site_rendered()) { return; }
    echo '<script src="' . esc_url(inrcy_basic_site_asset_url('basic-meta-attribution.js') . '?ver=' . INRCY_BASIC_SIGNUP_VERSION) . '"></script>';
}, -1000);

/** The wrapper shortcode is invisible to Complianz's post_content scan.
 * Reuse its documented-in-source document CSS without changing page metadata,
 * policy IDs, consent settings, or the vendor's global banner initializer.
 */
add_action('wp_enqueue_scripts', function () {
    if (!inrcy_basic_site_rendered() || inrcy_basic_site_view() !== 'cookies' || !defined('CMPLZ_URL') || !function_exists('cmplz_get_option')) { return; }
    $handle = cmplz_get_option('use_document_css') ? 'cmplz-document' : 'cmplz-document-grid';
    $min = defined('SCRIPT_DEBUG') && SCRIPT_DEBUG ? '' : '.min';
    $file = ($handle === 'cmplz-document' ? 'document' : 'document-grid') . $min . '.css';
    if (!wp_style_is($handle, 'enqueued')) { wp_enqueue_style($handle, CMPLZ_URL . 'assets/css/' . $file, array(), defined('CMPLZ_VERSION') ? CMPLZ_VERSION : INRCY_BASIC_SIGNUP_VERSION); }
    if (class_exists('COMPLIANZ') && isset(COMPLIANZ::$document) && is_callable(array(COMPLIANZ::$document, 'inline_styles'))
        && has_action('wp_head', array(COMPLIANZ::$document, 'inline_styles')) === false) {
        add_action('wp_head', array(COMPLIANZ::$document, 'inline_styles'), 100);
    }
}, 101);
// Ask the native directory to enqueue the exact CSS it uses for its public page.
add_action('wp_enqueue_scripts', function () {
    if (!inrcy_basic_site_rendered() || inrcy_basic_site_view() !== 'directory' || !function_exists('inrcy_directory_enqueue_styles')) { return; }
    $source = get_page_by_path('annuaire', OBJECT, 'page');
    if (!$source || $source->post_status !== 'publish' || !empty($source->post_password)) { return; }
    $current = $GLOBALS['post'];
    try {
        $GLOBALS['post'] = $source;
        inrcy_directory_enqueue_styles();
    } finally {
        $GLOBALS['post'] = $current;
    }
}, 101);
add_filter('body_class', function ($classes) {
    if (inrcy_basic_site_rendered() && inrcy_basic_site_view() === 'directory') { $classes[] = 'inrcy-directory-page'; }
    if (inrcy_basic_site_rendered() && inrcy_basic_site_view() === 'cookies' && !in_array('cmplz-document', $classes, true)) { $classes[] = 'cmplz-document'; }
    return $classes;
});

/** Rebase only known iNrCy document destinations; policy text and controls stay intact. */
function inrcy_basic_site_confine_document_links($html) {
    $routes = array('/' => 'home', '/nos-packs' => 'pricing', '/inscription' => 'signup', '/s-inscrire' => 'signup', '/contact' => 'contact',
        '/annuaire' => 'directory', '/blog' => 'blog', '/blog-conseils-generateur' => 'blog', '/nos-outils' => 'features', '/faq' => 'faq',
        '/politique-de-cookies-ue' => 'cookies', '/politique-de-confidentialite' => 'privacy', '/cga-conditions-generales-dabonnement' => 'terms', '/mentions-legales' => 'legal');
    if (inrcy_basic_site_preview()) {
        foreach (inrcy_basic_site_pages() as $view => $page) { $routes['/basique' . ($page['slug'] !== '' ? '/' . $page['slug'] : '')] = $view; }
    }
    return preg_replace_callback('/(?<![\w:-])(href|action)\s*=\s*(["\x27])([^"\x27]*)\2/i', function ($match) use ($routes) {
        $url = html_entity_decode($match[3], ENT_QUOTES, 'UTF-8');
        if ($url === '' || $url[0] === '#') { return $match[0]; }
        $parts = wp_parse_url($url);
        if (!is_array($parts)) { return $match[0]; }
        if (isset($parts['scheme']) && !in_array(strtolower($parts['scheme']), array('http', 'https'), true)) { return $match[0]; }
        if (isset($parts['host']) && !in_array(strtolower($parts['host']), array('inrcy.com', 'www.inrcy.com'), true)) { return $match[0]; }
        $path = rtrim((string) ($parts['path'] ?? ''), '/') ?: '/';
        if (!isset($routes[$path])) { return $match[0]; }
        $destination = inrcy_basic_site_url($routes[$path]);
        if (!empty($parts['query'])) { $destination .= (strpos($destination, '?') === false ? '?' : '&') . $parts['query']; }
        if (isset($parts['fragment'])) { $destination .= '#' . $parts['fragment']; }
        return $match[1] . '=' . $match[2] . esc_url($destination) . $match[2];
    }, (string) $html);
}

/** Compare-and-delete prevents a stale worker from removing a newer lock. */
function inrcy_basic_site_release_lock($expected) {
    global $wpdb;
    $deleted = $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s", INRCY_BASIC_SITE_CREATION_LOCK, maybe_serialize($expected)));
    if ($deleted === 1) { wp_cache_delete(INRCY_BASIC_SITE_CREATION_LOCK, 'options'); wp_cache_delete('notoptions', 'options'); }
    return $deleted === 1;
}

function inrcy_basic_site_acquire_lock() {
    global $wpdb;
    $token = (string) time() . ':' . wp_generate_uuid4();
    // add_option() can upsert under a simultaneous missing-row race. The unique
    // option_name constraint plus INSERT IGNORE gives this lock one owner only.
    $insert = function () use ($wpdb, $token) {
        $created = $wpdb->query($wpdb->prepare("INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'no')", INRCY_BASIC_SITE_CREATION_LOCK, $token));
        if ($created === 1) { wp_cache_delete(INRCY_BASIC_SITE_CREATION_LOCK, 'options'); wp_cache_delete('notoptions', 'options'); }
        return $created === 1;
    };
    if ($insert()) { return $token; }
    $previous = $wpdb->get_var($wpdb->prepare("SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", INRCY_BASIC_SITE_CREATION_LOCK));
    if ($previous === null) { return $insert() ? $token : false; }
    $created = is_scalar($previous) ? (int) explode(':', (string) $previous)[0] : 0;
    if ($created > time() - INRCY_BASIC_SITE_CREATION_LOCK_TTL) { return false; }
    if (!inrcy_basic_site_release_lock($previous)) { return false; }
    return $insert() ? $token : false;
}

function inrcy_basic_site_render($view = 'home') {
    if (!inrcy_basic_site_enabled() && !inrcy_basic_site_preview()) { return inrcy_basic_site_unavailable_message(); }
    $pages = inrcy_basic_site_pages();
    $view = isset($pages[$view]) ? $view : 'home';
    $catalogue = inrcy_basic_site_catalogue();
    ob_start();
    include __DIR__ . '/../templates/site-shell.php';
    return ob_get_clean();
}

add_shortcode('inrcy_basic_page', function ($attributes) {
    $attributes = shortcode_atts(array('view' => 'home'), $attributes, 'inrcy_basic_page');
    return inrcy_basic_site_render((string) $attributes['view']);
});

/** Creates missing children as drafts; never updates a page's content or status. */
function inrcy_basic_site_prepare_pages() {
    $root_id = (int) get_option(INRCY_BASIC_SIGNUP_PAGE_OPTION, 0);
    $root = $root_id ? get_post($root_id) : null;
    if (!$root || get_page_uri($root) !== 'basique') { $root = get_page_by_path('basique', OBJECT, 'page'); }
    if (!$root || (!inrcy_basic_site_has_legacy_shortcode($root->post_content) && inrcy_basic_site_content_view($root->post_content) !== 'home')) {
        return array('error' => 'La page /basique existante doit être vérifiée. Aucune page n’a été remplacée.');
    }
    $lock = inrcy_basic_site_acquire_lock();
    if ($lock === false) {
        return array('error' => 'Une préparation est déjà en cours. Réessayez dans quelques instants.');
    }
    try {
        $ids = array('home' => (int) $root->ID);
        $conflicts = array();
        foreach (inrcy_basic_site_pages() as $view => $page) {
            if ($view === 'home') { continue; }
            $existing = get_page_by_path('basique/' . $page['slug'], OBJECT, 'page');
            if ($existing) {
                $ids[$view] = (int) $existing->ID;
                if (inrcy_basic_site_content_view($existing->post_content) !== $view) { $conflicts[] = $page['title']; }
                continue;
            }
            $id = wp_insert_post(array('post_type' => 'page', 'post_status' => 'draft', 'post_parent' => (int) $root->ID,
                'post_name' => $page['slug'], 'post_title' => $page['heading'], 'post_content' => '[inrcy_basic_page view="' . $view . '"]'), true);
            if (is_wp_error($id)) { return array('error' => 'La préparation n’a pas pu être terminée. Les pages existantes sont conservées.'); }
            $ids[$view] = (int) $id;
        }
        update_option(INRCY_BASIC_SITE_PAGES_OPTION, $ids, false);
        update_option('inrcy_basic_site_conflicts', $conflicts, false);
        return array('ids' => $ids, 'conflicts' => $conflicts);
    } finally { inrcy_basic_site_release_lock($lock); }
}

function inrcy_basic_site_can_enable() {
    if (!inrcy_basic_site_legal_ready() || !shortcode_exists('cmplz-document')) { return false; }
    foreach (inrcy_basic_site_pages() as $view => $page) {
        $existing = get_page_by_path('basique' . ($page['slug'] !== '' ? '/' . $page['slug'] : ''), OBJECT, 'page');
        if (!$existing || $existing->post_status !== 'publish' || !empty($existing->post_password)) { return false; }
        if ($view === 'home') {
            if (!inrcy_basic_site_has_legacy_shortcode($existing->post_content) && inrcy_basic_site_content_view($existing->post_content) !== 'home') { return false; }
        } elseif (inrcy_basic_site_content_view($existing->post_content) !== $view) { return false; }
    }
    return true;
}

add_action('admin_post_inrcy_basic_site_prepare', function () {
    if (!current_user_can('manage_options')) { wp_die('Accès refusé.', '', array('response' => 403)); }
    check_admin_referer('inrcy_basic_site_prepare');
    $result = inrcy_basic_site_prepare_pages();
    if (!empty($result['error'])) { wp_die(esc_html($result['error'])); }
    wp_safe_redirect(admin_url('options-general.php?page=inrcy-basic-signup&prepared=1'));
    exit;
});

add_action('admin_post_inrcy_basic_site_enable', function () {
    if (!current_user_can('manage_options')) { wp_die('Accès refusé.', '', array('response' => 403)); }
    check_admin_referer('inrcy_basic_site_enable');
    $enabled = isset($_POST['enable_site']) && $_POST['enable_site'] === '1';
    if ($enabled && !inrcy_basic_site_can_enable()) { wp_die('Publiez et vérifiez les pages dédiées et le contenu juridique revu avant la bascule. Aucune page existante n’a été modifiée.'); }
    update_option(INRCY_BASIC_SITE_ENABLED_OPTION, $enabled ? '1' : '0', false);
    wp_safe_redirect(admin_url('options-general.php?page=inrcy-basic-signup'));
    exit;
});

function inrcy_basic_site_settings() {
    ?>
    <hr><h2>Préparer le mini-site Basique</h2>
    <p>La page racine et ses réglages sont conservés. La préparation crée seulement les pages enfants manquantes en brouillon.</p>
    <?php $conflicts = get_option('inrcy_basic_site_conflicts', array()); if ($conflicts) : ?><p><strong>Pages existantes à vérifier :</strong> <?php echo esc_html(implode(', ', $conflicts)); ?>. Aucune page n’a été remplacée.</p><?php endif; ?>
    <p><a class="button" href="<?php echo esc_url(inrcy_basic_site_url('home', true)); ?>" target="_blank" rel="noopener">Prévisualiser le mini-site</a></p>
    <form action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post"><input type="hidden" name="action" value="inrcy_basic_site_prepare"><?php wp_nonce_field('inrcy_basic_site_prepare'); ?><?php submit_button('Préparer les pages en brouillon', 'secondary'); ?></form>
    <form action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post"><input type="hidden" name="action" value="inrcy_basic_site_enable"><?php wp_nonce_field('inrcy_basic_site_enable'); ?>
        <p><label><input type="checkbox" name="enable_site" value="1" <?php checked(inrcy_basic_site_enabled()); ?>> Activer le mini-site revu pour les visiteurs</label></p>
        <p>Cette bascule ne publie ni ne remplace aucune page. Le contenu juridique et toutes les pages doivent déjà être vérifiés et publiés.</p><?php submit_button('Enregistrer la bascule'); ?>
    </form>
    <?php
}
