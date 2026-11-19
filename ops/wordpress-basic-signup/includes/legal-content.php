<?php
if (!defined('ABSPATH')) { exit; }

/** Reviewed documents are supplied separately; this renderer creates no legal text. */
function inrcy_basic_site_legal_bundle() {
    $bundle = array('documents' => array(), 'consent_html' => '');
    $reviewed_file = __DIR__ . '/legal-reviewed.php';
    if (is_file($reviewed_file)) {
        $reviewed = require $reviewed_file;
        if (is_array($reviewed)) { $bundle = array_merge($bundle, $reviewed); }
    }
    return apply_filters('inrcy_basic_site_legal_bundle', $bundle);
}

function inrcy_basic_site_legal_document($key) {
    if (!in_array($key, array('terms', 'privacy', 'legal'), true)) { return null; }
    $bundle = inrcy_basic_site_legal_bundle();
    $document = $bundle['documents'][$key] ?? null;
    return is_array($document) && ($document['reviewed'] ?? false) === true && !empty($document['html']) ? $document : null;
}

function inrcy_basic_site_legal_ready() {
    $bundle = inrcy_basic_site_legal_bundle();
    return !empty($bundle['consent_html']) && inrcy_basic_site_legal_document('terms')
        && inrcy_basic_site_legal_document('privacy') && inrcy_basic_site_legal_document('legal');
}

function inrcy_basic_site_consent_html() {
    $bundle = inrcy_basic_site_legal_bundle();
    return wp_kses_post(inrcy_basic_site_confine_document_links((string) ($bundle['consent_html'] ?? '')));
}
