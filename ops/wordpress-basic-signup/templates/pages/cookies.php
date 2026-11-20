<?php if (!defined('ABSPATH')) { exit; } ?>
<section class="basic-site-cookies"><h1>Politique de cookies (UE)</h1><div class="basic-site-legal-content">
    <?php if (shortcode_exists('cmplz-document')) : ?><?php echo inrcy_basic_site_confine_document_links(do_shortcode('[cmplz-document type="cookie-statement" region="eu"]')); ?><?php else : ?><div class="basic-site-info-card"><h2>Gestion des cookies</h2><p>Le gestionnaire de préférences sera disponible avec la configuration de cookies du site.</p><a href="<?php echo esc_url(inrcy_basic_site_url('contact')); ?>">Contacter iNrCy Basique</a></div><?php endif; ?>
</div></section>
