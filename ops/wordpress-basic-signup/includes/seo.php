<?php
if (!defined('ABSPATH')) { exit; }

function inrcy_basic_site_metadata() {
    $view = inrcy_basic_site_view();
    $descriptions = array(
        'blog' => 'Les conseils, idées et stratégies d’iNrCy pour votre communication.',
        'directory' => 'Trouvez un professionnel par métier et par lieu dans iNr’Annuaire.',
        'home' => 'iNrCy Basique : vos outils de création, publication et suivi à 29 € HT par mois, avec 50 crédits médias mensuels. Vous gardez la main.',
        'features' => 'Découvrez les outils du pack iNrCy Basique : 50 crédits médias mensuels, publication sur vos canaux connectés, assistant et suivi de votre activité.',
        'pricing' => 'Le pack iNrCy Basique à 29 € HT par mois : 50 crédits médias mensuels et vos outils essentiels. Abonnement mensuel, activation après paiement.',
        'faq' => 'Les réponses à vos questions sur iNrCy Basique : fonctionnalités, 50 crédits médias mensuels, inscription, accès et activation de votre abonnement.',
        'signup' => 'Créez votre compte iNrCy Basique, retrouvez vos identifiants puis choisissez votre pack dans l’application. Basique à 29 € HT par mois.',
        'contact' => 'Contactez l’équipe iNrCy pour votre compte, vos accès ou votre abonnement Basique.',
        'terms' => 'Consultez les conditions d’abonnement de votre espace iNrCy Basique.',
        'privacy' => 'Consultez les informations de confidentialité de votre espace iNrCy Basique.',
        'cookies' => 'Retrouvez les informations et les préférences de cookies de votre espace iNrCy Basique.',
        'legal' => 'Consultez les mentions légales de votre espace iNrCy Basique.',
    );
    $pages = inrcy_basic_site_pages();
    $tool = $view === 'features' ? inrcy_basic_current_tool() : null;
    if ($tool !== null) {
        $name = inrcy_basic_tools()[$tool];
        return array('title' => $name . ' · Les outils iNrCy', 'description' => 'Découvrez ' . $name . ' et les packs iNrCy qui vous permettent de l’utiliser.',
            'url' => inrcy_basic_tool_url($tool, false), 'image' => inrcy_basic_site_asset_url('logo-inrcy-transparent.png'));
    }
    $meta = array('title' => $view === 'home' ? 'iNrCy Basique · Vos outils à 29 € HT / mois' : $pages[$view]['title'] . ' · iNrCy Basique',
        'description' => $descriptions[$view], 'url' => inrcy_basic_site_url($view, false), 'image' => inrcy_basic_site_asset_url('logo-inrcy-transparent.png'));
    return $view === 'blog' ? inrcy_basic_blog_meta($meta) : $meta;
}

function inrcy_basic_site_schema() {
    $meta = inrcy_basic_site_metadata();
    $home = inrcy_basic_site_url('home', false);
    $graph = array(
        array('@type' => 'WebSite', '@id' => $home . '#website', 'url' => $home, 'name' => 'iNrCy Basique', 'inLanguage' => 'fr-FR'),
        array('@type' => 'WebPage', '@id' => $meta['url'] . '#webpage', 'url' => $meta['url'], 'name' => $meta['title'], 'description' => $meta['description'], 'isPartOf' => array('@id' => $home . '#website'), 'inLanguage' => 'fr-FR'),
    );
    if (in_array(inrcy_basic_site_view(), array('home', 'features', 'pricing'), true)) {
        $catalogue = inrcy_basic_site_catalogue();
        $graph[] = array('@type' => 'SoftwareApplication', '@id' => $home . '#application', 'name' => 'iNrCy Basique', 'url' => $home,
            'applicationCategory' => 'BusinessApplication', 'operatingSystem' => 'Web',
            'featureList' => array('50 crédits médias par mois', 'Outils de publication sur 11 canaux connectés compatibles', 'Accompagnement iNr’Assistant'),
            'offers' => array('@type' => 'Offer', 'url' => inrcy_basic_site_url('pricing', false), 'price' => $catalogue['monthly_price_eur'], 'priceCurrency' => 'EUR',
                'priceSpecification' => array('@type' => 'UnitPriceSpecification', 'price' => $catalogue['monthly_price_eur'], 'priceCurrency' => 'EUR', 'valueAddedTaxIncluded' => false, 'billingDuration' => 'P1M')));
    }
    if (inrcy_basic_site_view() === 'faq') {
        $questions = array();
        foreach (inrcy_basic_site_catalogue()['faq'] as $faq) { $questions[] = array('@type' => 'Question', 'name' => $faq['question'], 'acceptedAnswer' => array('@type' => 'Answer', 'text' => $faq['answer'])); }
        $graph[] = array('@type' => 'FAQPage', '@id' => $meta['url'] . '#questions', 'mainEntity' => $questions);
    }
    return array('@context' => 'https://schema.org', '@graph' => $graph);
}

function inrcy_basic_site_seo_value($field, $original) {
    return inrcy_basic_site_rendered() ? inrcy_basic_site_metadata()[$field] : $original;
}
add_filter('pre_get_document_title', function ($value) { return inrcy_basic_site_seo_value('title', $value); }, 999);
add_filter('get_canonical_url', function ($value) { return inrcy_basic_site_seo_value('url', $value); }, 999);
add_filter('rank_math/frontend/title', function ($value) { return inrcy_basic_site_seo_value('title', $value); }, 999);
add_filter('rank_math/frontend/description', function ($value) { return inrcy_basic_site_seo_value('description', $value); }, 999);
add_filter('rank_math/frontend/canonical', function ($value) { return inrcy_basic_site_seo_value('url', $value); }, 999);
add_filter('rank_math/opengraph/url', function ($value) { return inrcy_basic_site_seo_value('url', $value); }, 999);
foreach (array('facebook', 'twitter') as $network) {
    foreach (array('og_title' => 'title', 'title' => 'title', 'twitter_title' => 'title', 'og_description' => 'description', 'description' => 'description', 'twitter_description' => 'description', 'og_url' => 'url', 'url' => 'url', 'image' => 'image') as $property => $field) {
        add_filter('rank_math/opengraph/' . $network . '/' . $property, function ($value) use ($field) { return inrcy_basic_site_seo_value($field, $value); }, 999);
    }
}
add_filter('rank_math/json_ld', function ($value) { return inrcy_basic_site_rendered() ? array() : $value; }, 999);
add_filter('wp_robots', function ($value) {
    if (inrcy_basic_site_rendered() && (inrcy_basic_site_preview() || (in_array(inrcy_basic_site_view(), array('terms', 'privacy', 'legal'), true) && !inrcy_basic_site_legal_document(inrcy_basic_site_view())))) { $value['noindex'] = true; $value['nofollow'] = true; }
    return $value;
}, 999);
add_filter('rank_math/frontend/robots', function ($value) {
    if (inrcy_basic_site_rendered() && inrcy_basic_site_preview()) { $value['index'] = 'noindex'; $value['follow'] = 'nofollow'; }
    return $value;
}, 999);

add_action('wp_head', function () {
    if (!inrcy_basic_site_rendered()) { return; }
    $meta = inrcy_basic_site_metadata();
    // Rank Math receives the same values through its documented scoped filters.
    if (!defined('RANK_MATH_VERSION')) {
        echo '<meta name="description" content="' . esc_attr($meta['description']) . '"><link rel="canonical" href="' . esc_url($meta['url']) . '">';
        foreach (array('og:type' => 'website', 'og:title' => $meta['title'], 'og:description' => $meta['description'], 'og:url' => $meta['url'], 'og:image' => $meta['image'], 'og:site_name' => 'iNrCy Basique') as $key => $value) { echo '<meta property="' . esc_attr($key) . '" content="' . esc_attr($value) . '">'; }
        foreach (array('twitter:card' => 'summary', 'twitter:title' => $meta['title'], 'twitter:description' => $meta['description'], 'twitter:image' => $meta['image']) as $key => $value) { echo '<meta name="' . esc_attr($key) . '" content="' . esc_attr($value) . '">'; }
    }
    echo '<script type="application/ld+json">' . wp_json_encode(inrcy_basic_site_schema(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) . '</script>';
}, 15);
