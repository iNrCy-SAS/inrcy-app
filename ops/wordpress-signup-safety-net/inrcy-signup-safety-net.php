<?php
/**
 * Plugin Name: iNrCy — Filet de sécurité inscription
 * Description: Alerte compte@inrcy.com si l'envoi WordPress d'une inscription n'atteint pas correctement l'application.
 * Version: 1.4.0
 * Author: iNrCy
 */

if (!defined('ABSPATH')) {
    exit;
}

// Les fonctions sont réellement conditionnelles : une seconde copie devient inerte.
if (!function_exists('inrcy_signup_safety_handle_failure')) {

define('INRCY_SIGNUP_SAFETY_FORM_ID', '405c24a');
define('INRCY_SIGNUP_SAFETY_FORM_NAME', 'essai_inrcy_30j');
define('INRCY_SIGNUP_SAFETY_DEDUPE_SECONDS', 900);
define('INRCY_SIGNUP_SAFETY_OUTBOX_MAX_AGE', 30 * 86400);
define('INRCY_SIGNUP_SAFETY_LEASE_SECONDS', 900);
define('INRCY_SIGNUP_SAFETY_RETRY_HOOK', 'inrcy_signup_safety_retry');
define('INRCY_SIGNUP_SAFETY_SWEEP_HOOK', 'inrcy_signup_safety_sweep');
define('INRCY_SIGNUP_SAFETY_ACTION_GROUP', 'inrcy-signup-safety');

/**
 * Le webhook natif reste inchangé. Ce hook officiel Elementor observe seulement
 * sa réponse et prend le relais quand l'application n'a pas accusé réception
 * de l'incident.
 */
add_action('elementor_pro/forms/webhooks/response', 'inrcy_signup_safety_observe_webhook', 10, 2);
add_action('http_api_debug', 'inrcy_signup_safety_observe_http_api', 10, 5);
add_filter('pre_http_request', 'inrcy_signup_safety_observe_preempted_http_api', PHP_INT_MAX, 3);
add_action(INRCY_SIGNUP_SAFETY_RETRY_HOOK, 'inrcy_signup_safety_retry_outbox', 10, 1);
add_action(INRCY_SIGNUP_SAFETY_SWEEP_HOOK, 'inrcy_signup_safety_sweep_outbox');
add_action('init', 'inrcy_signup_safety_ensure_sweeper', 50);
add_action('action_scheduler_ensure_recurring_actions', 'inrcy_signup_safety_ensure_sweeper');

function inrcy_signup_safety_observe_webhook($response, $record) {
    if (!inrcy_signup_safety_is_target_form($record)) {
        return;
    }

    inrcy_signup_safety_handle_failure($response, inrcy_signup_safety_read_contact($record));
}

/**
 * Le formulaire de production est actuellement envoyé par un snippet Elementor
 * pendant la validation. Ce hook WordPress natif observe exactement l'appel
 * sortant vers trial-signup, sans modifier la requête ni la réponse.
 */
function inrcy_signup_safety_observe_http_api($response, $context, $class, $parsed_args, $url) {
    unset($class);

    if ($context !== 'response' || !inrcy_signup_safety_is_trial_signup_url($url)) {
        return;
    }

    $body = is_array($parsed_args) ? ($parsed_args['body'] ?? array()) : array();
    inrcy_signup_safety_handle_failure(
        $response,
        inrcy_signup_safety_read_contact_from_payload($body)
    );
}

/**
 * Un plugin de sécurité/cache peut court-circuiter WP HTTP avant http_api_debug.
 * On observe le résultat final du filtre sans jamais le remplacer.
 */
function inrcy_signup_safety_observe_preempted_http_api($preempt, $parsed_args, $url) {
    if ($preempt !== false && inrcy_signup_safety_is_trial_signup_url($url)) {
        $body = is_array($parsed_args) ? ($parsed_args['body'] ?? array()) : array();
        inrcy_signup_safety_handle_failure(
            $preempt,
            inrcy_signup_safety_read_contact_from_payload($body)
        );
    }

    return $preempt;
}

function inrcy_signup_safety_is_trial_signup_url($url) {
    $parts = wp_parse_url((string) $url);
    if (!is_array($parts)) {
        return false;
    }

    $host = strtolower((string) ($parts['host'] ?? ''));
    $path = rtrim((string) ($parts['path'] ?? ''), '/');
    return $host === 'app.inrcy.com' && $path === '/api/public/trial-signup';
}

function inrcy_signup_safety_handle_failure($response, $contact) {
    if (inrcy_signup_safety_app_owns_alert($response)) {
        return;
    }

    $status = is_wp_error($response) ? 0 : (int) wp_remote_retrieve_response_code($response);
    if (!inrcy_signup_safety_is_technical_failure($response, $status)) {
        return;
    }

    if (
        !is_array($contact)
        || empty($contact['consent'])
        || empty($contact['email'])
        || (isset($contact['honeypot']) && $contact['honeypot'] !== '')
    ) {
        return;
    }

    $failure = inrcy_signup_safety_read_failure($response, $status);
    $request_id = inrcy_signup_safety_read_request_id($response);
    $fingerprint = hash(
        'sha256',
        strtolower($contact['email']) . "\0" . preg_replace('/\D+/', '', $contact['phone']) . "\0" . $failure['code']
    );
    $fingerprint_short = substr($fingerprint, 0, 40);
    $dedupe_key = 'inrcy_signup_fail_sent_' . $fingerprint_short;
    $outbox_key = 'inrcy_signup_fail_outbox_' . $fingerprint_short;

    if (get_transient($dedupe_key) !== false) {
        return;
    }

    $destination = sanitize_email(
        (string) apply_filters('inrcy_signup_failure_alert_email', 'compte@inrcy.com')
    );
    if (!$destination) {
        delete_transient($dedupe_key);
        return;
    }

    $incident_id = $request_id !== '' ? $request_id : substr($fingerprint, 0, 16);
    $subject_contact = $contact['email'] !== '' ? $contact['email'] : ($contact['phone'] !== '' ? $contact['phone'] : 'contact');
    $subject = sprintf(
        'iNrCy — Filet WordPress : inscription bloquée — %s',
        preg_replace('/[\r\n]+/', ' ', $subject_contact)
    );
    $html = inrcy_signup_safety_build_mail($contact, $failure, $status, $incident_id);

    $record = array(
        'version' => 1,
        'created_at' => time(),
        'attempts' => 0,
        'next_attempt_at' => 0,
        'dedupe_key' => $dedupe_key,
        'incident_id' => $incident_id,
        'destination' => $destination,
        'subject' => $subject,
        'html' => $html,
    );

    $claim_result = inrcy_signup_safety_claim_outbox($outbox_key, $record);
    if ($claim_result === false) {
        return;
    }
    if ($claim_result === null) {
        // La base WordPress est indisponible : tenter tout de même le mail sans outbox.
        try {
            $sent_without_outbox = wp_mail(
                $destination,
                $subject,
                $html,
                array('Content-Type: text/html; charset=UTF-8')
            ) === true;
        } catch (Throwable $error) {
            unset($error);
            $sent_without_outbox = false;
        }
        error_log(
            '[inrcy-signup-safety-net] outbox unavailable; direct_mail=' .
            ($sent_without_outbox ? 'accepted' : 'failed') .
            '; incident=' . sanitize_key($incident_id)
        );
        return;
    }

    // Le retry durable existe avant le premier wp_mail : un arrêt PHP ne perd rien.
    inrcy_signup_safety_schedule_retry($outbox_key, 300, $incident_id);
    inrcy_signup_safety_deliver_outbox($outbox_key);
}

/** Écrit une option sans l'upsert de add_option() : un seul worker gagne. */
function inrcy_signup_safety_atomic_insert_option($option_name, $value) {
    global $wpdb;

    $serialized = maybe_serialize($value);
    $query = $wpdb->prepare(
        "INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'off')",
        $option_name,
        $serialized
    );
    $result = $wpdb->query($query);
    if ($result === 1) {
        wp_cache_delete($option_name, 'options');
        wp_cache_delete('notoptions', 'options');
        return 'inserted';
    }
    return $result === 0 ? 'exists' : 'error';
}

function inrcy_signup_safety_read_raw_option($option_name) {
    global $wpdb;
    return $wpdb->get_var(
        $wpdb->prepare(
            "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s LIMIT 1",
            $option_name
        )
    );
}

function inrcy_signup_safety_atomic_replace_option($option_name, $expected_raw, $value) {
    global $wpdb;

    $updated = $wpdb->query(
        $wpdb->prepare(
            "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value = %s",
            maybe_serialize($value),
            $option_name,
            $expected_raw
        )
    ) === 1;
    if ($updated) {
        wp_cache_delete($option_name, 'options');
    }
    return $updated;
}

function inrcy_signup_safety_atomic_delete_option($option_name, $expected_raw = null) {
    global $wpdb;

    if ($expected_raw === null) {
        $query = $wpdb->prepare(
            "DELETE FROM {$wpdb->options} WHERE option_name = %s",
            $option_name
        );
    } else {
        $query = $wpdb->prepare(
            "DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s",
            $option_name,
            $expected_raw
        );
    }

    $deleted = $wpdb->query($query) === 1;
    if ($deleted) {
        wp_cache_delete($option_name, 'options');
        wp_cache_delete('notoptions', 'options');
    }
    return $deleted;
}

function inrcy_signup_safety_claim_outbox($outbox_key, $record) {
    $insert_result = inrcy_signup_safety_atomic_insert_option($outbox_key, $record);
    if ($insert_result === 'inserted') {
        return true;
    }

    $existing_raw = inrcy_signup_safety_read_raw_option($outbox_key);
    if ($insert_result === 'error') {
        error_log('[inrcy-signup-safety-net] outbox insert failed; incident=' . sanitize_key((string) ($record['incident_id'] ?? 'inconnu')));
        return null;
    }
    if ($existing_raw === null) {
        $retry_insert = inrcy_signup_safety_atomic_insert_option($outbox_key, $record);
        if ($retry_insert === 'inserted') {
            return true;
        }
        return $retry_insert === 'exists' ? false : null;
    }

    $existing = $existing_raw === null ? null : maybe_unserialize($existing_raw);
    $created_at = is_array($existing) ? (int) ($existing['created_at'] ?? 0) : 0;
    $replace_required = !is_array($existing)
        || (int) ($existing['version'] ?? 0) !== 1
        || $created_at <= 0
        || $created_at < time() - INRCY_SIGNUP_SAFETY_OUTBOX_MAX_AGE;
    if ($replace_required) {
        $lease = inrcy_signup_safety_acquire_lease($outbox_key);
        if ($lease === null) {
            // Impossible de prouver qu'il s'agit d'un vrai doublon : mail direct.
            return null;
        }
        try {
            $current_raw = inrcy_signup_safety_read_raw_option($outbox_key);
            if (
                $current_raw === $existing_raw
                && inrcy_signup_safety_atomic_delete_option($outbox_key, $existing_raw)
            ) {
                $replace_result = inrcy_signup_safety_atomic_insert_option($outbox_key, $record);
                if ($replace_result === 'inserted') {
                    return true;
                }
                return null;
            }
            return null;
        } finally {
            inrcy_signup_safety_release_lease($lease);
        }
    }

    if (is_array($existing)) {
        $next_attempt = max(60, (int) ($existing['next_attempt_at'] ?? time()) - time());
        inrcy_signup_safety_schedule_retry(
            $outbox_key,
            $next_attempt,
            $existing['incident_id'] ?? 'inconnu'
        );
    }

    return false;
}

function inrcy_signup_safety_lease_key($outbox_key) {
    return str_replace(
        'inrcy_signup_fail_outbox_',
        'inrcy_signup_fail_lease_',
        $outbox_key
    );
}

function inrcy_signup_safety_acquire_lease($outbox_key) {
    $lease_key = inrcy_signup_safety_lease_key($outbox_key);
    $lease = array(
        'token' => wp_generate_uuid4(),
        'expires_at' => time() + INRCY_SIGNUP_SAFETY_LEASE_SECONDS,
    );

    if (inrcy_signup_safety_atomic_insert_option($lease_key, $lease) === 'inserted') {
        return array('key' => $lease_key, 'token' => $lease['token']);
    }

    $existing_raw = inrcy_signup_safety_read_raw_option($lease_key);
    $existing = $existing_raw === null ? null : maybe_unserialize($existing_raw);
    if (
        $existing_raw !== null
        && is_array($existing)
        && (int) ($existing['expires_at'] ?? 0) <= time()
        && inrcy_signup_safety_atomic_replace_option($lease_key, $existing_raw, $lease)
    ) {
        return array('key' => $lease_key, 'token' => $lease['token']);
    }

    return null;
}

function inrcy_signup_safety_release_lease($lease) {
    if (!is_array($lease) || empty($lease['key']) || empty($lease['token'])) {
        return;
    }

    $raw = inrcy_signup_safety_read_raw_option($lease['key']);
    $current = $raw === null ? null : maybe_unserialize($raw);
    if (
        is_array($current)
        && isset($current['token'])
        && hash_equals((string) $current['token'], (string) $lease['token'])
    ) {
        inrcy_signup_safety_atomic_delete_option($lease['key'], $raw);
    }
}

function inrcy_signup_safety_retry_outbox($outbox_key) {
    inrcy_signup_safety_deliver_outbox((string) $outbox_key);
}

function inrcy_signup_safety_deliver_outbox($outbox_key) {
    if (strpos($outbox_key, 'inrcy_signup_fail_outbox_') !== 0) {
        return;
    }

    $lease = inrcy_signup_safety_acquire_lease($outbox_key);
    if ($lease === null) {
        return;
    }

    $incident_id = 'inconnu';
    try {
        $record_raw = inrcy_signup_safety_read_raw_option($outbox_key);
        $record = $record_raw === null ? null : maybe_unserialize($record_raw);
        if (!is_array($record) || (int) ($record['version'] ?? 0) !== 1) {
            if ($record_raw !== null) {
                inrcy_signup_safety_atomic_delete_option($outbox_key, $record_raw);
            }
            return;
        }

        $incident_id = sanitize_key((string) ($record['incident_id'] ?? 'inconnu'));
        $created_at = (int) ($record['created_at'] ?? 0);
        if ($created_at <= 0 || $created_at < time() - INRCY_SIGNUP_SAFETY_OUTBOX_MAX_AGE) {
            if (inrcy_signup_safety_atomic_delete_option($outbox_key, $record_raw)) {
                inrcy_signup_safety_unschedule_retry($outbox_key);
            }
            error_log('[inrcy-signup-safety-net] outbox expired; incident=' . $incident_id);
            return;
        }

        $next_attempt_at = (int) ($record['next_attempt_at'] ?? 0);
        if ($next_attempt_at > time()) {
            inrcy_signup_safety_schedule_retry(
                $outbox_key,
                $next_attempt_at - time(),
                $incident_id
            );
            return;
        }

        $dedupe_key = sanitize_key((string) ($record['dedupe_key'] ?? ''));
        $destination = sanitize_email((string) ($record['destination'] ?? ''));
        $subject = preg_replace('/[\r\n]+/', ' ', (string) ($record['subject'] ?? ''));
        $html = (string) ($record['html'] ?? '');

        if ($dedupe_key === '' || $destination === '' || $subject === '' || $html === '') {
            if (inrcy_signup_safety_atomic_delete_option($outbox_key, $record_raw)) {
                inrcy_signup_safety_unschedule_retry($outbox_key);
            }
            error_log('[inrcy-signup-safety-net] invalid outbox; incident=' . $incident_id);
            return;
        }

        if (get_transient($dedupe_key) !== false) {
            if (inrcy_signup_safety_atomic_delete_option($outbox_key, $record_raw)) {
                inrcy_signup_safety_unschedule_retry($outbox_key);
            }
            return;
        }

        $sent = false;
        try {
            $sent = wp_mail(
                $destination,
                $subject,
                $html,
                array('Content-Type: text/html; charset=UTF-8')
            ) === true;
        } catch (Throwable $error) {
            unset($error);
            $sent = false;
        }

        if ($sent) {
            set_transient($dedupe_key, 'sent', INRCY_SIGNUP_SAFETY_DEDUPE_SECONDS);
            if (inrcy_signup_safety_atomic_delete_option($outbox_key, $record_raw)) {
                inrcy_signup_safety_unschedule_retry($outbox_key);
            }
            return;
        }

        $record['attempts'] = (int) ($record['attempts'] ?? 0) + 1;
        $delays = array(300, 1800, 7200, 21600);
        $delay_index = min(count($delays) - 1, max(0, $record['attempts'] - 1));
        $record['next_attempt_at'] = time() + $delays[$delay_index];
        $updated = inrcy_signup_safety_atomic_replace_option($outbox_key, $record_raw, $record);
        inrcy_signup_safety_schedule_retry(
            $outbox_key,
            $updated ? $delays[$delay_index] : 300,
            $incident_id,
            true
        );
        error_log('[inrcy-signup-safety-net] alert queued for retry; incident=' . $incident_id);
    } catch (Throwable $error) {
        unset($error);
        inrcy_signup_safety_schedule_retry($outbox_key, 300, $incident_id, true);
        error_log('[inrcy-signup-safety-net] outbox processing failed; incident=' . $incident_id);
    } finally {
        inrcy_signup_safety_release_lease($lease);
    }
}

function inrcy_signup_safety_schedule_retry($outbox_key, $delay, $incident_id, $force_successor = false) {
    $timestamp = time() + max(60, (int) $delay);

    if (function_exists('as_schedule_single_action') && function_exists('as_has_scheduled_action')) {
        $existing = as_has_scheduled_action(
            INRCY_SIGNUP_SAFETY_RETRY_HOOK,
            array($outbox_key),
            INRCY_SIGNUP_SAFETY_ACTION_GROUP
        );
        if (!$force_successor && $existing !== false) {
            return true;
        }

        $action_id = as_schedule_single_action(
            $timestamp,
            INRCY_SIGNUP_SAFETY_RETRY_HOOK,
            array($outbox_key),
            INRCY_SIGNUP_SAFETY_ACTION_GROUP,
            !$force_successor
        );
        if (is_int($action_id) && $action_id > 0) {
            return true;
        }
    }

    if (wp_next_scheduled(INRCY_SIGNUP_SAFETY_RETRY_HOOK, array($outbox_key))) {
        return true;
    }

    $scheduled = wp_schedule_single_event(
        $timestamp,
        INRCY_SIGNUP_SAFETY_RETRY_HOOK,
        array($outbox_key),
        true
    );
    if ($scheduled !== false && !is_wp_error($scheduled)) {
        return true;
    }

    error_log('[inrcy-signup-safety-net] retry scheduling failed; incident=' . sanitize_key((string) $incident_id));
    return false;
}

function inrcy_signup_safety_unschedule_retry($outbox_key) {
    if (function_exists('as_unschedule_all_actions')) {
        as_unschedule_all_actions(
            INRCY_SIGNUP_SAFETY_RETRY_HOOK,
            array($outbox_key),
            INRCY_SIGNUP_SAFETY_ACTION_GROUP
        );
    }
    wp_clear_scheduled_hook(INRCY_SIGNUP_SAFETY_RETRY_HOOK, array($outbox_key));
}

function inrcy_signup_safety_ensure_sweeper() {
    if (
        function_exists('as_schedule_recurring_action')
        && function_exists('as_has_scheduled_action')
    ) {
        $existing = as_has_scheduled_action(
            INRCY_SIGNUP_SAFETY_SWEEP_HOOK,
            array(),
            INRCY_SIGNUP_SAFETY_ACTION_GROUP
        );
        if ($existing !== false) {
            return;
        }

        $action_id = as_schedule_recurring_action(
                time() + 300,
                300,
                INRCY_SIGNUP_SAFETY_SWEEP_HOOK,
                array(),
                INRCY_SIGNUP_SAFETY_ACTION_GROUP,
                true
        );
        if (is_int($action_id) && $action_id > 0) {
            return;
        }
    }

    if (!wp_next_scheduled(INRCY_SIGNUP_SAFETY_SWEEP_HOOK)) {
        $scheduled = wp_schedule_event(
            time() + 300,
            'hourly',
            INRCY_SIGNUP_SAFETY_SWEEP_HOOK,
            array(),
            true
        );
        if ($scheduled === false || is_wp_error($scheduled)) {
            error_log('[inrcy-signup-safety-net] sweeper scheduling failed');
        }
    }
}

function inrcy_signup_safety_sweep_outbox() {
    global $wpdb;

    $pattern = $wpdb->esc_like('inrcy_signup_fail_outbox_') . '%';
    $cursor = (int) get_transient('inrcy_signup_safety_sweep_cursor');
    $rows = $wpdb->get_results(
        $wpdb->prepare(
            "SELECT option_id, option_name FROM {$wpdb->options} WHERE option_name LIKE %s AND option_id > %d ORDER BY option_id ASC LIMIT 50",
            $pattern,
            $cursor
        )
    );

    if ((!is_array($rows) || $rows === array()) && $cursor > 0) {
        $rows = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT option_id, option_name FROM {$wpdb->options} WHERE option_name LIKE %s ORDER BY option_id ASC LIMIT 50",
                $pattern
            )
        );
    }

    $last_id = 0;
    foreach (is_array($rows) ? $rows : array() as $row) {
        $last_id = max($last_id, (int) $row->option_id);
        inrcy_signup_safety_deliver_outbox((string) $row->option_name);
    }
    if ($last_id > 0) {
        set_transient('inrcy_signup_safety_sweep_cursor', $last_id, 86400);
    }
}

function inrcy_signup_safety_is_target_form($record) {
    if (!is_object($record) || !method_exists($record, 'get')) {
        return false;
    }

    $settings = $record->get('form_settings');
    $settings = is_array($settings) ? $settings : array();
    $form_id = sanitize_key((string) ($settings['id'] ?? $settings['form_id'] ?? ''));
    $form_name = sanitize_key((string) ($settings['form_name'] ?? $settings['name'] ?? ''));

    if ($form_id === INRCY_SIGNUP_SAFETY_FORM_ID) {
        return true;
    }

    return $form_name === INRCY_SIGNUP_SAFETY_FORM_NAME;
}

function inrcy_signup_safety_app_owns_alert($response) {
    if (is_wp_error($response) || !is_array($response)) {
        return false;
    }

    $marker = strtolower(trim((string) wp_remote_retrieve_header($response, 'x-inrcy-signup-alert')));
    if (in_array($marker, array('sent', 'deduplicated'), true)) {
        return true;
    }

    $body = json_decode((string) wp_remote_retrieve_body($response), true);
    return is_array($body)
        && (($body['alert_sent'] ?? null) === true || ($body['alert_deduplicated'] ?? null) === true);
}

function inrcy_signup_safety_is_technical_failure($response, $status) {
    if (is_wp_error($response)) {
        return true;
    }

    if ($status >= 200 && $status < 300) {
        $body = is_array($response)
            ? json_decode((string) wp_remote_retrieve_body($response), true)
            : null;
        return !is_array($body) || ($body['ok'] ?? null) !== true;
    }

    // Erreurs métier attendues : saisie, compte existant ou validation.
    // Un 429 reste un prospect bloqué : le filet doit donc prévenir.
    if (in_array($status, array(400, 409, 422), true)) {
        return false;
    }

    // Inclut absence de réponse, redirection terminale, auth/config, 429 et 5xx.
    return true;
}

function inrcy_signup_safety_read_contact($record) {
    $flat = array();
    $fields = $record->get('fields');
    $sent_data = $record->get('sent_data');

    inrcy_signup_safety_flatten(is_array($fields) ? $fields : array(), $flat);
    inrcy_signup_safety_flatten(is_array($sent_data) ? $sent_data : array(), $flat);
    return inrcy_signup_safety_contact_from_flat($flat);
}

function inrcy_signup_safety_read_contact_from_payload($body) {
    if (is_string($body)) {
        $decoded = json_decode($body, true);
        if (is_array($decoded)) {
            $body = $decoded;
        } else {
            $parsed = array();
            parse_str($body, $parsed);
            $body = $parsed;
        }
    }

    $flat = array();
    inrcy_signup_safety_flatten(is_array($body) ? $body : array(), $flat);
    return inrcy_signup_safety_contact_from_flat($flat);
}

function inrcy_signup_safety_contact_from_flat($flat) {
    $email = sanitize_email(inrcy_signup_safety_lookup($flat, array('email', 'e_mail', 'mail', 'your_email')));
    $consent_raw = strtolower(inrcy_signup_safety_lookup($flat, array('consent', 'consentement', 'acceptance', 'privacy', 'rgpd', 'gdpr')));
    $consent = $consent_raw !== '' && !in_array($consent_raw, array('0', 'false', 'no', 'non', 'off', 'unchecked'), true);

    return array(
        'last_name' => inrcy_signup_safety_clean(inrcy_signup_safety_lookup($flat, array('last_name', 'lastname', 'nom')), 120),
        'first_name' => inrcy_signup_safety_clean(inrcy_signup_safety_lookup($flat, array('first_name', 'firstname', 'prenom')), 120),
        'email' => inrcy_signup_safety_clean(strtolower($email), 320),
        'company_name' => inrcy_signup_safety_clean(inrcy_signup_safety_lookup($flat, array('company_name', 'company', 'societe', 'entreprise')), 200),
        'phone' => inrcy_signup_safety_clean(inrcy_signup_safety_lookup($flat, array('phone', 'telephone', 'tel', 'mobile', 'portable')), 80),
        'honeypot' => inrcy_signup_safety_clean(inrcy_signup_safety_lookup($flat, array('honeypot', 'website_hp', 'inrcy_honeypot', 'inrcy_hp', 'hp', 'website')), 200),
        'consent' => $consent,
    );
}

function inrcy_signup_safety_flatten($value, &$flat, $parent_key = '') {
    if (is_scalar($value)) {
        $key = inrcy_signup_safety_normalize_key($parent_key);
        if ($key !== '') {
            $flat[$key] = inrcy_signup_safety_clean($value, 1000);
        }
        return;
    }

    if (!is_array($value)) {
        return;
    }

    if (array_key_exists('value', $value) && is_scalar($value['value'])) {
        $short_key = inrcy_signup_safety_normalize_key($parent_key);
        if ($short_key !== '') {
            $flat[$short_key] = inrcy_signup_safety_clean($value['value'], 1000);
        }
    }
    if (array_key_exists('raw_value', $value) && is_scalar($value['raw_value'])) {
        $short_key = inrcy_signup_safety_normalize_key($parent_key);
        if ($short_key !== '') {
            $flat[$short_key] = inrcy_signup_safety_clean($value['raw_value'], 1000);
        }
    }

    foreach ($value as $key => $child) {
        $next_key = $parent_key === '' ? (string) $key : $parent_key . '_' . (string) $key;
        inrcy_signup_safety_flatten($child, $flat, $next_key);
    }
}

function inrcy_signup_safety_normalize_key($value) {
    $normalized = strtolower(remove_accents((string) $value));
    $normalized = preg_replace('/[^a-z0-9]+/', '_', $normalized);
    $normalized = trim((string) $normalized, '_');
    $normalized = preg_replace('/^(?:fields?|form_fields|sent_data)_/', '', $normalized);
    $normalized = preg_replace('/_(?:value|raw_value|checked)$/', '', (string) $normalized);
    return trim((string) $normalized, '_');
}

function inrcy_signup_safety_lookup($flat, $aliases) {
    foreach ($aliases as $alias) {
        $normalized_alias = inrcy_signup_safety_normalize_key($alias);
        foreach ($flat as $key => $value) {
            if ($key === $normalized_alias || substr($key, -strlen('_' . $normalized_alias)) === '_' . $normalized_alias) {
                if ((string) $value !== '') {
                    return (string) $value;
                }
            }
        }
    }
    return '';
}

function inrcy_signup_safety_read_failure($response, $status) {
    if (is_wp_error($response)) {
        return array(
            'code' => inrcy_signup_safety_clean($response->get_error_code() ?: 'wordpress_http_error', 100),
            'message' => inrcy_signup_safety_redact($response->get_error_message()),
        );
    }

    $body = json_decode((string) wp_remote_retrieve_body($response), true);
    $message = is_array($body) ? (string) ($body['error'] ?? $body['message'] ?? '') : '';
    return array(
        'code' => 'http_' . (int) $status,
        'message' => inrcy_signup_safety_redact($message !== '' ? $message : 'Réponse technique HTTP ' . (int) $status),
    );
}

function inrcy_signup_safety_read_request_id($response) {
    if (is_wp_error($response) || !is_array($response)) {
        return '';
    }

    $header = inrcy_signup_safety_clean(wp_remote_retrieve_header($response, 'x-request-id'), 160);
    if ($header !== '') {
        return $header;
    }

    $body = json_decode((string) wp_remote_retrieve_body($response), true);
    return is_array($body) ? inrcy_signup_safety_clean($body['request_id'] ?? '', 160) : '';
}

function inrcy_signup_safety_redact($value) {
    $clean = inrcy_signup_safety_clean($value, 500);
    $clean = preg_replace('/\bBearer\s+[A-Za-z0-9._~+\/-]+/i', 'Bearer [REDACTED]', $clean);
    $clean = preg_replace(
        '/\b(password|passwd|token|secret|cookie|authorization|access[_-]?token|refresh[_-]?token|api[_-]?key)\b\s*[:=]\s*(?:"[^"]*"|\'[^\']*\'|[^\s,;&]+)/i',
        '$1=[REDACTED]',
        $clean
    );
    $clean = preg_replace('/([?&](?:token|secret|password|access_token|refresh_token|api_key)=)[^&#\s]+/i', '$1[REDACTED]', $clean);
    return inrcy_signup_safety_clean($clean, 500);
}

function inrcy_signup_safety_clean($value, $max_length) {
    $value = wp_strip_all_tags((string) $value, true);
    $value = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $value);
    $value = preg_replace('/\s+/u', ' ', (string) $value);
    $value = trim((string) $value);
    return function_exists('mb_substr')
        ? mb_substr($value, 0, (int) $max_length)
        : substr($value, 0, (int) $max_length);
}

function inrcy_signup_safety_display($value) {
    return $value !== '' ? $value : 'Non renseigné';
}

function inrcy_signup_safety_row($label, $value, $emphasis = false) {
    return sprintf(
        '<tr><td style="padding:8px 12px 8px 0;color:#64748b;vertical-align:top;">%s</td><td style="padding:8px 0;color:#0f172a;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;%s">%s</td></tr>',
        esc_html($label),
        $emphasis ? 'font-weight:700;' : '',
        esc_html($value)
    );
}

function inrcy_signup_safety_build_mail($contact, $failure, $status, $incident_id) {
    $rows = '';
    $rows .= inrcy_signup_safety_row('Nom', inrcy_signup_safety_display($contact['last_name']), true);
    $rows .= inrcy_signup_safety_row('Prénom', inrcy_signup_safety_display($contact['first_name']), true);
    $rows .= inrcy_signup_safety_row('E-mail', inrcy_signup_safety_display($contact['email']), true);
    $rows .= inrcy_signup_safety_row('Société', inrcy_signup_safety_display($contact['company_name']), true);
    $rows .= inrcy_signup_safety_row('Téléphone', inrcy_signup_safety_display($contact['phone']), true);

    $technical = '';
    $technical .= inrcy_signup_safety_row('Origine', 'Filet WordPress — application injoignable ou sans accusé d’alerte', true);
    $technical .= inrcy_signup_safety_row('Statut HTTP', $status > 0 ? (string) $status : 'Aucune réponse HTTP');
    $technical .= inrcy_signup_safety_row('Code', $failure['code']);
    $technical .= inrcy_signup_safety_row('Détail', $failure['message']);
    $technical .= inrcy_signup_safety_row('Incident ID', $incident_id);
    $technical .= inrcy_signup_safety_row('Date', wp_date('d/m/Y H:i:s'));

    return '
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f7fb;padding:24px;">
          <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:18px;padding:26px;border:1px solid #e5e7eb;">
            <div style="display:inline-block;margin-bottom:14px;padding:7px 11px;border-radius:999px;background:#fee2e2;color:#991b1b;font-size:12px;font-weight:800;text-transform:uppercase;">Filet WordPress activé</div>
            <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a;">Inscription iNrCy bloquée</h1>
            <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.55;">Le formulaire a été validé, mais WordPress n’a pas obtenu une réponse exploitable de l’application. Contactez rapidement ce prospect.</p>
            <div style="margin:0 0 18px;padding:18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
              <div style="margin:0 0 8px;color:#0f172a;font-size:13px;font-weight:800;text-transform:uppercase;">Contact à récupérer</div>
              <table style="width:100%;border-collapse:collapse;font-size:14px;table-layout:fixed;">' . $rows . '</table>
            </div>
            <div style="padding:18px;border-radius:14px;background:#fff7ed;border:1px solid #fed7aa;">
              <div style="margin:0 0 8px;color:#9a3412;font-size:12px;font-weight:800;text-transform:uppercase;">Diagnostic technique</div>
              <table style="width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed;">' . $technical . '</table>
            </div>
          </div>
        </div>';
}

} // Fin du garde anti-double-chargement.
