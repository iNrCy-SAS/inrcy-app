<?php
if (!defined('ABSPATH')) { exit; }
$configured = inrcy_basic_signup_secret() !== '';
$legal_ready = inrcy_basic_site_legal_ready();
$consent = inrcy_basic_site_consent_html();
?>
<section class="inrcy-basic-card basic-site-form-card" aria-labelledby="inrcy-basic-form-title">
    <p class="basic-site-eyebrow">VOTRE POINT DE DÉPART</p><h2 id="inrcy-basic-form-title">Créer mon compte</h2><p>Vos identifiants s’affichent après votre inscription réussie.</p>
    <?php if (!$configured) : ?><p role="status">L’inscription sera disponible prochainement.</p><?php endif; ?>
    <?php if (!$legal_ready) : ?><p class="basic-site-pending" role="status">Les informations d’abonnement sont en cours de validation. Le formulaire sera disponible après cette étape.</p><?php endif; ?>
    <form name="inrcy_basic_signup" class="inrcy-basic-form" method="post" novalidate>
        <div class="inrcy-basic-pair"><label>Nom<input name="form_fields[last_name]" autocomplete="family-name" maxlength="100" required></label><label>Prénom<input name="form_fields[first_name]" autocomplete="given-name" maxlength="100" required></label></div>
        <label>E-mail<input type="email" name="form_fields[email]" autocomplete="email" maxlength="254" required></label>
        <label>Société <span>(facultatif)</span><input name="form_fields[company_name]" autocomplete="organization" maxlength="200"></label>
        <label>Tél.<input type="tel" name="form_fields[phone]" autocomplete="tel" maxlength="80" required></label>
        <div class="inrcy-basic-honeypot" aria-hidden="true"><label>Site internet<input name="form_fields[website]" tabindex="-1" autocomplete="off"></label></div>
        <label class="inrcy-basic-consent"><input type="checkbox" name="form_fields[consent]" value="1" required <?php disabled(!$legal_ready); ?>><span><?php echo $consent !== '' ? $consent : 'Documents d’abonnement en cours de validation.'; // Already restricted by wp_kses_post. ?></span></label>
        <button type="submit" <?php disabled(!$configured || !$legal_ready); ?>>Créer mon compte et choisir mon offre <span aria-hidden="true">→</span></button>
        <p class="basic-site-form-note">Aucun paiement à cette étape. Vous choisissez et confirmez votre pack dans l’application.</p>
        <p class="inrcy-basic-status" role="status" aria-live="polite"></p>
    </form>
</section>
