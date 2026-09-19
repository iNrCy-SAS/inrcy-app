<?php
/**
 * Relais Elementor -> API d'inscription iNrCy.
 *
 * Le navigateur ajoute les champs d'attribution au POST Elementor. Elementor
 * ne les expose pas tous dans $record->get('fields') lorsqu'ils ont ete ajoutes
 * dynamiquement : ils doivent donc etre lus depuis $_POST['form_fields'] avec
 * une liste blanche stricte.
 */

defined('ABSPATH') || exit;

function inrcy_trial_signup_scalar($value): string {
    if (is_array($value) || is_object($value)) {
        return '';
    }

    return trim(sanitize_text_field(wp_unslash((string) $value)));
}

function inrcy_trial_signup_posted_fields(): array {
    if (!isset($_POST['form_fields']) || !is_array($_POST['form_fields'])) {
        return [];
    }

    // Chaque valeur sera déséchappée exactement une fois par la fonction
    // scalaire après vérification de son type.
    return $_POST['form_fields'];
}

function inrcy_trial_signup_attribution_value(array $record_fields, array $posted_fields, string $key): string {
    $posted_value = $posted_fields[$key] ?? '';
    $record_value = $record_fields[$key] ?? '';
    $value = inrcy_trial_signup_scalar($posted_value);

    return $value !== '' ? $value : inrcy_trial_signup_scalar($record_value);
}

function inrcy_trial_signup_copy_attribution(array $record_fields, array $posted_fields, array &$body): void {
    $text_keys = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'utm_term',
        'campaign_id',
        'campaign_name',
        'adset_id',
        'adset_name',
        'ad_id',
        'ad_name',
        'placement',
        'site_source_name',
        'fbclid',
        'attribution_captured_at',
        'client_user_agent',
        'fbp',
        'fbc',
    ];

    foreach ($text_keys as $key) {
        $body[$key] = inrcy_trial_signup_attribution_value($record_fields, $posted_fields, $key);
    }

    foreach (['landing_page_url', 'event_source_url', 'referrer_url'] as $key) {
        $body[$key] = esc_url_raw(
            inrcy_trial_signup_attribution_value($record_fields, $posted_fields, $key),
        );
    }

    $event_id = inrcy_trial_signup_attribution_value($record_fields, $posted_fields, 'event_id');
    $body['event_id'] = preg_replace('/[^a-zA-Z0-9._:-]/', '', $event_id) ?: '';

    $marketing_consent = strtolower(
        inrcy_trial_signup_attribution_value(
            $record_fields,
            $posted_fields,
            'meta_tracking_consent',
        ),
    );
    $body['meta_tracking_consent'] = in_array(
        $marketing_consent,
        ['1', 'true', 'yes', 'oui', 'on', 'allow', 'accepted'],
        true,
    ) ? 'true' : 'false';
}

add_action('elementor_pro/forms/validation', function ($record, $ajax_handler) {
    $form_name = $record->get_form_settings('form_name');
    if ($form_name !== 'essai_inrcy_30j') {
        return;
    }

    $raw_fields = $record->get('fields');
    $fields = [];
    foreach ($raw_fields as $id => $field) {
        $fields[$id] = isset($field['value']) ? $field['value'] : '';
    }

    $body = [
        'first_name' => trim($fields['first_name'] ?? ''),
        'last_name' => trim($fields['last_name'] ?? ''),
        'email' => trim($fields['email'] ?? ''),
        'company_name' => trim($fields['company_name'] ?? ''),
        'phone' => trim($fields['phone'] ?? ''),
        'consent' => !empty($fields['consent']),
        'website' => trim($fields['website'] ?? ''),
    ];

    inrcy_trial_signup_copy_attribution($fields, inrcy_trial_signup_posted_fields(), $body);

    // Le secret reste exclusivement dans wp-config.php. L'absence de constante
    // bloque le relais au lieu d'autoriser un secret de secours dans l'extrait.
    $token = defined('INRCY_TRIAL_SIGNUP_TOKEN')
        ? trim((string) INRCY_TRIAL_SIGNUP_TOKEN)
        : '';
    if ($token === '') {
        error_log('[iNrCy trial signup] INRCY_TRIAL_SIGNUP_TOKEN is missing.');
        $ajax_handler->add_error('email', "Impossible de demarrer l'essai pour le moment.");
        return;
    }

    $response = wp_remote_post(
        'https://app.inrcy.com/api/public/trial-signup?token=' . rawurlencode($token),
        [
            'timeout' => 20,
            'headers' => [
                'Content-Type' => 'application/json',
            ],
            'body' => wp_json_encode($body),
        ],
    );

    if (is_wp_error($response)) {
        $ajax_handler->add_error('email', "Impossible de demarrer l'essai pour le moment.");
        return;
    }

    $code = wp_remote_retrieve_response_code($response);
    $json = json_decode(wp_remote_retrieve_body($response), true);

    if (
        $code >= 200
        && $code < 300
        && !empty($json['ok'])
        && !empty($json['booking_token'])
        && method_exists($ajax_handler, 'add_response_data')
    ) {
        $ajax_handler->add_response_data(
            'inrcy_booking_token',
            (string) $json['booking_token'],
        );
    }

    if ($code < 200 || $code >= 300 || empty($json['ok'])) {
        $message = !empty($json['message'])
            ? $json['message']
            : "Impossible de demarrer l'essai pour le moment.";
        $ajax_handler->add_error('email', $message);
    }
}, 10, 2);
