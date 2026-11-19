<?php if (!defined('ABSPATH')) { exit; } ?>
<div class="inrcy-basic-site">
    <a class="basic-site-skip" href="#basic-site-content">Aller au contenu</a>
    <?php if (inrcy_basic_site_preview()) : ?><div class="basic-site-preview">Prévisualisation administrateur · le mini-site n’est pas publié par cette vue.</div><?php endif; ?>
    <header class="basic-site-header"><div class="basic-site-container basic-site-header-inner">
        <a class="basic-site-brand" href="<?php echo esc_url(inrcy_basic_site_url()); ?>" aria-label="iNrCy Basique, accueil"><img src="<?php echo esc_url(inrcy_basic_site_asset_url('logo-inrcy-transparent.png')); ?>" alt="" width="40" height="40"><span>iNrCy <small>Basique</small></span></a>
        <button class="basic-site-menu" type="button" aria-expanded="false" aria-controls="basic-site-navigation"><span>Menu</span><i aria-hidden="true"></i></button>
        <nav class="basic-site-navigation" id="basic-site-navigation" aria-label="Navigation Basique">
            <?php foreach (array('home', 'features', 'pricing', 'faq', 'contact') as $key) : ?><a href="<?php echo esc_url(inrcy_basic_site_url($key)); ?>" <?php echo $view === $key ? 'aria-current="page"' : ''; ?>><?php echo esc_html($pages[$key]['title']); ?></a><?php endforeach; ?>
            <a class="basic-site-login" href="<?php echo esc_url(inrcy_basic_site_login_url()); ?>">Se connecter <span aria-hidden="true">↗</span></a>
            <a class="basic-site-button basic-site-nav-cta" href="<?php echo esc_url(inrcy_basic_site_url('signup')); ?>" <?php echo $view === 'signup' ? 'aria-current="page"' : ''; ?>>Créer mon compte <span aria-hidden="true">→</span></a>
        </nav>
    </div></header>
    <main class="inrcy-basic-page" id="basic-site-content">
        <?php
        $template = in_array($view, array('terms', 'privacy', 'legal'), true) ? 'legal' : $view;
        include __DIR__ . '/pages/' . $template . '.php';
        ?>
    </main>
    <footer class="basic-site-footer"><div class="basic-site-container">
        <div class="basic-site-footer-top"><div><a class="basic-site-brand" href="<?php echo esc_url(inrcy_basic_site_url()); ?>"><span>iNrCy <small>Basique</small></span></a><p>Gardez la main sur votre visibilité.</p></div>
            <div><strong>Votre espace Basique</strong><a href="<?php echo esc_url(inrcy_basic_site_url('features')); ?>">Fonctionnalités</a><a href="<?php echo esc_url(inrcy_basic_site_url('pricing')); ?>">Tarif</a><a href="<?php echo esc_url(inrcy_basic_site_url('faq')); ?>">Questions fréquentes</a></div>
            <div><strong>Pour vous accompagner</strong><a href="<?php echo esc_url(inrcy_basic_site_url('signup')); ?>">Créer mon compte</a><a href="<?php echo esc_url(inrcy_basic_site_login_url()); ?>">Connexion à l’application</a><a href="<?php echo esc_url(inrcy_basic_site_url('contact')); ?>">Nous contacter</a></div>
        </div>
        <div class="basic-site-footer-bottom"><span>© <?php echo esc_html(date('Y')); ?> iNrCy</span><div><?php foreach (array('terms', 'privacy', 'cookies', 'legal') as $key) : ?><a href="<?php echo esc_url(inrcy_basic_site_url($key)); ?>"><?php echo esc_html($pages[$key]['title']); ?></a><?php endforeach; ?></div></div>
    </div></footer>
</div>
