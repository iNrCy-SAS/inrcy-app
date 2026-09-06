<?php
/**
 * Plugin Name: iNrCy — Rendez-vous visio après inscription
 * Description: Propose un créneau Google Meet après une inscription Elementor réussie.
 * Version: 1.2.1
 * Author: iNrCy
 */

if (!defined('ABSPATH')) {
    exit;
}

define('INRCY_VISIO_BOOKING_VERSION', '1.2.1');
define('INRCY_VISIO_BOOKING_FORM_ID', '405c24a');
define('INRCY_VISIO_BOOKING_FORM_NAME', 'essai_inrcy_30j');
define('INRCY_VISIO_BOOKING_PUBLIC_OPTION', 'inrcy_visio_booking_public_enabled');
define('INRCY_VISIO_BOOKING_TEST_COOKIE', 'inrcy_visio_booking_test');

function inrcy_visio_booking_public_enabled() {
    return get_option(INRCY_VISIO_BOOKING_PUBLIC_OPTION, '0') === '1';
}

function inrcy_visio_booking_is_test_request() {
    if (!is_user_logged_in() || !current_user_can('manage_options')) {
        return false;
    }

    $query_enabled = isset($_GET['inrcy_visio_test'])
        && sanitize_text_field(wp_unslash($_GET['inrcy_visio_test'])) === '1';
    $cookie_enabled = isset($_COOKIE[INRCY_VISIO_BOOKING_TEST_COOKIE])
        && sanitize_text_field(wp_unslash($_COOKIE[INRCY_VISIO_BOOKING_TEST_COOKIE])) === '1';
    return $query_enabled || $cookie_enabled;
}

function inrcy_visio_booking_frontend_enabled() {
    return inrcy_visio_booking_public_enabled() || inrcy_visio_booking_is_test_request();
}

add_action('init', 'inrcy_visio_booking_remember_test_mode', 5);
function inrcy_visio_booking_remember_test_mode() {
    if (
        !is_user_logged_in()
        || !current_user_can('manage_options')
        || !isset($_GET['inrcy_visio_test'])
        || sanitize_text_field(wp_unslash($_GET['inrcy_visio_test'])) !== '1'
    ) {
        return;
    }

    setcookie(INRCY_VISIO_BOOKING_TEST_COOKIE, '1', array(
        'expires' => time() + 30 * MINUTE_IN_SECONDS,
        'path' => '/',
        'secure' => is_ssl(),
        'httponly' => true,
        'samesite' => 'Lax',
    ));
    $_COOKIE[INRCY_VISIO_BOOKING_TEST_COOKIE] = '1';
}

add_action('admin_init', 'inrcy_visio_booking_register_setting');
function inrcy_visio_booking_register_setting() {
    register_setting(
        'inrcy_visio_booking_settings',
        INRCY_VISIO_BOOKING_PUBLIC_OPTION,
        array(
            'type' => 'string',
            'sanitize_callback' => function ($value) {
                return $value === '1' ? '1' : '0';
            },
            'default' => '0',
        )
    );
}

add_action('admin_menu', 'inrcy_visio_booking_add_settings_page');
function inrcy_visio_booking_add_settings_page() {
    add_options_page(
        'Rendez-vous visio iNrCy',
        'Rendez-vous visio iNrCy',
        'manage_options',
        'inrcy-visio-booking',
        'inrcy_visio_booking_render_settings_page'
    );
}

function inrcy_visio_booking_render_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }
    $test_url = add_query_arg(
        array('lang' => 'fr', 'inrcy_visio_test' => '1'),
        home_url('/inscription/')
    );
    ?>
    <div class="wrap">
        <h1>Rendez-vous visio iNrCy</h1>
        <p>Le mode public reste désactivé pendant les essais. Utilisez le lien privé ci-dessous en restant connecté comme administrateur WordPress.</p>
        <p><a class="button button-secondary" href="<?php echo esc_url($test_url); ?>" target="_blank" rel="noopener">Ouvrir l’inscription en mode test</a></p>
        <form method="post" action="options.php">
            <?php settings_fields('inrcy_visio_booking_settings'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row">Affichage public</th>
                    <td>
                        <label>
                            <input type="hidden" name="<?php echo esc_attr(INRCY_VISIO_BOOKING_PUBLIC_OPTION); ?>" value="0">
                            <input type="checkbox" name="<?php echo esc_attr(INRCY_VISIO_BOOKING_PUBLIC_OPTION); ?>" value="1" <?php checked(inrcy_visio_booking_public_enabled()); ?>>
                            Proposer le rendez-vous à tous les professionnels après une inscription réussie
                        </label>
                    </td>
                </tr>
            </table>
            <?php submit_button('Enregistrer'); ?>
        </form>
    </div>
    <?php
}

/**
 * L'appel trial-signup est déjà réalisé par le snippet d'inscription existant.
 * On observe uniquement sa réponse, dans la même requête WordPress, pour ne
 * jamais créer deux comptes ni dupliquer un appel d'inscription.
 */
add_action('http_api_debug', 'inrcy_visio_booking_capture_signup_response', 20, 5);
function inrcy_visio_booking_capture_signup_response($response, $context, $class, $parsed_args, $url) {
    unset($class, $parsed_args);
    if (!inrcy_visio_booking_frontend_enabled() || $context !== 'response' || is_wp_error($response)) {
        return;
    }

    $parts = wp_parse_url((string) $url);
    if (!is_array($parts)) {
        return;
    }
    $host = strtolower((string) ($parts['host'] ?? ''));
    $path = rtrim((string) ($parts['path'] ?? ''), '/');
    if ($host !== 'app.inrcy.com' || $path !== '/api/public/trial-signup') {
        return;
    }

    $status = (int) wp_remote_retrieve_response_code($response);
    $body = json_decode((string) wp_remote_retrieve_body($response), true);
    $token = is_array($body) ? (string) ($body['booking_token'] ?? '') : '';
    if ($status >= 200 && $status < 300 && !empty($body['ok']) && strlen($token) <= 4096) {
        $GLOBALS['inrcy_visio_booking_token'] = $token;
    }
}

add_action('elementor_pro/forms/validation', 'inrcy_visio_booking_add_success_data', PHP_INT_MAX, 2);
function inrcy_visio_booking_add_success_data($record, $ajax_handler) {
    if (!inrcy_visio_booking_frontend_enabled() || !is_object($record) || !is_object($ajax_handler)) {
        return;
    }
    $form_id = (string) $record->get_form_settings('id');
    $form_name = sanitize_key((string) $record->get_form_settings('form_name'));
    if ($form_id !== INRCY_VISIO_BOOKING_FORM_ID && $form_name !== INRCY_VISIO_BOOKING_FORM_NAME) {
        return;
    }

    $token = isset($GLOBALS['inrcy_visio_booking_token'])
        ? (string) $GLOBALS['inrcy_visio_booking_token']
        : '';
    if ($token === '' || !method_exists($ajax_handler, 'add_response_data')) {
        return;
    }
    $ajax_handler->add_response_data('inrcy_booking_token', $token);
}

add_action('wp_enqueue_scripts', 'inrcy_visio_booking_enqueue_assets', 30);
function inrcy_visio_booking_enqueue_assets() {
    if (is_admin() || !inrcy_visio_booking_frontend_enabled()) {
        return;
    }
    $base_url = plugin_dir_url(__FILE__);
    wp_enqueue_style(
        'inrcy-visio-booking',
        $base_url . 'inrcy-visio-booking.css',
        array(),
        INRCY_VISIO_BOOKING_VERSION
    );
    wp_enqueue_script(
        'inrcy-visio-booking',
        $base_url . 'inrcy-visio-booking.js',
        array('jquery'),
        INRCY_VISIO_BOOKING_VERSION,
        true
    );
    wp_localize_script('inrcy-visio-booking', 'inrcyVisioBookingConfig', array(
        'availabilityUrl' => 'https://app.inrcy.com/api/public/visio-booking/availability',
        'bookingUrl' => 'https://app.inrcy.com/api/public/visio-booking/book',
        'logoUrl' => $base_url . 'logo-inrcy-transparent.png',
        'mode' => inrcy_visio_booking_is_test_request() ? 'test' : 'public',
    ));
}
