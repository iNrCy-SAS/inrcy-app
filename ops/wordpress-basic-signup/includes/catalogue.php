<?php
if (!defined('ABSPATH')) { exit; }

/** Public catalogue snapshot, checked against the application's real policies. */
function inrcy_basic_site_catalogue() {
    return array(
        'monthly_price_eur' => 29,
        'monthly_media_credits' => 50,
        'contact_email' => 'contact@inrcy.com',
        'contact_phone' => '06 31 26 08 12',
        'contact_phone_uri' => '+33631260812',
        'channels' => array(
            'site_web' => 'Site Web', 'gmb' => 'Google Business Profile', 'inr_search' => 'iNrSearch',
            'facebook' => 'Facebook', 'instagram' => 'Instagram', 'threads' => 'Threads',
            'linkedin' => 'LinkedIn', 'tiktok' => 'TikTok', 'youtube_shorts' => 'YouTube Shorts',
            'pinterest' => 'Pinterest', 'x' => 'X',
        ),
        'features' => array(
            array('name' => 'iNr’Studio', 'label' => 'Créez vos médias', 'icon' => 'studio', 'text' => 'Préparez vos images et vidéos avec l’IA. Le pack comprend 50 crédits médias par mois, dans un même solde de création.', 'detail' => 'Les crédits servent à vos créations médias. La consommation dépend de la création choisie ; des recharges sont disponibles dans l’application.'),
            array('name' => 'Booster', 'label' => 'Publiez depuis un même espace', 'icon' => 'publish', 'text' => 'Préparez vos contenus et publiez-les depuis l’application sur vos canaux connectés.', 'detail' => 'Les 11 canaux de publication sont proposés pour vos comptes connectés compatibles. Vous choisissez ceux que vous souhaitez utiliser pour votre activité.'),
            array('name' => 'iNr’Assistant', 'label' => 'Gardez un guide à vos côtés', 'icon' => 'assistant', 'text' => 'Retrouvez l’accompagnement de l’assistant pour vous orienter dans vos outils.', 'detail' => 'Vous gardez la main sur vos actions. Le pack Basique ne comprend pas d’agents de réalisation.'),
            array('name' => 'iNr’ADN · IA', 'label' => 'Présentez votre entreprise', 'icon' => 'profile', 'text' => 'Rassemblez les informations de votre entreprise pour une IA personnalisée.', 'detail' => 'Votre profil d’entreprise donne du contexte à vos outils et à vos créations.'),
            array('name' => 'iNr’Badge · iNr’Stats', 'label' => 'Suivez votre présence', 'icon' => 'stats', 'text' => 'Retrouvez vos outils de réputation et le suivi de vos résultats.', 'detail' => 'Votre présence et vos résultats restent réunis dans votre application, avec les informations disponibles pour vos canaux.'),
            array('name' => 'iNr’Send', 'label' => 'Retrouvez votre activité', 'icon' => 'history', 'text' => 'Consultez l’historique de l’activité dans l’application.', 'detail' => 'Retrouvez le fil de votre activité pour poursuivre votre travail dans vos outils.'),
        ),
        'faq' => array(
            array('question' => 'Que comprend le pack Basique ?', 'answer' => 'Le pack comprend iNr’Studio avec 50 crédits médias par mois, les outils de publication Booster, l’accompagnement iNr’Assistant, le profil d’entreprise iNr’ADN, les outils de réputation et de suivi, ainsi que l’historique d’activité.'),
            array('question' => 'À quoi correspondent les 50 crédits médias ?', 'answer' => 'Il s’agit du solde mensuel de création dans iNr’Studio, pour les images et les vidéos. Le nombre de créations dépend de leur consommation en crédits. Des recharges sont disponibles dans l’application.'),
            array('question' => 'Quels canaux puis-je utiliser ?', 'answer' => '11 canaux sont proposés : Site Web, Google Business Profile, iNrSearch, Facebook, Instagram, Threads, LinkedIn, TikTok, YouTube Shorts, Pinterest et X. Vous utilisez vos comptes connectés compatibles, selon votre activité.'),
            array('question' => 'Quand mon abonnement est-il activé ?', 'answer' => 'Créez votre compte, retrouvez vos identifiants à l’écran, puis ouvrez l’application. Après l’étape du mot de passe, vous choisissez votre pack et confirmez le paiement sur Stripe. L’accès payant est activé après confirmation du paiement.'),
            array('question' => 'La création du compte déclenche-t-elle un paiement ?', 'answer' => 'Non. La création du compte et l’affichage de vos accès ne créent pas de paiement. Vous confirmez votre choix dans l’application, puis sur la page de paiement Stripe.'),
            array('question' => 'Puis-je choisir un autre pack dans l’application ?', 'answer' => 'Oui. Basique est présélectionné dans le parcours, et l’application vous présente aussi Standard et Premium avant le paiement. Vous pouvez consulter leurs fonctionnalités avant de choisir.'),
            array('question' => 'Le pack Basique réalise-t-il mes actions automatiquement ?', 'answer' => 'Basique réunit les outils manuels et l’accompagnement de l’assistant. Il ne comprend pas les agents de réalisation des autres offres. Vous gardez la main sur vos publications et vos actions.'),
            array('question' => 'Comment retrouver mes accès si je ne reçois pas l’e-mail ?', 'answer' => 'Après une inscription réussie, votre identifiant et votre mot de passe provisoire s’affichent à l’écran. Conservez-les avant de fermer la fenêtre. Le bouton d’accès ouvre l’application dans un nouvel onglet ; vous pouvez aussi utiliser la connexion avec vos identifiants.'),
            array('question' => 'Où consulter les conditions de mon abonnement ?', 'answer' => 'Les conditions d’abonnement, la confidentialité et les mentions légales sont accessibles depuis le pied de page de cet espace Basique. Les informations de paiement et de résiliation sont également présentées dans le parcours de souscription.'),
        ),
    );
}

function inrcy_basic_site_icon($name) {
    $paths = array(
        'studio' => '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m5 17 5-5 4 4 3-3 3 4M16 8h.01"/>',
        'publish' => '<path d="m4 12 16-8-5 16-4-7-7-1ZM11 13l9-9"/>',
        'assistant' => '<path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/><path d="M7 11h.01M11 11h.01M15 11h.01"/>',
        'profile' => '<path d="M7 3h10v18H7zM10 7h4M10 11h4M10 15h4"/>',
        'stats' => '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
        'history' => '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l4 2"/>',
    );
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' . ($paths[$name] ?? $paths['studio']) . '</svg>';
}
