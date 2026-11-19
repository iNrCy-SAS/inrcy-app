<?php
if (!defined('ABSPATH')) { exit; }

/** Complete source-derived documents reviewed for the dedicated direct signup path.
 * Prepared version: 2026-11-19. Publication remains an explicit WordPress action.
 * General texts dated 2026-10-04: 104 sections, 13 adapted, 91 unchanged.
 * Cancellation article 6 is preserved exactly. No existing contract is replaced.
 */
return array(
    'version' => 'direct-2026-11-19',
    'documents' => array(
        'terms' => array('title' => 'Conditions d’abonnement direct iNrCy', 'reviewed' => true, 'html' => file_get_contents(__DIR__ . '/legal/terms.html')),
        'privacy' => array('title' => 'Politique de confidentialité du parcours d’abonnement direct iNrCy', 'reviewed' => true, 'html' => file_get_contents(__DIR__ . '/legal/privacy.html')),
        'legal' => array('title' => 'Mentions légales du parcours iNrCy Basique', 'reviewed' => true, 'html' => file_get_contents(__DIR__ . '/legal/legal.html')),
    ),
    'consent_html' => 'J’ai lu et j’accepte les <a href="/basique/conditions/" target="_blank" rel="noopener">CGA et Conditions d’utilisation de l’abonnement direct iNrCy</a>, et j’ai pris connaissance de la <a href="/basique/confidentialite/" target="_blank" rel="noopener">Politique de confidentialité</a>. J’accepte d’être contacté(e) par iNrCy dans le cadre de ma demande de création de compte et d’abonnement.',
);
