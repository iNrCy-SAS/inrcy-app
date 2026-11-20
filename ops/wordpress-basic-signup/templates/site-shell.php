<?php
if (!defined('ABSPATH')) { exit; }
$menu = array('home' => 'Accueil', 'features' => 'Nos Outils', 'pricing' => 'Nos Packs', 'blog' => 'Blog', 'faq' => 'FAQ', 'contact' => 'Contact', 'directory' => "iNr'Annuaire");
$signup_url = inrcy_basic_site_url('signup');
$login_url = inrcy_basic_site_login_url();
ob_start();
include __DIR__ . '/language-switcher.php';
$switcher = trim(ob_get_clean());
?>
<div class="inrcy-basic-site">
    <a class="basic-site-skip" href="#basic-site-content">Aller au contenu</a>
    <div class="inrcy-header-zone">
        <header class="inrcy-fixed-header basic-site-header">
            <div class="inrcy-header">
                <a href="<?php echo esc_url(inrcy_basic_site_url()); ?>" class="inrcy-header-logo" aria-label="Accueil iNrCy">
                    <span class="inrcy-header-brand">
                        <span class="inrcy-logo-newton" aria-hidden="true"><span class="inrcy-logo-frame"></span><span class="inrcy-logo-ball inrcy-logo-b1"></span><span class="inrcy-logo-ball inrcy-logo-b2"></span><span class="inrcy-logo-ball inrcy-logo-b3"></span></span>
                        <span class="inrcy-logo-word">iNrCy</span>
                    </span>
                </a>
                <nav class="inrcy-nav" id="basic-site-navigation" aria-label="Navigation principale">
                    <?php foreach ($menu as $key => $label) : ?>
                        <?php if ($key === 'features') : ?><div class="inrcy-nav-group"><?php endif; ?>
                        <a href="<?php echo esc_url(inrcy_basic_site_url($key)); ?>" class="inrcy-nav-link<?php echo $key === $view ? ' active' : ''; ?>" <?php echo $key === $view ? 'aria-current="page"' : ''; ?>><?php echo esc_html($label); ?></a>
                        <?php if ($key === 'features') : ?>
                            <button type="button" class="inrcy-submenu-toggle" aria-label="Afficher les outils iNrCy" aria-expanded="false" aria-controls="basic-site-tools"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 9 7 7 7-7"/></svg></button>
                            <div class="inrcy-submenu" id="basic-site-tools" role="group" aria-label="Outils iNrCy">
                                <?php foreach (inrcy_basic_tools() as $slug => $tool_label) : ?><a href="<?php echo esc_url(inrcy_basic_tool_url($slug)); ?>"><?php echo esc_html($tool_label); ?></a><?php endforeach; ?>
                            </div></div>
                        <?php endif; ?>
                    <?php endforeach; ?>
                    <div class="inrcy-mobile-actions"><a href="<?php echo esc_url($login_url); ?>" class="inrcy-mobile-login">Connexion</a><a href="<?php echo esc_url($signup_url); ?>" class="inrcy-mobile-cta">Créer mon compte <span aria-hidden="true">→</span></a></div>
                </nav>
                <div class="inrcy-header-actions">
                    <a href="<?php echo esc_url($login_url); ?>" class="inrcy-login">Connexion</a>
                    <a href="<?php echo esc_url($signup_url); ?>" class="inrcy-header-cta">Créer mon compte <span class="inrcy-header-arrow" aria-hidden="true">→</span></a>
                    <?php if ($switcher !== '') : ?><div class="basic-language-desktop"><?php echo $switcher; // Escaped in language-switcher.php. ?></div><?php endif; ?>
                </div>
                <button type="button" class="inrcy-mobile-toggle basic-site-menu" aria-label="Menu" aria-expanded="false" aria-controls="basic-site-navigation"><span></span><span></span><span></span></button>
                <?php if ($switcher !== '') : ?><div class="basic-language-mobile"><?php echo $switcher; ?></div><?php endif; ?>
            </div>
        </header>
        <div class="inrcy-header-spacer" aria-hidden="true"></div>
    </div>
    <?php if (inrcy_basic_site_preview()) : ?><div class="basic-site-preview">Prévisualisation administrateur</div><?php endif; ?>
    <main id="basic-site-content">
        <?php
        $template = in_array($view, array('terms', 'privacy', 'legal'), true) ? 'legal' : $view;
        include __DIR__ . '/pages/' . $template . '.php';
        ?>
    </main>
    <?php include __DIR__ . '/site-footer.php'; ?>
</div>
