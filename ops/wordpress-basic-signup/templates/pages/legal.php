<?php if (!defined('ABSPATH')) { exit; } $document = inrcy_basic_site_legal_document($view); ?>
<section class="basic-site-page-intro basic-site-legal-intro"><div class="basic-site-container"><p class="basic-site-eyebrow">VOTRE ESPACE INRCY BASIQUE</p><h1><?php echo esc_html($document['title'] ?? $pages[$view]['heading']); ?></h1></div></section>
<section class="basic-site-section basic-site-section-first"><div class="basic-site-container basic-site-legal-content">
    <?php if ($document) : ?><?php echo wp_kses_post(inrcy_basic_site_confine_document_links($document['html'])); ?><?php else : ?><div class="basic-site-info-card"><h2>Document en cours de validation</h2><p>Le contenu de cette page sera disponible après sa revue. Vous pouvez contacter l’équipe pour toute question.</p><a href="<?php echo esc_url(inrcy_basic_site_url('contact')); ?>">Contacter iNrCy Basique <span aria-hidden="true">→</span></a></div><?php endif; ?>
</div></section>
