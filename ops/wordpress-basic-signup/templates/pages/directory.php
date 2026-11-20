<?php
if (!defined('ABSPATH')) { exit; }
if (shortcode_exists('inrcy_directory')) {
    // The directory plugin supplies the current results, filters and pagination.
    echo inrcy_basic_site_confine_document_links(do_shortcode('[inrcy_directory]'));
} else {
    echo '<p role="status">L’annuaire est momentanément indisponible.</p>';
}
