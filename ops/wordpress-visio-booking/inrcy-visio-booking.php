<?php
/**
 * Plugin Name: iNrCy — Rendez-vous visio après inscription
 * Description: Propose un créneau Google Meet après une inscription Elementor réussie.
 * Version: 1.0.0
 * Author: iNrCy
 */

if (!defined('ABSPATH')) {
    exit;
}

define('INRCY_VISIO_BOOKING_VERSION', '1.0.0');
define('INRCY_VISIO_BOOKING_FORM_ID', '405c24a');
define('INRCY_VISIO_BOOKING_FORM_NAME', 'essai_inrcy_30j');

/**
 * L'appel trial-signup est déjà réalisé par le snippet d'inscription existant.
 * On observe uniquement sa réponse, dans la même requête WordPress, pour ne
 * jamais créer deux comptes ni dupliquer un appel d'inscription.
 */
add_action('http_api_debug', 'inrcy_visio_booking_capture_signup_response', 20, 5);
function inrcy_visio_booking_capture_signup_response($response, $context, $class, $parsed_args, $url) {
    unset($class, $parsed_args);
    if ($context !== 'response' || is_wp_error($response)) {
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
    if (!is_object($record) || !is_object($ajax_handler)) {
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
    if (is_admin()) {
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
    ));
}
