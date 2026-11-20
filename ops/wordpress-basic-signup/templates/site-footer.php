<?php if (!defined('ABSPATH')) { exit; } ?>
<footer class="inrcy-footer">
    <div class="inrcy-footer-bg-glow" aria-hidden="true"></div>
    <div class="inrcy-footer-container">
        <section class="inrcy-footer-cta">
            <div class="inrcy-footer-cta-content"><h2>Et si votre communication arrêtait enfin <span>de vous prendre du temps ?</span></h2></div>
            <a href="<?php echo esc_url($signup_url); ?>" class="inrcy-footer-cta-btn">Créer mon compte <span aria-hidden="true">→</span></a>
        </section>
        <div class="inrcy-footer-panel">
            <div class="inrcy-footer-main">
                <div class="inrcy-footer-brand">
                    <div class="inrcy-footer-logo"><a href="<?php echo esc_url(inrcy_basic_site_url()); ?>" class="inrcy-footer-logo-link" aria-label="Accueil iNrCy">
                        <span class="inrcy-footer-brand-logo"><span class="inrcy-footer-newton" aria-hidden="true"><span class="inrcy-footer-newton-frame"></span><span class="inrcy-footer-newton-ball inrcy-footer-newton-b1"></span><span class="inrcy-footer-newton-ball inrcy-footer-newton-b2"></span><span class="inrcy-footer-newton-ball inrcy-footer-newton-b3"></span></span><span class="inrcy-footer-logo-word">iNrCy</span></span>
                    </a></div>
                    <p>La plateforme pensée pour les professionnels qui veulent rester visibles sans transformer leur communication en deuxième métier.</p>
                </div>
                <div class="inrcy-footer-col"><h3>Navigation</h3>
                    <?php foreach (array('home', 'pricing', 'faq', 'directory') as $key) : ?><a class="inrcy-footer-nav-link" href="<?php echo esc_url(inrcy_basic_site_url($key)); ?>"><?php echo esc_html($menu[$key]); ?></a><?php endforeach; ?>
                </div>
                <div class="inrcy-footer-col"><h3>iNrCy</h3>
                    <a class="inrcy-footer-nav-link" href="<?php echo esc_url($signup_url); ?>">S’inscrire</a>
                    <a class="inrcy-footer-nav-link" href="<?php echo esc_url($login_url); ?>">Se connecter</a>
                    <a class="inrcy-footer-nav-link" href="<?php echo esc_url(inrcy_basic_site_url('blog')); ?>">Blog</a>
                    <a class="inrcy-footer-nav-link" href="<?php echo esc_url(inrcy_basic_site_url('contact')); ?>">Nous contacter</a>
                </div>
                <div class="inrcy-footer-col inrcy-footer-contact-col"><div class="inrcy-footer-contact-box">
                    <div class="inrcy-contact-heading"><strong>Besoin d’aide ?</strong><span>Notre équipe est disponible pour vous accompagner.</span></div>
                    <div class="inrcy-contact-details">
                        <a href="mailto:contact@inrcy.com" class="inrcy-contact-detail inrcy-contact-email"><span class="inrcy-contact-icon" aria-hidden="true">✉</span><span>contact@inrcy.com</span></a>
                        <a href="tel:+33631260812" class="inrcy-contact-detail inrcy-contact-phone"><span class="inrcy-contact-icon" aria-hidden="true">☎</span><span>0631260812</span></a>
                    </div>
                    <div class="inrcy-contact-actions">
                        <a href="tel:+33631260812" class="inrcy-contact-action inrcy-contact-action-call" aria-label="Appeler iNrCy"><span>Appeler</span></a>
                        <a href="<?php echo esc_url(inrcy_basic_site_url('contact')); ?>" class="inrcy-contact-action inrcy-contact-action-write"><span>Nous écrire</span><span aria-hidden="true">→</span></a>
                    </div>
                </div></div>
            </div>
            <div class="inrcy-footer-bottom"><div>© <?php echo esc_html(date('Y')); ?> iNrCy — Tous droits réservés</div><div class="inrcy-footer-bottom-links">
                <?php foreach (array('legal' => 'Mentions légales', 'privacy' => 'Politique de confidentialité', 'terms' => 'CGA', 'cookies' => 'Cookies') as $key => $label) : ?><a href="<?php echo esc_url(inrcy_basic_site_url($key)); ?>"><?php echo esc_html($label); ?></a><?php endforeach; ?>
            </div></div>
        </div>
    </div>
</footer>
<?php if ($view !== 'signup') : ?>
<div class="inrcy-float-booksy-wrap">
    <a href="<?php echo esc_url($signup_url); ?>" class="inrcy-float-booksy"><span class="inrcy-float-booksy-badge" aria-hidden="true">✦</span><span class="inrcy-float-booksy-content"><span class="inrcy-float-booksy-kicker">Dès 29 € HT / mois</span><span class="inrcy-float-booksy-title">Créer mon compte</span></span><span class="inrcy-float-booksy-arrow" aria-hidden="true">→</span></a>
    <button type="button" class="inrcy-float-booksy-close" aria-label="Fermer le raccourci d’inscription">×</button>
</div>
<?php endif; ?>
