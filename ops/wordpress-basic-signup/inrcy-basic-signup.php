<?php
/**
 * Plugin Name: iNrCy — Inscription Basique sans essai
 * Description: Espace Basique autonome dans WordPress et inscription directe avec accès immédiat.
 * Version: 1.2.2
 * Author: iNrCy
 */

if (!defined('ABSPATH')) { exit; }
define('INRCY_BASIC_SIGNUP_VERSION', '1.2.2');
define('INRCY_BASIC_SIGNUP_SECRET_OPTION', 'inrcy_basic_signup_server_secret');
define('INRCY_BASIC_SIGNUP_PAGE_OPTION', 'inrcy_basic_signup_page_id');
require_once __DIR__ . '/includes/catalogue.php';
require_once __DIR__ . '/includes/legal-content.php';
require_once __DIR__ . '/includes/site.php';
require_once __DIR__ . '/includes/seo.php';
require_once __DIR__ . '/includes/editorial.php';

function inrcy_basic_signup_secret() {
    $configured = defined('INRCY_TRIAL_SIGNUP_TOKEN') ? trim((string) INRCY_TRIAL_SIGNUP_TOKEN) : '';
    return $configured !== '' ? $configured : trim((string) get_option(INRCY_BASIC_SIGNUP_SECRET_OPTION, ''));
}

function inrcy_basic_signup_is_page() {
    if (!is_singular('page')) { return false; }
    $post = get_post();
    return $post && (has_shortcode((string) $post->post_content, 'inrcy_basic_signup') || has_shortcode((string) $post->post_content, 'inrcy_basic_page'));
}

add_action('admin_menu', function () {
    add_options_page('Inscription Basique iNrCy', 'Inscription Basique iNrCy', 'manage_options', 'inrcy-basic-signup', 'inrcy_basic_signup_settings');
});

function inrcy_basic_signup_settings() {
    if (!current_user_can('manage_options')) { return; }
    $constant = defined('INRCY_TRIAL_SIGNUP_TOKEN') && trim((string) INRCY_TRIAL_SIGNUP_TOKEN) !== '';
    $configured = inrcy_basic_signup_secret() !== '';
    ?>
    <div class="wrap"><h1>Inscription Basique iNrCy</h1>
        <p>Le parcours actuel d’inscription reste indépendant. Cette page utilise uniquement l’inscription directe sans essai.</p>
        <p><?php echo esc_html($constant ? 'Secret serveur configuré dans wp-config.php : réutilisation automatique.' : ($configured ? 'Secret serveur de secours configuré.' : 'Secret serveur non configuré. Le formulaire restera fermé.')); ?></p>
        <form action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post">
            <input type="hidden" name="action" value="inrcy_basic_signup_save_settings">
            <?php wp_nonce_field('inrcy_basic_signup_save_settings'); ?>
            <p><label for="inrcy-basic-secret">Secret serveur de secours (facultatif si wp-config.php est configuré)</label><br>
                <input id="inrcy-basic-secret" name="server_secret" type="password" value="" autocomplete="new-password" class="regular-text"></p>
            <p>Laisser vide conserve la valeur existante. Le secret enregistré n’est jamais affiché.</p>
            <p><label><input type="checkbox" name="clear_secret" value="1"> Effacer uniquement le secret de secours enregistré</label></p>
            <?php submit_button('Enregistrer'); ?>
        </form>
        <?php inrcy_basic_site_settings(); ?>
        <hr><h2>Préparer la page /basique</h2>
        <p>Crée un brouillon avec le shortcode <code>[inrcy_basic_signup]</code> si le chemin est libre. Une page existante n’est jamais modifiée ni remplacée.</p>
        <form action="<?php echo esc_url(admin_url('admin-post.php')); ?>" method="post">
            <input type="hidden" name="action" value="inrcy_basic_signup_create_page">
            <?php wp_nonce_field('inrcy_basic_signup_create_page'); ?>
            <?php submit_button('Créer ou retrouver le brouillon', 'secondary'); ?>
        </form>
    </div>
    <?php
}

add_action('admin_post_inrcy_basic_signup_save_settings', function () {
    if (!current_user_can('manage_options')) { wp_die('Accès refusé.', '', array('response' => 403)); }
    check_admin_referer('inrcy_basic_signup_save_settings');
    $secret = isset($_POST['server_secret']) && is_string($_POST['server_secret']) ? trim(wp_unslash($_POST['server_secret'])) : '';
    if ($secret !== '') {
        if (strlen($secret) > 1024 || preg_match('/[\x00-\x20\x7F]/', $secret)) { wp_die('Format du secret invalide.'); }
        update_option(INRCY_BASIC_SIGNUP_SECRET_OPTION, $secret, false);
    } elseif (isset($_POST['clear_secret']) && $_POST['clear_secret'] === '1') {
        delete_option(INRCY_BASIC_SIGNUP_SECRET_OPTION);
    }
    wp_safe_redirect(admin_url('options-general.php?page=inrcy-basic-signup'));
    exit;
});

add_action('admin_post_inrcy_basic_signup_create_page', function () {
    if (!current_user_can('manage_options')) { wp_die('Accès refusé.', '', array('response' => 403)); }
    check_admin_referer('inrcy_basic_signup_create_page');
    $existing = get_page_by_path('basique', OBJECT, 'page');
    if ($existing) {
        // Even a page owned by this plugin is never overwritten on a later click.
        wp_safe_redirect(get_edit_post_link($existing->ID, 'raw'));
        exit;
    }
    $id = wp_insert_post(array('post_type' => 'page', 'post_status' => 'draft', 'post_title' => 'iNrCy Basique', 'post_name' => 'basique', 'post_content' => '[inrcy_basic_signup]'), true);
    if (is_wp_error($id)) { wp_die('Impossible de créer le brouillon.'); }
    update_option(INRCY_BASIC_SIGNUP_PAGE_OPTION, (int) $id, false);
    wp_safe_redirect(get_edit_post_link($id, 'raw'));
    exit;
});

add_filter('template_include', function ($template) {
    return inrcy_basic_signup_is_page() ? __DIR__ . '/basic-page.php' : $template;
}, 99);

add_action('template_redirect', function () {
    if (!inrcy_basic_signup_is_page()) { return; }
    if (!defined('DONOTCACHEPAGE')) { define('DONOTCACHEPAGE', true); }
    nocache_headers();
}, 0);

add_action('wp_enqueue_scripts', function () {
    if (!inrcy_basic_signup_is_page()) { return; }
    // Only the Basic page replaces the old global booking UI. Its copied access
    // renderer has its own configuration; other pages keep their original assets.
    wp_dequeue_script('inrcy-visio-booking');
    wp_dequeue_style('inrcy-visio-booking');
    $base = plugin_dir_url(__FILE__);
    wp_enqueue_style('inrcy-basic-access', $base . 'basic-access.css', array(), INRCY_BASIC_SIGNUP_VERSION);
    wp_enqueue_style('inrcy-basic-signup', $base . 'basic-signup.css', array('inrcy-basic-access'), INRCY_BASIC_SIGNUP_VERSION);
    wp_enqueue_script('inrcy-basic-access', $base . 'basic-access.js', array('jquery'), INRCY_BASIC_SIGNUP_VERSION, true);
    wp_localize_script('inrcy-basic-access', 'inrcyBasicSignupAccessConfig', array('showBooking' => false, 'signupFormName' => 'inrcy_basic_signup', 'logoUrl' => $base . 'logo-inrcy-transparent.png', 'signupUrl' => home_url('/basique/')));
    wp_enqueue_script('inrcy-basic-signup', $base . 'basic-signup.js', array('jquery', 'inrcy-basic-access'), INRCY_BASIC_SIGNUP_VERSION, true);
    wp_localize_script('inrcy-basic-signup', 'inrcyBasicSignupConfig', array('ajaxUrl' => admin_url('admin-ajax.php'), 'nonce' => wp_create_nonce('inrcy_basic_signup')));
    if (inrcy_basic_site_rendered()) {
        wp_enqueue_style('inrcy-basic-site', $base . 'basic-site.css', array('inrcy-basic-signup'), INRCY_BASIC_SIGNUP_VERSION);
        if (inrcy_basic_site_view() === 'home') {
            wp_enqueue_style('inrcy-basic-home-native', $base . 'basic-home-native.css', array('inrcy-basic-site'), INRCY_BASIC_SIGNUP_VERSION);
        }
        wp_enqueue_script('inrcy-basic-site', $base . 'basic-site.js', array(), INRCY_BASIC_SIGNUP_VERSION, true);
        $site_links = array(); foreach (inrcy_basic_site_pages() as $key => $page) { $site_links[$key] = inrcy_basic_site_url($key); }
        wp_localize_script('inrcy-basic-site', 'inrcyBasicSiteConfig', array('links' => $site_links));
    }
}, 100);

add_shortcode('inrcy_basic_signup', function () {
    if (inrcy_basic_site_rendered()) { return inrcy_basic_site_render(inrcy_basic_site_view()); }
    $configured = inrcy_basic_signup_secret() !== '';
    ob_start();
    ?>
    <main class="inrcy-basic-page">
        <header class="inrcy-basic-header"><a href="<?php echo esc_url(home_url('/')); ?>" class="inrcy-basic-brand"><img src="<?php echo esc_url(plugin_dir_url(__FILE__) . 'logo-inrcy-transparent.png'); ?>" alt="" width="44" height="44">iNrCy</a><a href="https://app.inrcy.com/login">Déjà inscrit ? Se connecter</a></header>
        <section class="inrcy-basic-hero" aria-labelledby="inrcy-basic-title"><div class="inrcy-basic-pitch">
            <p class="inrcy-basic-eyebrow">L’ESSENTIEL POUR VOTRE ACTIVITÉ</p><h1 id="inrcy-basic-title">Votre présence professionnelle commence ici.</h1>
            <p class="inrcy-basic-price">Basique <strong>29 € HT<span>/mois</span></strong></p><p>Abonnement mensuel. Sans période d’essai.</p>
            <ol><li>Créez votre compte et retrouvez immédiatement vos accès.</li><li>Choisissez votre mot de passe dans l’application.</li><li>Comparez les trois packs, puis activez votre abonnement avec Stripe.</li></ol>
            <p class="inrcy-basic-note">La création du compte ne déclenche aucun paiement. Vous confirmez votre offre avant de payer.</p>
        </div><section class="inrcy-basic-card" aria-labelledby="inrcy-basic-form-title"><h2 id="inrcy-basic-form-title">Créer mon compte</h2><p>Vos accès s’affichent après votre inscription.</p>
            <?php if (!$configured) : ?><p role="status">L’inscription sera disponible prochainement.</p><?php endif; ?>
            <form name="inrcy_basic_signup" class="inrcy-basic-form" method="post" novalidate>
                <div class="inrcy-basic-pair"><label>Nom<input name="form_fields[last_name]" autocomplete="family-name" maxlength="100" required></label><label>Prénom<input name="form_fields[first_name]" autocomplete="given-name" maxlength="100" required></label></div>
                <label>E-mail<input type="email" name="form_fields[email]" autocomplete="email" maxlength="254" required></label>
                <label>Société <span>(facultatif)</span><input name="form_fields[company_name]" autocomplete="organization" maxlength="200"></label>
                <label>Tél.<input type="tel" name="form_fields[phone]" autocomplete="tel" maxlength="80" required></label>
                <div class="inrcy-basic-honeypot" aria-hidden="true"><label>Site internet<input name="form_fields[website]" tabindex="-1" autocomplete="off"></label></div>
                <label class="inrcy-basic-consent"><input type="checkbox" name="form_fields[consent]" value="1" required><span>J’ai lu et j’accepte les <a href="<?php echo esc_url(home_url('/cga-conditions-generales-dabonnement/')); ?>" target="_blank" rel="noopener">CGA et Conditions d’utilisation</a>, et j’ai pris connaissance de la <a href="<?php echo esc_url(home_url('/politique-de-confidentialite/')); ?>" target="_blank" rel="noopener">Politique de confidentialité</a>. J’accepte d’être contacté(e) par iNrCy dans le cadre de ma demande de création de compte et d’abonnement sans période d’essai.</span></label>
                <p class="inrcy-basic-cancellation">Résiliation avec préavis : un renouvellement mensuel supplémentaire.</p>
                <button type="submit" <?php disabled(!$configured); ?>>Créer mon compte et choisir mon offre <span aria-hidden="true">→</span></button>
                <p class="inrcy-basic-status" role="status" aria-live="polite"></p>
            </form>
        </section></section><footer class="inrcy-basic-footer"><span>iNrCy · Votre activité, simplement.</span><a href="<?php echo esc_url(home_url('/cga-conditions-generales-dabonnement/')); ?>">Conditions d’abonnement</a><a href="<?php echo esc_url(home_url('/politique-de-confidentialite/')); ?>">Confidentialité</a></footer>
    </main>
    <?php
    return ob_get_clean();
});

function inrcy_basic_signup_scalar($values, $key, $limit = 200) {
    $value = isset($values[$key]) && is_scalar($values[$key]) ? trim(sanitize_text_field(wp_unslash((string) $values[$key]))) : '';
    return function_exists('mb_substr') ? mb_substr($value, 0, $limit) : substr($value, 0, $limit);
}

function inrcy_basic_signup_access($value) {
    if (!is_array($value) || !isset($value['email'], $value['password'], $value['ticket'], $value['expires_at'], $value['login_url'])
        || !is_string($value['email']) || strlen($value['email']) > 254 || !is_email($value['email'])
        || !is_string($value['password']) || strlen($value['password']) < 1 || strlen($value['password']) > 128
        || !is_string($value['ticket']) || strlen($value['ticket']) > 16384
        || !is_string($value['expires_at']) || strlen($value['expires_at']) > 40 || strtotime($value['expires_at']) === false
        || $value['login_url'] !== 'https://app.inrcy.com/api/auth/signup-access') { return null; }
    return array_intersect_key($value, array_flip(array('email', 'password', 'ticket', 'expires_at', 'login_url')));
}

add_action('wp_ajax_nopriv_inrcy_basic_signup', 'inrcy_basic_signup_submit');
add_action('wp_ajax_inrcy_basic_signup', 'inrcy_basic_signup_submit');
function inrcy_basic_signup_submit() {
    nocache_headers();
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || !check_ajax_referer('inrcy_basic_signup', 'nonce', false)) {
        wp_send_json_error(array('message' => 'Rechargez la page avant de réessayer.'), 403);
    }
    $secret = inrcy_basic_signup_secret();
    if ($secret === '') { wp_send_json_error(array('message' => 'L’inscription est momentanément indisponible.'), 503); }
    $fields = isset($_POST['form_fields']) && is_array($_POST['form_fields']) ? $_POST['form_fields'] : array();
    $body = array('signup_mode' => 'direct_basic', 'source' => 'wordpress-basique', 'language' => 'fr',
        'first_name' => inrcy_basic_signup_scalar($fields, 'first_name', 100), 'last_name' => inrcy_basic_signup_scalar($fields, 'last_name', 100),
        'email' => inrcy_basic_signup_scalar($fields, 'email', 254), 'company_name' => inrcy_basic_signup_scalar($fields, 'company_name', 200),
        'phone' => inrcy_basic_signup_scalar($fields, 'phone', 80), 'consent' => inrcy_basic_signup_scalar($fields, 'consent', 10) === '1',
        'website' => inrcy_basic_signup_scalar($fields, 'website', 200));
    if ($body['first_name'] === '' || $body['last_name'] === '' || !is_email($body['email']) || $body['phone'] === '' || !$body['consent'] || $body['website'] !== '') {
        wp_send_json_error(array('message' => 'Vérifiez les champs obligatoires et votre consentement.'), 422);
    }
    $attribution = array('utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name', 'placement', 'site_source_name', 'fbclid', 'attribution_captured_at', 'client_user_agent', 'fbp', 'fbc', 'event_id', 'meta_tracking_consent');
    foreach ($attribution as $key) { $body[$key] = inrcy_basic_signup_scalar($fields, $key, 1024); }
    foreach (array('landing_page_url', 'event_source_url', 'referrer_url') as $key) { $body[$key] = esc_url_raw(inrcy_basic_signup_scalar($fields, $key, 2048)); }
    $body['event_id'] = preg_replace('/[^a-zA-Z0-9._:-]/', '', $body['event_id']);
    $body['meta_tracking_consent'] = in_array(strtolower($body['meta_tracking_consent']), array('1', 'true', 'yes', 'oui', 'on', 'allow', 'accepted'), true) ? 'true' : 'false';
    $response = wp_remote_post('https://app.inrcy.com/api/public/basic-signup', array('timeout' => 20, 'redirection' => 0,
        'headers' => array('Content-Type' => 'application/json', 'x-trial-signup-secret' => $secret), 'body' => wp_json_encode($body)));
    unset($secret);
    if (is_wp_error($response)) { wp_send_json_error(array('message' => 'La connexion a été interrompue. Vérifiez votre accès avant de réessayer ou contactez iNrCy.'), 502); }
    $code = (int) wp_remote_retrieve_response_code($response);
    $json = json_decode((string) wp_remote_retrieve_body($response), true);
    if ($code < 200 || $code >= 300 || !is_array($json) || empty($json['ok'])) {
        $message = $code === 409 ? 'Un compte existe déjà avec cet e-mail. Connectez-vous à votre compte.' : 'L’inscription est momentanément indisponible. Vérifiez vos informations ou réessayez plus tard.';
        wp_send_json_error(array('message' => $message), $code === 409 ? 409 : 502);
    }
    if (($json['direct_signup'] ?? null) !== true || ($json['activation_required'] ?? null) !== true
        || ($json['trial_days'] ?? null) !== 0 || !array_key_exists('trial_end_at', $json) || $json['trial_end_at'] !== null) {
        wp_send_json_error(array('message' => 'Ce parcours d’inscription est momentanément indisponible. Contactez iNrCy avant de renouveler votre demande.'), 502);
    }
    $access = inrcy_basic_signup_access($json['signup_access'] ?? null);
    if ($access === null || strcasecmp($access['email'], $body['email']) !== 0) {
        wp_send_json_error(array('message' => 'Votre demande a été reçue, mais vos accès ne peuvent pas être affichés. Contactez iNrCy avant de renouveler l’inscription.'), 502);
    }
    // The receipt lives only in this AJAX response. No options, logs or tracking.
    wp_send_json_success(array('direct_signup' => true, 'activation_required' => true, 'trial_days' => 0, 'trial_end_at' => null, 'inrcy_signup_access' => $access));
}
