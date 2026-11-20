<?php
if (!defined('ABSPATH')) { exit; }
$document = inrcy_basic_site_legal_document($view);
$html = $document ? wp_kses_post(inrcy_basic_site_confine_document_links($document['html'])) : '';
$section_labels = array('terms' => 'Document contractuel iNrCy', 'privacy' => 'Protection des données iNrCy', 'legal' => 'Informations légales iNrCy');
$headings = array();
// Approved documents are structured as an introduction followed by numbered
// <article id="…"><h2>…</h2>…</article> sections. Keep their complete body.
$articles = preg_replace_callback('~<article id="([a-z]+-[0-9]+)">\s*<h2>(.*?)</h2>(.*?)</article>~s', function ($match) use (&$headings) {
    $number = sprintf('%02d', count($headings) + 1);
    $headings[] = array('id' => $match[1], 'label' => html_entity_decode(strip_tags($match[2]), ENT_QUOTES, 'UTF-8'), 'number' => $number);
    return '<article class="basic-document-article" id="' . esc_attr($match[1]) . '"><div class="basic-document-article-head"><span class="basic-document-number" aria-hidden="true">' . $number . '</span><h2>' . $match[2] . '</h2></div><div class="basic-document-article-body">' . $match[3] . '</div></article>';
}, $html);
$title = $document['title'] ?? $pages[$view]['heading'];
?>
<section class="basic-document"><div class="basic-document-shell"><div class="basic-document-frame">
    <header class="basic-document-header">
        <div class="basic-document-kicker"><?php echo esc_html($section_labels[$view]); ?></div>
        <h1 class="basic-document-title"><?php echo esc_html($title); ?></h1>
        <?php if ($headings) : ?><div class="basic-document-meta"><span><?php echo esc_html(count($headings)); ?> sections</span></div><?php endif; ?>
    </header>
    <?php if ($document) : ?>
        <?php if ($headings) : ?>
            <div class="basic-document-toolbar" data-document-toolbar hidden>
                <label class="basic-document-search"><input type="search" aria-label="Rechercher dans le document" placeholder="Rechercher dans le document"></label>
                <div class="basic-document-count" role="status"></div>
            </div>
        <?php endif; ?>
        <div class="basic-document-layout">
            <aside class="basic-document-sidebar"><p class="basic-document-sidebar-title">Sommaire</p><nav class="basic-document-toc" aria-label="Sommaire du document">
                <?php foreach ($headings as $heading) : ?><a class="basic-document-toc-link" href="#<?php echo esc_attr($heading['id']); ?>"><span><?php echo esc_html($heading['number']); ?></span><?php echo esc_html($heading['label']); ?></a><?php endforeach; ?>
            </nav></aside>
            <div class="basic-document-content"><?php echo $articles ?? $html; // Sanitized above; wrappers do not change the reviewed text. ?></div>
        </div>
    <?php else : ?>
        <div class="basic-document-content"><p>Ce document sera disponible après sa revue.</p><a href="<?php echo esc_url(inrcy_basic_site_url('contact')); ?>">Contacter iNrCy</a></div>
    <?php endif; ?>
</div></div></section>
