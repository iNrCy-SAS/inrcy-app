<?php
if (!defined('ABSPATH')) { exit; }

function inrcy_basic_editorial_url($args = array(), $preview = null) {
    $url = inrcy_basic_site_url('blog', $preview);
    return $args ? add_query_arg($args, $url) : $url;
}

function inrcy_basic_blog_public_post($article) {
    return $article && ($article->post_type ?? '') === 'post' && ($article->post_status ?? '') === 'publish'
        && ($article->post_password ?? '') === '';
}

function inrcy_basic_blog_meta($defaults) {
    $raw = $_GET['article'] ?? null;
    if (is_string($raw) && preg_match('/^[1-9][0-9]{0,9}$/D', $raw)) {
        $post = get_post((int) $raw);
        if (inrcy_basic_blog_public_post($post)) {
            $defaults['title'] = inrcy_basic_blog_title($post) . ' · Blog iNrCy';
            $defaults['url'] = inrcy_basic_editorial_url(array('article' => $post->ID), false);
        }
    } elseif (isset($_GET['rubrique']) && is_string($_GET['rubrique']) && preg_match('/^[a-z0-9-]{1,180}$/D', $_GET['rubrique']) && function_exists('get_category_by_slug')) {
        $category = get_category_by_slug($_GET['rubrique']);
        if ($category) {
            $args = array('rubrique' => $category->slug);
            if (isset($_GET['pageno']) && is_string($_GET['pageno']) && preg_match('/^[1-9][0-9]{0,4}$/D', $_GET['pageno']) && (int) $_GET['pageno'] > 1) {
                $args['pageno'] = (int) $_GET['pageno'];
            }
            $defaults['title'] = $category->name . ' · Blog iNrCy';
            $defaults['url'] = inrcy_basic_editorial_url($args, false);
        }
    }
    return $defaults;
}

function inrcy_basic_blog_title($article) {
    $title = get_the_title($article);
    return inrcy_basic_blog_trial_text($title) ? 'Découvrir iNrCy' : $title;
}

function inrcy_basic_blog_url_for_link($href) {
    $href = trim(html_entity_decode($href, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    if ($href === '' || $href[0] === '#' || preg_match('/^(?:mailto:|tel:|sms:)/i', $href)) { return $href; }
    $url = wp_parse_url($href);
    if (!is_array($url) || (isset($url['scheme']) && !in_array(strtolower($url['scheme']), array('https', 'http'), true))) { return ''; }
    $host = strtolower($url['host'] ?? '');
    $path = trim($url['path'] ?? '', '/');
    if ($host === 'app.inrcy.com') { return inrcy_basic_site_login_url(); }
    if ($host !== '' && !in_array($host, array('inrcy.com', 'www.inrcy.com', wp_parse_url(home_url())['host'] ?? ''), true)) { return $href; }
    if (strpos($path, 'basique/') === 0 || strpos($path, 'wp-content/uploads/') === 0) { return $href; }
    if (preg_match('~^category/([a-z0-9-]+)(?:/page/([1-9][0-9]*))?$~D', $path, $match)) {
        $args = array('rubrique' => $match[1]);
        if (isset($match[2])) { $args['pageno'] = (int) $match[2]; }
        return inrcy_basic_editorial_url($args);
    }
    $views = array('' => 'home', 'inscription' => 'signup', 'nos-outils' => 'features', 'nos-packs' => 'pricing', 'faq' => 'faq',
        'contact' => 'contact', 'blog' => 'blog', 'blog-conseils-generateur' => 'blog', 'annuaire' => 'directory', 'mentions-legales' => 'legal',
        'politique-de-confidentialite' => 'privacy', 'cga-conditions-generales-dabonnement' => 'terms');
    if (isset($views[$path])) { return inrcy_basic_site_url($views[$path]); }
    if (preg_match('~^nos-outils/([a-z-]+)$~D', $path, $match) && isset(inrcy_basic_tools()[$match[1]])) { return inrcy_basic_tool_url($match[1]); }
    $id = function_exists('url_to_postid') ? url_to_postid(home_url('/' . $path . '/')) : 0;
    if ($id && inrcy_basic_blog_public_post(get_post($id))) { return inrcy_basic_editorial_url(array('article' => (int) $id)); }
    return '';
}

function inrcy_basic_blog_rebase_links($html) {
    if (!class_exists('WP_HTML_Tag_Processor')) { return ''; }
    $tags = new WP_HTML_Tag_Processor($html);
    while ($tags->next_tag('a')) {
        $href = $tags->get_attribute('href');
        if (!is_string($href)) { continue; }
        $url = inrcy_basic_blog_url_for_link($href);
        if ($url === '') { $tags->remove_attribute('href'); }
        else { $tags->set_attribute('href', $url); }
    }
    return $tags->get_updated_html();
}

function inrcy_basic_blog_elementor_widgets($nodes, $types) {
    $result = array();
    foreach ($nodes as $node) {
        if (!is_array($node)) { continue; }
        if (isset($node['widgetType']) && in_array($node['widgetType'], $types, true)) { $result[] = $node; }
        elseif (!empty($node['elements']) && is_array($node['elements'])) {
            $result = array_merge($result, inrcy_basic_blog_elementor_widgets($node['elements'], $types));
        }
    }
    return $result;
}

function inrcy_basic_blog_elementor_data($post) {
    if (!function_exists('get_post_meta')) { return array(); }
    $raw = get_post_meta($post->ID, '_elementor_data', true);
    $data = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
    return is_array($data) ? $data : array();
}

/** Use the published editorial page's native HTML widgets, without running its
 * third-party scripts or general signup form. The local template holds the
 * reviewed equivalent for a missing source, unsupported widget, or new offer. */
function inrcy_basic_blog_landing() {
    $page = get_page_by_path('blog-conseils-generateur');
    if (!$page || $page->post_status !== 'publish' || !empty($page->post_password)) { return array(); }
    $widgets = inrcy_basic_blog_elementor_widgets(inrcy_basic_blog_elementor_data($page), array('html'));
    if (array_column($widgets, 'id') !== array('3c2885e', '6b0a06a', '3f757b9')) { return array(); }
    $adapted = array();
    foreach ($widgets as $widget) {
        $raw = $widget['settings']['html'] ?? '';
        if (!is_string($raw) || $raw === '') { return array(); }
        $html = preg_replace('~<script\b[^>]*>.*?</script\s*>~is', '', $raw);
        if (preg_match('~<(?:form|iframe|object|embed|base|meta|link)\b|\son[a-z]+\s*=|javascript\s*:|\bsrcdoc\s*=~i', $html)) { return array(); }
        $html = str_ireplace(array('Puis-je essayer iNrCy gratuitement ?', 'Essayer gratuitement', 'CTA ESSAI GRATUIT'),
            array('Comment créer mon compte iNrCy ?', 'Créer mon compte', 'CTA INSCRIPTION'), $html);
        $html = preg_replace('~Oui\.\s*Vous pouvez découvrir la plateforme gratuitement pendant\s*21 jours afin de tester son fonctionnement et ses fonctionnalités\.~iu',
            'Créez votre compte, ouvrez l’application puis choisissez votre abonnement.', $html);
        $html = preg_replace('~content:\s*(["\x27])21 jours\1~iu', 'content:"Basique"', $html);
        $html = preg_replace('~/\*[^*]*21 jours[^*]*\*/~iu', '', $html);
        if (preg_match('~\b(?:essai|essais|tester gratuitement|gratuitement pendant|21\s*jours?)\b~iu', $html)) { return array(); }
        $html = inrcy_basic_blog_rebase_links($html);
        if ($html === '') { return array(); }
        $adapted[] = $html;
    }
    return $adapted;
}

function inrcy_basic_blog_detail() {
    if (!isset($_GET['rubrique']) && !isset($_GET['article'])) { return false; }
    $directory = __DIR__ . '/../templates/pages/';
    $raw_id = $_GET['article'] ?? null;
    $slug = $_GET['rubrique'] ?? null;
    if ($raw_id !== null && is_string($raw_id) && preg_match('/^[1-9][0-9]{0,9}$/D', $raw_id)) {
        $article = get_post((int) $raw_id);
        if (inrcy_basic_blog_public_post($article)) {
            include $directory . 'blog-article.php';
            return true;
        }
    } elseif ($raw_id === null && is_string($slug) && preg_match('/^[a-z0-9-]{1,180}$/D', $slug) && function_exists('get_category_by_slug')) {
        $category = get_category_by_slug($slug);
        if ($category && class_exists('WP_Query')) {
            $raw_page = $_GET['pageno'] ?? '1';
            $page_number = is_string($raw_page) && preg_match('/^[1-9][0-9]{0,4}$/D', $raw_page) ? (int) $raw_page : 1;
            $listing = new WP_Query(array('post_type' => 'post', 'post_status' => 'publish', 'has_password' => false, 'ignore_sticky_posts' => true,
                'cat' => (int) $category->term_id, 'paged' => $page_number, 'posts_per_page' => 10));
            include $directory . 'blog-category.php';
            return true;
        }
    }
    echo '<p class="inrcy-blog-empty">Contenu indisponible. <a href="' . esc_url(inrcy_basic_site_url('blog')) . '">Retour au blog</a></p>';
    return true;
}

function inrcy_basic_blog_cards($posts) {
    if (!$posts) { echo '<p>Aucun article dans cette rubrique pour le moment.</p>'; }
    foreach ($posts as $entry) {
        if (!inrcy_basic_blog_public_post($entry)) { continue; }
        $url = inrcy_basic_editorial_url(array('article' => (int) $entry->ID));
        $image = get_the_post_thumbnail($entry, 'medium', array('loading' => 'lazy'));
        $excerpt = wp_strip_all_tags(get_the_excerpt($entry));
        if (inrcy_basic_blog_trial_text($excerpt)) { $excerpt = ''; }
        ?>
        <article class="elementor-post elementor-grid-item" role="listitem">
            <?php if ($image) : ?><a class="elementor-post__thumbnail__link" href="<?php echo esc_url($url); ?>" aria-hidden="true" tabindex="-1"><div class="elementor-post__thumbnail"><?php echo $image; ?></div></a><?php endif; ?>
            <div class="elementor-post__text"><h3 class="elementor-post__title"><a href="<?php echo esc_url($url); ?>"><?php echo esc_html(inrcy_basic_blog_title($entry)); ?></a></h3>
                <div class="elementor-post__meta-data"><?php echo esc_html(get_the_date('', $entry)); ?></div>
                <?php if ($excerpt !== '') : ?><div class="elementor-post__excerpt"><p><?php echo esc_html($excerpt); ?></p></div><?php endif; ?>
                <div class="elementor-post__read-more-wrapper"><a class="elementor-post__read-more" href="<?php echo esc_url($url); ?>">Lire la suite »</a></div>
            </div>
        </article>
        <?php
    }
}

function inrcy_basic_blog_related($article) {
    if (!class_exists('WP_Query')) { return; }
    $listing = new WP_Query(array('post_type' => 'post', 'post_status' => 'publish', 'has_password' => false, 'ignore_sticky_posts' => true,
        'post__not_in' => array((int) $article->ID), 'posts_per_page' => 4, 'no_found_rows' => true));
    echo '<div class="elementor-posts-container elementor-posts elementor-posts--skin-classic elementor-grid" role="list">';
    inrcy_basic_blog_cards($listing->posts);
    echo '</div>';
}

function inrcy_basic_blog_byline($article) {
    echo '<ul class="elementor-inline-items elementor-icon-list-items elementor-post-info"><li class="elementor-icon-list-item elementor-inline-item"><time>' . esc_html(get_the_date('', $article)) . '</time></li>';
    $categories = function_exists('get_the_category') ? get_the_category($article->ID) : array();
    foreach ($categories as $category) {
        echo '<li class="elementor-icon-list-item elementor-inline-item"><a href="' . esc_url(inrcy_basic_editorial_url(array('rubrique' => $category->slug))) . '">' . esc_html($category->name) . '</a></li>';
    }
    echo '</ul>';
}

function inrcy_basic_blog_post_navigation($article) {
    if (!function_exists('get_adjacent_post')) { return; }
    $previous = $GLOBALS['post'] ?? null;
    $GLOBALS['post'] = $article;
    try {
        $neighbors = array('prev' => get_adjacent_post(false, '', true), 'next' => get_adjacent_post(false, '', false));
    } finally {
        $GLOBALS['post'] = $previous;
    }
    echo '<nav aria-label="Navigation de publication" class="elementor-post-navigation">';
    foreach ($neighbors as $rel => $neighbor) {
        if (!inrcy_basic_blog_public_post($neighbor)) { continue; }
        $label = $rel === 'prev' ? '← Précédent' : 'Suivant →';
        echo '<div class="elementor-post-navigation__' . $rel . ' elementor-post-navigation__link"><a rel="' . $rel . '" href="' . esc_url(inrcy_basic_editorial_url(array('article' => $neighbor->ID))) . '"><span>' . $label . '</span> <span>' . esc_html(inrcy_basic_blog_title($neighbor)) . '</span></a></div>';
    }
    echo '</nav>';
}

function inrcy_basic_blog_pagination($category, $current, $pages) {
    if ($pages < 2) { return; }
    echo '<nav aria-label="Pages des articles" class="elementor-pagination">';
    foreach (array($current - 1 => '← Précédent', $current + 1 => 'Suivant →') as $page => $label) {
        if ($page < 1 || $page > $pages) { continue; }
        echo '<a class="page-numbers" href="' . esc_url(inrcy_basic_editorial_url(array('rubrique' => $category->slug, 'pageno' => $page))) . '">' . esc_html($label) . '</a> ';
    }
    echo '</nav>';
}

function inrcy_basic_blog_trial_text($text) {
    return preg_match('~\b(?:essai(?:s)?\s+(?:gratuit|Standard|de\s+21)|(?:durée|période|jours?)\s+d[’\x27]essai|(?:testez|essayez|essayer|tester)\s+(?:iNrCy\s+)?gratuitement|21\s*(?:jours?|j)\s*(?:gratuits?|offerts?))\b~iu', $text);
}

function inrcy_basic_blog_body($article) {
    $widgets = inrcy_basic_blog_elementor_widgets(inrcy_basic_blog_elementor_data($article), array('text-editor', 'heading', 'image'));
    $body = '';
    foreach ($widgets as $widget) {
        $settings = $widget['settings'] ?? array();
        if ($widget['widgetType'] === 'text-editor' && is_string($settings['editor'] ?? null)) {
            $body .= $settings['editor'];
        } elseif ($widget['widgetType'] === 'heading') {
            $body .= '<h2>' . esc_html($settings['title'] ?? '') . '</h2>';
        } elseif (!empty($settings['image']['id'])) {
            $body .= wp_get_attachment_image((int) $settings['image']['id'], 'large');
        }
    }
    if (trim($body) === '') { $body = wpautop($article->post_content); }
    // No stored form, embeds, shortcodes or executable markup enter the Basic page.
    $body = preg_replace('~<(script|style|iframe|form|object|video|audio)\b[^>]*>.*?</\1\s*>~is', '', $body);
    $body = wp_kses_post(strip_shortcodes($body));
    $body = preg_replace_callback('~<(p|li|h[1-6]|figcaption|a)\b([^>]*)>(.*?)</\1>~is', function ($part) {
        if (!inrcy_basic_blog_trial_text(html_entity_decode(wp_strip_all_tags($part[3]), ENT_QUOTES | ENT_HTML5, 'UTF-8'))) { return $part[0]; }
        return '<p><a href="' . esc_url(inrcy_basic_site_url('signup')) . '">Créer mon compte iNrCy</a></p>';
    }, $body);
    return inrcy_basic_blog_rebase_links($body);
}
