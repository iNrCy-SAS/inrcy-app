<?php if (!defined('ABSPATH')) { exit; } ?>
<section class="basic-site-page-intro basic-site-legal-intro"><div class="basic-site-container"><p class="basic-site-eyebrow">VOTRE ESPACE INRCY BASIQUE</p><h1>Cookies et préférences</h1></div></section>
<section class="basic-site-section basic-site-section-first"><div class="basic-site-container basic-site-legal-content">
    <?php if (shortcode_exists('cmplz-document')) : ?><?php echo inrcy_basic_site_confine_document_links(do_shortcode('[cmplz-document type="cookie-statement" region="eu"]')); ?><?php else : ?><div class="basic-site-info-card"><h2>Gestion des cookies</h2><p>Le gestionnaire de préférences sera disponible avec la configuration de cookies du site.</p><a href="<?php echo esc_url(inrcy_basic_site_url('contact')); ?>">Contacter iNrCy Basique</a></div><?php endif; ?>
</div></section>
