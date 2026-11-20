<?php
if (!defined('ABSPATH')) { exit; }
if (!function_exists('trp_custom_language_switcher') || inrcy_basic_site_preview() || !apply_filters('trp_allow_tp_to_run', true)) { return; }
$available = trp_custom_language_switcher();
$languages = array();
$site_host = wp_parse_url(home_url('/'))['host'] ?? '';
$locale = function_exists('get_locale') ? get_locale() : 'fr_FR';
$converter = class_exists('TRP_Translate_Press') ? TRP_Translate_Press::get_trp_instance()->get_component('url_converter') : null;
foreach ((array) $available as $language => $item) {
    if (!is_array($item) || empty($item['current_page_url']) || empty($item['language_name'])) { continue; }
    $url = wp_parse_url($item['current_page_url']);
    if (!is_array($url) || ($url['scheme'] ?? '') !== 'https' || ($url['host'] ?? '') !== $site_host) { continue; }
    // Translated parent slugs may differ from /basique/. Resolve them using
    // TranslatePress and require the current page to belong to that parent.
    $basic_root = home_url('/basique/');
    if ($converter && is_callable(array($converter, 'get_url_for_language'))) {
        $basic_root = $converter->get_url_for_language($language, $basic_root, '');
    }
    $base_path = trim((string) (wp_parse_url($basic_root)['path'] ?? ''), '/');
    $path = trim((string) ($url['path'] ?? ''), '/');
    $short_code = trim((string) ($item['short_language_name'] ?? ''), '/');
    if ($base_path === '' || $base_path === $short_code || ($path !== $base_path && strpos($path, $base_path . '/') !== 0)) { continue; }
    $languages[$language] = $item;
}
if (count($languages) < 2) { return; }
$selected = $languages[$GLOBALS['TRP_LANGUAGE'] ?? $locale] ?? reset($languages);
?>
<details class="basic-site-language" data-no-translation>
    <summary aria-label="<?php echo esc_attr('Choisir la langue · ' . $selected['language_name']); ?>"><img src="<?php echo esc_url($selected['flag_link']); ?>" alt=""><svg width="12" height="12" viewBox="0 0 20 21" fill="none" aria-hidden="true"><path d="m5 8 5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
    <div><?php foreach ($languages as $item) : ?><a href="<?php echo esc_url($item['current_page_url']); ?>" lang="<?php echo esc_attr(str_replace('_', '-', $item['language_code'])); ?>"><img src="<?php echo esc_url($item['flag_link']); ?>" alt=""><?php echo esc_html($item['language_name']); ?></a><?php endforeach; ?></div>
</details>
