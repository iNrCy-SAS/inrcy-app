<?php
/**
 * Plugin Name: iNrCy Annuaire
 * Description: Affiche les professionnels inscrits à iNr’Annuaire et leurs QR codes iNr’Badge.
 * Version: 2.0.0
 * Author: iNrCy
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

define('INRCY_DIRECTORY_API_URL', 'https://app.inrcy.com/api/public/directory');
define('INRCY_DIRECTORY_CACHE_TTL', HOUR_IN_SECONDS);
define('INRCY_DIRECTORY_STALE_TTL', DAY_IN_SECONDS);
define('INRCY_DIRECTORY_CACHE_VERSION_OPTION', 'inrcy_directory_cache_version');
define('INRCY_DIRECTORY_PAGE_QUERY_ARG', 'inrcy_page');

function inrcy_directory_cache_version() {
    $version = absint(get_option(INRCY_DIRECTORY_CACHE_VERSION_OPTION, 1));
    return max(1, $version);
}

function inrcy_directory_bump_cache_version() {
    $version = inrcy_directory_cache_version() + 1;
    update_option(INRCY_DIRECTORY_CACHE_VERSION_OPTION, $version, false);
    return $version;
}

function inrcy_directory_purge_secret() {
    if (defined('INRCY_DIRECTORY_PURGE_SECRET')) {
        return trim((string) constant('INRCY_DIRECTORY_PURGE_SECRET'));
    }

    $secret = getenv('INRCY_DIRECTORY_PURGE_SECRET');
    return is_string($secret) ? trim($secret) : '';
}

function inrcy_directory_verify_purge_request($request) {
    $secret = inrcy_directory_purge_secret();
    if (strlen($secret) < 32) {
        return new WP_Error(
            'inrcy_directory_purge_not_configured',
            'La purge sécurisée de l’annuaire n’est pas configurée.',
            array('status' => 503)
        );
    }

    $timestamp = trim((string) $request->get_header('x-inrcy-timestamp'));
    $signature = strtolower(trim((string) $request->get_header('x-inrcy-signature')));
    if (!preg_match('/^[0-9]{10}$/', $timestamp) || abs(time() - (int) $timestamp) > 300) {
        return new WP_Error(
            'inrcy_directory_purge_expired',
            'Horodatage de purge invalide ou expiré.',
            array('status' => 401)
        );
    }
    if (!preg_match('/^[a-f0-9]{64}$/', $signature)) {
        return new WP_Error(
            'inrcy_directory_purge_signature_missing',
            'Signature de purge invalide.',
            array('status' => 401)
        );
    }

    $expected = hash_hmac('sha256', $timestamp . '.' . $request->get_body(), $secret);
    if (!hash_equals($expected, $signature)) {
        return new WP_Error(
            'inrcy_directory_purge_signature_mismatch',
            'Signature de purge refusée.',
            array('status' => 403)
        );
    }

    return true;
}

function inrcy_directory_purge_cache($request) {
    $response = new WP_REST_Response(
        array(
            'ok' => true,
            'cacheVersion' => inrcy_directory_bump_cache_version(),
            'purgedAt' => gmdate('c'),
        ),
        200
    );
    $response->header('Cache-Control', 'no-store, max-age=0');
    return $response;
}

function inrcy_directory_register_rest_routes() {
    register_rest_route(
        'inrcy/v1',
        '/directory-cache/purge',
        array(
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => 'inrcy_directory_purge_cache',
            'permission_callback' => 'inrcy_directory_verify_purge_request',
        )
    );
}

add_action('rest_api_init', 'inrcy_directory_register_rest_routes');

function inrcy_directory_get_filter($key) {
    if (!isset($_GET[$key]) || is_array($_GET[$key])) {
        return '';
    }

    return sanitize_text_field(wp_unslash($_GET[$key]));
}

function inrcy_directory_api_url($filters, $page = 1) {
    $query = array(
        'page' => max(1, absint($page)),
        'pageSize' => 12,
    );

    foreach (array('q', 'metier', 'secteur', 'ville', 'departement', 'region') as $key) {
        if (!empty($filters[$key])) {
            $query[$key] = $filters[$key];
        }
    }

    return add_query_arg($query, INRCY_DIRECTORY_API_URL);
}

function inrcy_directory_empty_result() {
    return array('ok' => false, 'items' => array(), 'total' => 0, 'facets' => array());
}

function inrcy_directory_fetch($filters, $page = 1) {
    $url = inrcy_directory_api_url($filters, $page);
    $cache_suffix = inrcy_directory_cache_version() . '_' . md5($url);
    $cache_key = 'inrcy_directory_' . $cache_suffix;
    $stale_cache_key = 'inrcy_directory_stale_' . $cache_suffix;
    $cached = get_transient($cache_key);

    if (is_array($cached)) {
        return $cached;
    }

    $response = wp_remote_get($url, array(
        'timeout' => 3,
        'headers' => array(
            'Accept' => 'application/json',
            'User-Agent' => 'iNrCy-WordPress-Directory/1.0',
        ),
    ));

    if (is_wp_error($response)) {
        $stale = get_transient($stale_cache_key);
        return is_array($stale) ? $stale : inrcy_directory_empty_result();
    }

    $status = wp_remote_retrieve_response_code($response);
    $body = json_decode(wp_remote_retrieve_body($response), true);

    if ($status < 200 || $status >= 300 || !is_array($body) || empty($body['ok'])) {
        $stale = get_transient($stale_cache_key);
        return is_array($stale) ? $stale : inrcy_directory_empty_result();
    }

    set_transient($cache_key, $body, INRCY_DIRECTORY_CACHE_TTL);
    set_transient($stale_cache_key, $body, INRCY_DIRECTORY_STALE_TTL);
    return $body;
}

function inrcy_directory_render_options($items, $selected) {
    if (!is_array($items)) {
        return;
    }

    $current_sector = null;
    foreach ($items as $item) {
        if (!is_array($item) || empty($item['slug']) || empty($item['label'])) {
            continue;
        }

        if (isset($item['sector'])) {
            $sector = sanitize_text_field((string) $item['sector']);
            if ($sector !== $current_sector) {
                if ($current_sector !== null) echo '</optgroup>';
                echo '<optgroup label="' . esc_attr($sector) . '">';
                $current_sector = $sector;
            }
        }
        $value = sanitize_text_field((string) $item['slug']);
        $label = sanitize_text_field((string) $item['label']);
        $count = isset($item['count']) ? absint($item['count']) : 0;
        printf(
            '<option value="%1$s"%2$s>%3$s%4$s</option>',
            esc_attr($value),
            selected($selected, $value, false),
            esc_html($label),
            esc_html(' (' . $count . ')')
        );
    }
    if ($current_sector !== null) echo '</optgroup>';
}

function inrcy_directory_render_pagination($page, $has_next, $filters, $total, $page_size = 12) {
    $links = array();
    $page_count = max(1, (int) ceil($total / max(1, $page_size)));

    if ($page_count <= 1) {
        return '';
    }

    if ($page > 1) {
        $links[] = sprintf(
            '<a class="inrcy-directory__page" href="%s">← Précédent</a>',
            esc_url(add_query_arg(array_merge($filters, array(INRCY_DIRECTORY_PAGE_QUERY_ARG => $page - 1)), get_permalink()))
        );
    }

    $start = max(1, $page - 2);
    $end = min($page_count, $start + 4);
    $start = max(1, $end - 4);

    for ($number = $start; $number <= $end; $number++) {
        $url = esc_url(add_query_arg(array_merge($filters, array(INRCY_DIRECTORY_PAGE_QUERY_ARG => $number)), get_permalink()));
        if ($number === $page) {
            $links[] = sprintf(
                '<span class="inrcy-directory__page inrcy-directory__page--current" aria-current="page">%s</span>',
                esc_html($number)
            );
        } else {
            $links[] = sprintf(
                '<a class="inrcy-directory__page" href="%s">%s</a>',
                $url,
                esc_html($number)
            );
        }
    }

    if ($has_next) {
        $links[] = sprintf(
            '<a class="inrcy-directory__page" href="%s">Suivant →</a>',
            esc_url(add_query_arg(array_merge($filters, array(INRCY_DIRECTORY_PAGE_QUERY_ARG => $page + 1)), get_permalink()))
        );
    }

    if (!$links) {
        return '';
    }

    return '<nav class="inrcy-directory__pagination" aria-label="Pagination de l’annuaire">' . implode('', $links) . '</nav>';
}

function inrcy_directory_render_schema($data) {
    if (empty($data['items']) || !is_array($data['items'])) {
        return '';
    }

    $elements = array();
    foreach ($data['items'] as $position => $item) {
        if (!is_array($item) || empty($item['url']) || empty($item['companyName'])) {
            continue;
        }

        $business = array(
            '@type' => 'LocalBusiness',
            '@id' => esc_url_raw($item['url']) . '#business',
            'url' => esc_url_raw($item['url']),
            'name' => sanitize_text_field((string) $item['companyName']),
        );

        if (!empty($item['pageDescription'])) {
            $business['description'] = sanitize_text_field((string) $item['pageDescription']);
        }

        $city = sanitize_text_field((string) ($item['city'] ?? ''));
        $region = sanitize_text_field((string) ($item['region'] ?? ''));
        if ($city || $region) {
            $business['address'] = array_filter(array(
                '@type' => 'PostalAddress',
                'addressLocality' => $city,
                'addressRegion' => $region,
                'addressCountry' => 'FR',
            ));
        }

        if (!empty($item['profession'])) {
            $business['knowsAbout'] = sanitize_text_field((string) $item['profession']);
        }

        $elements[] = array(
            '@type' => 'ListItem',
            'position' => $position + 1,
            'url' => esc_url_raw($item['url']),
            'name' => sanitize_text_field((string) $item['companyName']),
            'item' => $business,
        );
    }

    if (!$elements) {
        return '';
    }

    $schema = array(
        '@context' => 'https://schema.org',
        '@type' => 'CollectionPage',
        'name' => 'Annuaire iNrCy des professionnels',
        'url' => get_permalink(),
        'mainEntity' => array(
            '@type' => 'ItemList',
            'numberOfItems' => count($elements),
            'itemListElement' => $elements,
        ),
    );

    return '<script type="application/ld+json">' . wp_json_encode($schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . '</script>';
}

function inrcy_directory_shortcode() {
    $filters = array(
        'q' => inrcy_directory_get_filter('q'),
        'metier' => inrcy_directory_get_filter('metier'),
        'secteur' => inrcy_directory_get_filter('secteur'),
        'ville' => inrcy_directory_get_filter('ville'),
        'departement' => inrcy_directory_get_filter('departement'),
        'region' => inrcy_directory_get_filter('region'),
    );
    $page = max(1, absint(inrcy_directory_get_filter(INRCY_DIRECTORY_PAGE_QUERY_ARG)));
    $data = inrcy_directory_fetch($filters, $page);
    $facets = !empty($data['facets']) && is_array($data['facets']) ? $data['facets'] : array();
    $items = !empty($data['items']) && is_array($data['items']) ? $data['items'] : array();
    $total = isset($data['total']) ? absint($data['total']) : 0;
    $has_next = !empty($data['hasNext']);
    $active_filters = array_filter($filters);

    ob_start();
    ?>
    <section class="inrcy-directory" aria-labelledby="inrcy-directory-title">
        <div class="inrcy-directory__hero">
            <span class="inrcy-directory__eyebrow">Annuaire professionnel iNrCy</span>
            <h1 id="inrcy-directory-title">Trouvez le bon professionnel près de chez vous</h1>
            <p>Trouvez un professionnel par métier et par lieu. Scannez son QR code ou ouvrez son iNr’Badge pour le découvrir et le contacter.</p>
        </div>

        <form class="inrcy-directory__filters" method="get" action="<?php echo esc_url(get_permalink()); ?>" role="search">
            <label class="inrcy-directory__field inrcy-directory__field--wide">
                <span>Recherche</span>
                <input type="search" name="q" value="<?php echo esc_attr($filters['q']); ?>" placeholder="Métier, entreprise ou besoin…">
            </label>
            <label class="inrcy-directory__field">
                <span>Métier</span>
                <select name="metier">
                    <option value="">Tous les métiers</option>
                    <?php inrcy_directory_render_options($facets['professions'] ?? array(), $filters['metier']); ?>
                </select>
            </label>
            <label class="inrcy-directory__field">
                <span>Ville</span>
                <select name="ville">
                    <option value="">Toutes les villes</option>
                    <?php inrcy_directory_render_options($facets['cities'] ?? array(), $filters['ville']); ?>
                </select>
            </label>
            <label class="inrcy-directory__field">
                <span>Région</span>
                <select name="region">
                    <option value="">Toutes les régions</option>
                    <?php inrcy_directory_render_options($facets['regions'] ?? array(), $filters['region']); ?>
                </select>
            </label>
            <button class="inrcy-directory__submit" type="submit">Rechercher</button>
            <?php if ($active_filters) : ?>
                <a class="inrcy-directory__reset" href="<?php echo esc_url(get_permalink()); ?>">Réinitialiser</a>
            <?php endif; ?>
        </form>

        <div class="inrcy-directory__summary" aria-live="polite">
            <strong><?php echo esc_html(number_format_i18n($total)); ?></strong>
            professionnel<?php echo $total > 1 ? 's' : ''; ?> référencé<?php echo $total > 1 ? 's' : ''; ?>
        </div>

        <?php if (!empty($data['ok']) && $items) : ?>
            <div class="inrcy-directory__grid">
                <?php foreach ($items as $item) : ?>
                    <?php
                    if (!is_array($item) || empty($item['url']) || empty($item['companyName'])) {
                        continue;
                    }
                    $location = implode(' · ', array_filter(array(
                        sanitize_text_field((string) ($item['city'] ?? '')),
                        sanitize_text_field((string) ($item['department'] ?? '')),
                        sanitize_text_field((string) ($item['region'] ?? '')),
                    )));
                    ?>
                    <article class="inrcy-directory__card">
                        <div class="inrcy-directory__card-top">
                            <span class="inrcy-directory__card-kicker">Professionnel iNrCy</span>
                            <span class="inrcy-directory__card-mark" aria-hidden="true">iN</span>
                        </div>
                        <h2><?php echo esc_html($item['companyName']); ?></h2>
                        <?php if (!empty($item['profession'])) : ?>
                            <p class="inrcy-directory__profession"><?php echo esc_html($item['profession']); ?></p>
                        <?php endif; ?>
                        <?php if ($location) : ?>
                            <p class="inrcy-directory__location" title="<?php echo esc_attr($location); ?>">⌖ <?php echo esc_html($location); ?></p>
                        <?php endif; ?>
                        <?php if (!empty($item['qrUrl'])) : ?>
                            <a class="inrcy-directory__qr" href="<?php echo esc_url(add_query_arg('src', 'directory', $item['url'])); ?>" aria-label="<?php echo esc_attr(sprintf('Ouvrir l’iNr’Badge de %s', (string) $item['companyName'])); ?>">
                                <img src="<?php echo esc_url($item['qrUrl']); ?>" width="140" height="140" loading="lazy" alt="<?php echo esc_attr(sprintf('QR code vers l’iNr’Badge de %s', (string) $item['companyName'])); ?>" />
                                <span>Scannez pour faire connaissance</span>
                            </a>
                        <?php endif; ?>
                        <a
                            class="inrcy-directory__card-link"
                            href="<?php echo esc_url($item['url']); ?>"
                            aria-label="<?php echo esc_attr(sprintf('Ouvrir l’iNr’Badge de %s', (string) $item['companyName'])); ?>"
                        >
                            <span>Ouvrir l’iNr’Badge</span>
                            <span class="inrcy-directory__card-arrow" aria-hidden="true">↗</span>
                        </a>
                    </article>
                <?php endforeach; ?>
            </div>
        <?php elseif (!empty($data['ok'])) : ?>
            <div class="inrcy-directory__empty">
                <h2>Aucun professionnel ne correspond à cette recherche</h2>
                <p>Essayez un métier, une ville ou une recherche plus générale.</p>
            </div>
        <?php else : ?>
            <div class="inrcy-directory__empty">
                <h2>L’annuaire se met à jour</h2>
                <p>Les profils seront de nouveau disponibles dans quelques instants.</p>
            </div>
        <?php endif; ?>

        <?php echo inrcy_directory_render_pagination($page, $has_next, $active_filters, $total, isset($data['pageSize']) ? absint($data['pageSize']) : 12); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>

        <aside class="inrcy-directory__join" aria-labelledby="inrcy-directory-join-title">
            <div>
                <span class="inrcy-directory__join-kicker">Professionnels</span>
                <h2 id="inrcy-directory-join-title">Vous souhaitez être trouvé par vos futurs clients&nbsp;?</h2>
                <p>Activez votre présence depuis la bulle iNr’Annuaire de votre application. Votre fiche renvoie directement à votre iNr’Badge.</p>
            </div>
            <a class="inrcy-directory__join-link" href="<?php echo esc_url(home_url('/s-inscrire/')); ?>">
                Activer ma visibilité <span aria-hidden="true">↗</span>
            </a>
        </aside>

        <p class="inrcy-directory__note">Les profils sont publiés et actualisés automatiquement depuis iNrCy.</p>
    </section>
    <?php
    echo inrcy_directory_render_schema($data); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
    return ob_get_clean();
}

add_shortcode('inrcy_directory', 'inrcy_directory_shortcode');

function inrcy_directory_body_class($classes) {
    if (!is_singular()) {
        return $classes;
    }

    global $post;
    if ($post && has_shortcode((string) $post->post_content, 'inrcy_directory')) {
        $classes[] = 'inrcy-directory-page';
    }

    return $classes;
}

add_filter('body_class', 'inrcy_directory_body_class');

function inrcy_directory_enqueue_styles() {
    if (!is_singular()) {
        return;
    }

    $post = get_post();
    if (!$post || !has_shortcode((string) $post->post_content, 'inrcy_directory')) {
        return;
    }

    wp_register_style('inrcy-directory', false, array(), '2.0.0');
    wp_enqueue_style('inrcy-directory');
    $css = <<<'INRCY_DIRECTORY_CSS'
        .inrcy-directory-page .ast-article-single>.entry-header{display:none}
        body.inrcy-directory-page .inrcy-directory{box-sizing:border-box;width:min(100%,1320px);max-width:1320px;margin:0 auto;padding:64px 24px 88px;color:#101a38;font-size:16px;line-height:1.5}
        body.inrcy-directory-page .inrcy-directory *,body.inrcy-directory-page .inrcy-directory *::before,body.inrcy-directory-page .inrcy-directory *::after{box-sizing:border-box}
        body.inrcy-directory-page .inrcy-directory__hero{max-width:820px;margin:0 auto 28px;text-align:center}
        body.inrcy-directory-page .inrcy-directory__eyebrow{display:inline-flex;padding:8px 15px;border:1px solid #ffd2e5;border-radius:999px;color:#6d43a8;background:#fff7fb;font-size:13px;font-weight:800;letter-spacing:.03em}
        body.inrcy-directory-page .inrcy-directory h1{margin:18px 0 13px;font-size:clamp(36px,4.5vw,58px);font-weight:850;line-height:1.04;letter-spacing:-.04em;background:linear-gradient(90deg,#f72f91,#ff684f,#7449e7,#119df5);-webkit-background-clip:text;background-clip:text;color:transparent}
        body.inrcy-directory-page .inrcy-directory__hero p{max-width:760px;margin:0 auto;color:#60708f;font-size:17px;line-height:1.65}
        body.inrcy-directory-page .inrcy-directory__filters{display:grid;grid-template-columns:minmax(260px,2fr) repeat(3,minmax(150px,1fr)) auto;gap:12px;align-items:end;margin:30px 0 20px;padding:20px;border:1px solid #e5e9f5;border-radius:22px;background:#fff;box-shadow:0 18px 50px rgba(31,48,105,.10)}
        body.inrcy-directory-page .inrcy-directory__field{display:grid;gap:7px;margin:0;color:#344260;font-size:12px;font-weight:850;letter-spacing:.04em;text-transform:uppercase}
        body.inrcy-directory-page .inrcy-directory__field input,body.inrcy-directory-page .inrcy-directory__field select{width:100%;min-height:48px;margin:0;padding:0 14px;border:1px solid #dce2f1;border-radius:12px;background:#f9faff;color:#172242;font-family:inherit;font-size:15px;font-weight:500;line-height:1.2;letter-spacing:0;text-transform:none;box-shadow:none}
        body.inrcy-directory-page .inrcy-directory__field input:hover,body.inrcy-directory-page .inrcy-directory__field select:hover{border-color:#b8c3df}
        body.inrcy-directory-page .inrcy-directory__submit{min-height:48px;margin:0;padding:0 22px;border:0;border-radius:999px;background:linear-gradient(100deg,#ff3d9a,#ff654d,#8d43e7,#149cf5);color:#fff;font-family:inherit;font-size:14px;font-weight:850;line-height:1;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;box-shadow:0 10px 24px rgba(146,67,231,.22);transition:transform .18s ease,box-shadow .18s ease}
        body.inrcy-directory-page .inrcy-directory__submit:hover{transform:translateY(-2px);box-shadow:0 14px 28px rgba(146,67,231,.3)}
        body.inrcy-directory-page .inrcy-directory__reset{grid-column:1/-1;width:max-content;color:#6a45be;font-size:14px;font-weight:750;text-decoration:underline;text-underline-offset:3px}
        body.inrcy-directory-page .inrcy-directory__summary{margin:24px 0 16px;color:#687693;font-size:15px}
        body.inrcy-directory-page .inrcy-directory__summary strong{color:#16213f;font-size:22px}
        body.inrcy-directory-page .inrcy-directory__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:18px;position:relative;isolation:isolate;align-items:stretch}
        body.inrcy-directory-page .inrcy-directory__card{position:relative;isolation:isolate;display:flex;min-width:0;overflow:hidden;flex-direction:column;padding:18px 20px 12px;border:1px solid #7187c64d;border-radius:22px;background:linear-gradient(145deg,#0b1734 0%,#101835 64%,#151533 100%);box-shadow:inset 0 1px 0 #dceaff24,inset 1px 0 0 #b3d8ff0a,0 10px 24px #12223d15;color:#f7faff;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
        body.inrcy-directory-page .inrcy-directory__card::before{content:"";position:absolute;z-index:-1;inset:0;pointer-events:none;background:radial-gradient(ellipse at 0 0,#5eb8ed12,transparent 52%),radial-gradient(ellipse at 100% 100%,#aa62e414,transparent 58%),linear-gradient(125deg,#ffffff06,transparent 38%)}
        body.inrcy-directory-page .inrcy-directory__card::after{content:"";position:absolute;inset:1px;border-radius:21px;border-top:1px solid #b6dcff24;pointer-events:none}
        body.inrcy-directory-page .inrcy-directory__card:hover,body.inrcy-directory-page .inrcy-directory__card:focus-within{transform:translateY(-3px);border-color:#91b4e78c;box-shadow:inset 0 1px 0 #dceaff32,0 16px 30px #12223d24}
        body.inrcy-directory-page .inrcy-directory__card-top{display:flex;justify-content:space-between;align-items:center;gap:10px}
        body.inrcy-directory-page .inrcy-directory__card-kicker{font-size:10px;line-height:1.4;letter-spacing:.06em;font-weight:800;color:#c2c8ff;text-transform:uppercase}
        body.inrcy-directory-page .inrcy-directory__card-mark{display:grid;place-items:center;width:27px;height:27px;flex-shrink:0;background:linear-gradient(135deg,#ed4baf,#8355e8,#2b9cf6);border:1px solid #b0c8ff45;border-radius:9px;color:#fff;font-size:10px;font-weight:800}
        body.inrcy-directory-page .inrcy-directory__card h2{font-size:23px;letter-spacing:-.025em;line-height:1.15;font-weight:750;color:#f7faff;margin:13px 0 8px;overflow-wrap:anywhere}
        body.inrcy-directory-page .inrcy-directory__profession{font-size:14px;line-height:1.4;color:#ff8cc5;font-weight:750;margin:0}
        body.inrcy-directory-page .inrcy-directory__location{font-size:13px;line-height:1.5;color:#d0ddf2;margin:8px 0 0;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;block-size:3em;min-block-size:3em;overflow:hidden;flex-shrink:0}
        body.inrcy-directory-page .inrcy-directory__qr{display:flex;flex-direction:column;align-items:center;gap:7px;margin:auto 0 12px;padding:14px 0 0;color:#cbd8ef;text-decoration:none;text-align:center;flex-shrink:0}
        body.inrcy-directory-page .inrcy-directory__qr img{display:block;width:124px;height:124px;box-sizing:border-box;padding:5px;background:#fff;border-radius:13px;box-shadow:0 4px 14px #00000024;flex-shrink:0}
        body.inrcy-directory-page .inrcy-directory__qr span{display:flex;max-width:100%;color:#cbd8ef;font-size:12px;font-weight:500;line-height:1.4;text-align:center;block-size:2.8em;min-block-size:2.8em;align-items:center;justify-content:center}
        body.inrcy-directory-page .inrcy-directory__card-link{position:relative;display:flex;box-sizing:border-box;align-items:center;justify-content:center;gap:8px;min-height:44px;margin-top:0;padding:8px 31px 0;border-top:1px solid #b4c8ef26;color:#fff;text-decoration:none;font-size:14px;line-height:1.35;font-weight:750;text-align:center;height:44px;flex-shrink:0}
        body.inrcy-directory-page .inrcy-directory__card-link>.inrcy-directory__card-arrow{position:absolute;right:0;top:10px;display:grid;place-items:center;width:28px;height:28px;border:1px solid #b4c8ef36;border-radius:50%;background:#ffffff06;color:#e9f4ff;font-size:17px}
        body.inrcy-directory-page .inrcy-directory__card-link:hover{color:#b9eaff}
        body.inrcy-directory-page .inrcy-directory__empty{padding:38px;border-radius:22px;background:#f8f9ff;text-align:center}
        body.inrcy-directory-page .inrcy-directory__empty h2{margin:0 0 8px;color:#1c2746;font-size:25px}
        body.inrcy-directory-page .inrcy-directory__empty p{margin:0;color:#69758e}
        body.inrcy-directory-page .inrcy-directory__pagination{display:flex;justify-content:center;align-items:center;gap:7px;margin:32px 0;flex-wrap:wrap}
        body.inrcy-directory-page .inrcy-directory__page{display:inline-grid;min-width:44px;min-height:44px;padding:0 13px;place-items:center;border:1px solid #dce2f1;border-radius:999px;color:#334fe4;font-size:14px;font-weight:850;text-decoration:none;background:#fff;box-shadow:0 7px 18px rgba(31,45,94,.06)}
        body.inrcy-directory-page .inrcy-directory__page:hover,body.inrcy-directory-page .inrcy-directory__page--current{border-color:transparent;background:linear-gradient(100deg,#ff3d9a,#8354ef,#149cf5);color:#fff}
        body.inrcy-directory-page .inrcy-directory__join{display:flex;align-items:center;justify-content:space-between;gap:28px;margin:36px 0 0;padding:26px 28px;border:1px solid rgba(126,98,255,.22);border-radius:24px;background:radial-gradient(circle at 100% 0%,rgba(26,166,255,.15),transparent 42%),linear-gradient(135deg,#f8f9ff,#fff6fb);box-shadow:0 18px 48px rgba(31,48,105,.08)}
        body.inrcy-directory-page .inrcy-directory__join>div{max-width:760px}
        body.inrcy-directory-page .inrcy-directory__join-kicker{color:#7048bd;font-size:11px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}
        body.inrcy-directory-page .inrcy-directory__join h2{margin:6px 0 7px;color:#172242;font-size:clamp(24px,2.4vw,34px);font-weight:850;line-height:1.12;letter-spacing:-.025em}
        body.inrcy-directory-page .inrcy-directory__join p{margin:0;color:#60708f;font-size:15px;line-height:1.6}
        body.inrcy-directory-page .inrcy-directory__join-link{display:inline-flex;min-height:48px;flex:0 0 auto;align-items:center;gap:9px;padding:0 20px;border-radius:999px;background:linear-gradient(100deg,#ff3d9a,#8d43e7,#149cf5);color:#fff;font-size:14px;font-weight:900;text-decoration:none;box-shadow:0 10px 24px rgba(110,75,226,.23);transition:transform .18s ease,box-shadow .18s ease}
        body.inrcy-directory-page .inrcy-directory__join-link:hover{transform:translateY(-2px);color:#fff;box-shadow:0 14px 30px rgba(110,75,226,.31)}
        body.inrcy-directory-page .inrcy-directory__note{margin:24px 0 0;color:#8490a7;font-size:13px;text-align:center}
        body.inrcy-directory-page .inrcy-directory :is(a,button,input,select):focus-visible{outline:3px solid #22b9f3;outline-offset:3px}
        @media (max-width:1050px){body.inrcy-directory-page .inrcy-directory__filters{grid-template-columns:repeat(2,minmax(0,1fr))}body.inrcy-directory-page .inrcy-directory__field--wide,body.inrcy-directory-page .inrcy-directory__submit{grid-column:1/-1}body.inrcy-directory-page .inrcy-directory__grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media (max-width:700px){body.inrcy-directory-page .inrcy-directory{padding:40px 16px 64px}body.inrcy-directory-page .inrcy-directory__hero{margin-bottom:22px}body.inrcy-directory-page .inrcy-directory h1{font-size:clamp(34px,11vw,44px)}body.inrcy-directory-page .inrcy-directory__hero p{font-size:15px;line-height:1.6}body.inrcy-directory-page .inrcy-directory__filters{grid-template-columns:1fr;margin:22px 0 17px;padding:16px;gap:10px}body.inrcy-directory-page .inrcy-directory__field--wide,body.inrcy-directory-page .inrcy-directory__submit{grid-column:auto}body.inrcy-directory-page .inrcy-directory__grid{grid-template-columns:1fr}body.inrcy-directory-page .inrcy-directory__card{padding:20px 22px 12px}body.inrcy-directory-page .inrcy-directory__card h2{font-size:25px}body.inrcy-directory-page .inrcy-directory__qr img{width:132px;height:132px}body.inrcy-directory-page .inrcy-directory__join{align-items:stretch;flex-direction:column;padding:22px}body.inrcy-directory-page .inrcy-directory__join-link{justify-content:center}}
        @media (prefers-reduced-motion:reduce){body.inrcy-directory-page .inrcy-directory *,body.inrcy-directory-page .inrcy-directory *::before,body.inrcy-directory-page .inrcy-directory *::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}
    INRCY_DIRECTORY_CSS;
    wp_add_inline_style('inrcy-directory', $css);
}

add_action('wp_enqueue_scripts', 'inrcy_directory_enqueue_styles');

function inrcy_directory_rank_math_title($title) {
    if (is_page('annuaire')) {
        return 'Annuaire de professionnels près de chez vous | iNrCy';
    }

    return $title;
}

function inrcy_directory_rank_math_description($description) {
    if (is_page('annuaire')) {
        return 'Trouvez un professionnel par métier et par zone géographique grâce à l’annuaire iNrCy et contactez-le depuis son iNr’Badge.';
    }

    return $description;
}

function inrcy_directory_social_image($image) {
    if (!is_page('annuaire')) {
        return $image;
    }

    $custom_logo_id = absint(get_theme_mod('custom_logo'));
    if ($custom_logo_id) {
        $custom_logo = wp_get_attachment_image_url($custom_logo_id, 'full');
        if ($custom_logo) {
            return $custom_logo;
        }
    }

    $site_icon = get_site_icon_url(512);
    return $site_icon ?: $image;
}

add_filter('rank_math/frontend/title', 'inrcy_directory_rank_math_title');
add_filter('rank_math/frontend/description', 'inrcy_directory_rank_math_description');
add_filter('rank_math/opengraph/facebook/image', 'inrcy_directory_social_image');
add_filter('rank_math/opengraph/twitter/image', 'inrcy_directory_social_image');
