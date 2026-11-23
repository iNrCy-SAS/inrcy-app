<?php if (!defined('ABSPATH')) { exit; } ?>
<section class="inrcy-generator-hero">
    <div class="inrcy-generator-hero-inner">
        <div class="inrcy-generator-kicker"><span aria-hidden="true"></span>Générateur iNrCy</div>
        <h1 class="inrcy-generator-title">S’inscrire</h1>
        <p class="inrcy-generator-subtitle">Créez votre compte et découvrez l’application. Un abonnement est nécessaire pour publier et utiliser les fonctions IA.</p>
        <div class="inrcy-generator-tags"><span class="basic-site-signup-inline-price"><?php echo esc_html($catalogue['monthly_price_eur']); ?> € HT / mois en Basique</span><span>Multi-canaux</span></div>
    </div>
</section>
<div class="basic-site-signup-form-wrap"><?php include __DIR__ . '/../signup-form.php'; ?></div>
