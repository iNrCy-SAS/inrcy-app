export const ACTIVITY_SECTOR_OPTIONS = [
  { value: 'animalier', label: 'Animalier' },
  { value: 'agriculture_producteurs', label: 'Agriculture / Producteurs locaux' },
  { value: 'architecture_design', label: 'Architecture / Design intérieur' },
  { value: 'bois_foret', label: 'Bois & Forêt' },
  { value: 'energie_habitat', label: 'Énergie / Équipements habitat' },
  { value: 'funeraire', label: 'Funéraire' },
  { value: 'metiers_art', label: 'Métiers d’art / Artisanat spécialisé' },
  { value: 'assurance', label: 'Assurance' },
  { value: 'automobile', label: 'Automobile' },
  { value: 'beaute_bien_etre', label: 'Beauté / Bien-être' },
  { value: 'artisan_btp', label: 'BTP' },
  { value: 'commerce_boutique', label: 'Commerce / Boutique' },
  { value: 'communication', label: 'Communication' },
  { value: 'culture_creation', label: 'Arts / Culture / Création' },
  { value: 'education_enfance', label: 'Éducation / Enfance' },
  { value: 'economie_sociale_solidaire', label: 'Économie sociale & solidaire (ESS)' },
  { value: 'formation_enseignement', label: 'Formation & Enseignement' },
  { value: 'evenementiel', label: 'Événementiel' },
  { value: 'exterieur_jardin', label: 'Extérieur / Jardin' },
  { value: 'finance', label: 'Finance' },
  { value: 'hotel_restaurant', label: 'Hôtel / Restaurant' },
  { value: 'hygiene_habitat', label: 'Hygiène / Habitat' },
  { value: 'immobilier', label: 'Immobilier' },
  { value: 'industrie', label: 'Industrie' },
  { value: 'juridique', label: 'Juridique' },
  { value: 'loisirs_sport', label: 'Loisirs / Sport' },
  { value: 'medecine_douce', label: 'Médecine douce' },
  { value: 'sante', label: 'Santé' },
  { value: 'securite', label: 'Sécurité' },
  { value: 'plateformes_numeriques', label: 'Plateformes & services numériques' },
  { value: 'services_entreprises', label: 'Services aux entreprises' },
  { value: 'services_particuliers', label: 'Services aux particuliers' },
  { value: 'transport', label: 'Transport' },
  { value: 'tourisme', label: 'Tourisme' },
  { value: 'autre', label: 'Autre' },
] as const;

export type ActivitySectorCategory = (typeof ACTIVITY_SECTOR_OPTIONS)[number]['value'];

export const DEFAULT_ACTIVITY_SECTOR: ActivitySectorCategory = 'autre';

const VALID_VALUES = new Set<string>(ACTIVITY_SECTOR_OPTIONS.map((o) => o.value));
const LABELS = new Map<string, string>(ACTIVITY_SECTOR_OPTIONS.map((o) => [o.value, o.label]));

const PREFIX_RE = /^\[\[SECTOR:([a-z_]+)\]\]\s*/i;

export function isActivitySectorCategory(value: string): value is ActivitySectorCategory {
  return VALID_VALUES.has(value);
}

export function getActivitySectorLabel(value?: string | null): string {
  if (!value) return LABELS.get(DEFAULT_ACTIVITY_SECTOR) || 'Autre';
  return LABELS.get(value) || LABELS.get(DEFAULT_ACTIVITY_SECTOR) || 'Autre';
}

/** Product professions outrank generic shop/industry words, while explicit schools and care professions keep their own sector. */
function inferBeautyProductSector(value: string): ActivitySectorCategory | null {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const beautyProducts = /\b(?:cosmetiques?|cosmetics?|cosmetologie|skincare|skin care|makeup|make up|maquillage|parfumerie|parfumeur|parfumeuse|savonnerie|savonnier|savonniere|savons? artisanaux|savon artisanal|produits? capillaires?|soins? capillaires?|produits? coiffure|haircare|hair care|beaute naturelle|soins naturels|beauty shop|beauty e shop)\b/.test(normalized) ||
    /\b(?:boutique|magasin|marque|vente|vendeur|vendeuse|conseiller|conseillere|fournisseur|grossiste|e commerce|ecommerce|e shop|vdi)\b.{0,65}\bbeaute\b/.test(normalized) ||
    /\b(?:boutique|vente|marque|fabrication|creation|grossiste)\b.{0,40}\b(?:parfums?|savons?)\b/.test(normalized) ||
    /\b(?:grossiste capillaire|grossiste coiffure|fournisseur coiffure)\b/.test(normalized);
  if (!beautyProducts) return null;
  const primary = normalized.replace(/^(?:je suis|nous sommes|un|une|le|la|les|mon|ma|notre)\s+/, '');
  if (/^(?:cabinet de )?(?:medecins?|dermatologues?|chirurgiens?|pharmaciens?|pharmaciennes?|pharmacie|parapharmacie|clinique|infirmier|infirmiere)\b/.test(primary)) return 'sante';
  if (/^(?:cabinet de )?(?:naturopath|sophrolog|reflexolog|hypnos|magnet|energet|shiatsu|ayurv|reiki)/.test(primary)) return 'medecine_douce';
  if (/^(?:ecole privee|creche|micro creche|soutien scolaire|cours particuliers|aide aux devoirs)\b/.test(primary)) return 'education_enfance';
  if (/^(?:ecole|enseignement|formation|formateur|formatrice|professeur|enseignant|enseignante)\b|^(?:centre|organisme|institut) de (?:formation|enseignement)\b/.test(primary)) return 'formation_enseignement';
  // A client or a target market is not the profession: an architect or a web
  // creator serving a cosmetics brand must keep their existing sector.
  const productProfession = /^(?:boutique|magasin|commerce|negoce|marque|fabricant|fabricante|fabrication|faconnier|sous traitant|industrie|formulateur|formulatrice|formulation|laboratoire|chimiste|grossiste|fournisseur|distributeur|distribution|vente|vendeur|vendeuse|vdi|e commerce|ecommerce|e shop|parfumerie|parfumeur|parfumeuse|savonnerie|savonnier|savonniere|artisan savonnier|savon|savons|cosmetique|cosmetiques|cosmetic|cosmetics|cosmetologie|skincare|skin care|makeup|make up|maquillage|produits?|soins?|beaute naturelle|beauty|haircare|hair care)\b|^(?:createur|creatrice) de marque\b|^(?:ingenieur|ingenieure) (?:en )?formulation\b|^developpement de formules\b|^r d\b|^(?:conseiller|conseillere) (?:en )?beaute\b|^(?:entreprise|producteur|productrice) de (?:produits )?cosmetiques?\b/.test(primary);
  if (!productProfession) return null;
  // Industrial equipment intended for cosmetics is still an industrial trade.
  const productMention = primary.search(/\b(?:cosmetiques?|cosmetics?|skincare|skin care|beaute|parfums?|savons?|capillaires?|coiffure|makeup|make up|haircare|hair care)\b/);
  if (/^(?:fabricant|fabricante|fabrication|industrie)\b/.test(primary) && productMention >= 0 &&
    /\b(?:machines?|materiels?|equipements?|outillages?|moules?|emballages?)\b/.test(primary.slice(0, productMention))) return null;
  return 'beaute_bien_etre';
}

export function inferSectorCategoryFromProfession(input?: string | null): ActivitySectorCategory {
  const value = String(input || '').toLowerCase();
  if (!value) return DEFAULT_ACTIVITY_SECTOR;

  if (/(économie sociale et solidaire|economie sociale et solidaire|économie sociale & solidaire|economie sociale & solidaire|\bess\b|association loi 1901|association d’intérêt général|association d'interet general|organisme d’intérêt général|organisme d'interet general|coopérative|cooperative|\bscop\b|\bscic\b|entreprise sociale|entreprise solidaire|\besus\b|utilité sociale|utilite sociale|fintech mutualiste|holding fintech mutualiste|finance solidaire|finance à impact|finance a impact|financement mutualiste|inclusion financière|inclusion financiere|investissement à impact|investissement a impact|impact investing|infrastructure mutualiste|structure d’insertion|structure d'insertion|\bsiae\b|atelier chantier d’insertion|atelier chantier d'insertion|entreprise d’insertion|entreprise d'insertion|association intermédiaire|association intermediaire|\besat\b|entreprise adaptée|entreprise adaptee|mutuelle|fondation|fonds de dotation|ressourcerie|recyclerie|centre social|tiers[- ]lieu solidaire|\bong\b|solidarité internationale|solidarite internationale)/.test(value) || /^\s*association\s*$/.test(value)) return 'economie_sociale_solidaire';
  const beautyProductSector = inferBeautyProductSector(value);
  if (beautyProductSector) return beautyProductSector;
  if (/(bois de chauffage|bûche|buche|stère|stere|granulé|granule|exploitant forestier|exploitation forestière|exploitation forestiere|travaux forestiers|débardage|debardage|scierie|négoce de bois|negoce de bois|bois sur pied|coupe forestière|coupe forestiere)/.test(value)) return 'bois_foret';
  if (/(architecte d’intérieur|architecte d'interieur|architecte interieur|architecte|décorateur d’intérieur|decorateur d'interieur|decorateur interieur|déco intérieur|deco interieur|maître d’œuvre|maitre d'oeuvre|maitre oeuvre|bureau d’études bâtiment|bureau d'etudes batiment|bureau etudes batiment|design intérieur|design interieur)/.test(value)) return 'architecture_design';
  if (/(agricult|exploitation agricole|exploitant agricole|exploitante agricole|arboricul|fruiticul|verger|producteur de fruits|productrice de fruits|céréalier|cerealier|producteur de céréales|producteur de cereales|producteur local|ferme|vente directe|maraîcher|maraicher|apiculteur|miel|pépiniériste|pepinieriste|viticulteur|domaine viticole|vigneron|produits locaux|panier local)/.test(value)) return 'agriculture_producteurs';
  if (/(panneaux solaires|solaire|photovoltaïque|photovoltaique|pompe à chaleur|pompe a chaleur|\bpac\b|domotique|maison connectée|maison connectee|poêle|poele|cheminée|cheminee|insert|borne de recharge|bornes de recharge|irve|véhicule électrique|vehicule electrique)/.test(value)) return 'energie_habitat';
  if (/(pompes funèbres|pompes funebres|funéraire|funeraire|obsèques|obseques|marbrerie funéraire|marbrerie funeraire|sépulture|sepulture|fleurissement sépulture|fleurissement sepulture|contrat obsèques|contrat obseques)/.test(value)) return 'funeraire';
  if (/(ébéniste|ebeniste|ferronnier d’art|ferronnier d'art|ferronnerie d’art|ferronnerie d'art|céramiste|ceramiste|couturier|couture|retouches|tapissier décorateur|tapissier decorateur|artisanat d’art|artisanat d'art|métiers d’art|metiers d'art)/.test(value)) return 'metiers_art';
  if (/(écrivain|ecrivain|écrivaine|ecrivaine|auteur|auteure|autrice|romancier|romancière|romanciere|artiste|peintre artistique|peinture artistique|plasticien|illustrat|sculpt|musicien|musicienne|interprète musical|interprete musical|chanteur|chanteuse|compositeur|compositrice)/.test(value)) return 'culture_creation';
  if (/(paysag|piscin|jardin|élag|elag|clôture|cloture|portail|arrosage|espace vert|espaces verts|terrassement paysager)/.test(value)) return 'exterieur_jardin';
  if (/(métallurgie|metallurgie|usinage|chaudronnerie|plasturgie|fabrication industrielle|maintenance industrielle|mécanique industrielle|mecanique industrielle|soudure industrielle|traitement de surface|industrie|industriel)/.test(value)) return 'industrie';
  if (/(auto[- ]?école|auto[- ]?ecole|école de conduite|ecole de conduite|moto[- ]?école|moto[- ]?ecole|bateau[- ]?école|bateau[- ]?ecole|permis bateau|permis moto|permis poids lourd|permis remorque|formation poids lourd|formation transport|formation au code|formation code de la route|code de la route|stage de récupération de points|stage de recuperation de points|récupération de points|recuperation de points|sécurité routière|securite routiere|conduite accompagnée|conduite accompagnee|conduite supervisée|conduite supervisee)/.test(value)) return 'formation_enseignement';
  if (/(plomb|chauffag|électric|electric|maçon|macon|couvreur|menuis|carrel|peintre|charpent|construction|clim|serrur|bât|bat|travaux|renov|rénov|terrassement|façade|facade|isolation|plaquiste|placo|cuisiniste|cuisine sur mesure|agenceur|agencement|poseur de sols|poseur sols|parquet|étancheur|etancheur|étanchéité|etancheite)/.test(value)) return 'artisan_btp';
  if (/(assur|mutuelle|prévoyance|prevoyance|courtier en assurance|courtier assurance|agent général d’assurance|agent general d'assurance|agent general assurance|cabinet d’assurance|cabinet d'assurance|sinistre|responsabilité civile pro|responsabilite civile pro|rc pro)/.test(value)) return 'assurance';
  if (/(crèche|creche|micro-crèche|micro creche|soutien scolaire|cours particuliers|aide aux devoirs|école privée|ecole privee|coach scolaire|centre de loisirs|accueil de loisirs|périscolaire|periscolaire|projet pédagogique|projet pedagogique)/.test(value)) return 'education_enfance';
  if (/(salle de sport|club de sport|club sportif|escape game|parc de loisirs|base nautique|activité nautique|activite nautique|activités nautiques|activites nautiques|paddle|kayak|voile|professeur de danse|cours de danse|professeur de yoga|cours de yoga|loisirs|billetterie loisirs)/.test(value)) return 'loisirs_sport';
  if (/(camping|mobil-home|mobil home|location saisonnière|location saisonniere|guide touristique|visite guidée|visite guidee|excursion|office de tourisme|activité touristique|activite touristique|séjour touristique|sejour touristique|tourisme)/.test(value)) return 'tourisme';
  if (/(garage|auto|carross|pneu|moto|contrôle technique|controle technique|vidange|pare-brise|pare brise|location de véhicules|location de vehicules)/.test(value)) return 'automobile';
  if (/(boutique|magasin|fleur|boulang|pâtiss|patiss|épicer|epicer|librair|opticien|bijout|caviste|meuble|commerce|concept store|friperie|vêtement|vetement|habillement|prêt-à-porter|pret-a-porter|torréfact|torrefact|brûlerie|brulerie)/.test(value)) return 'commerce_boutique';
  if (/(restaurant|hôtel|hotel|bar|brasserie|snack|traiteur|café|cafe|bistr|pizzeria|chambre d'hôtes|chambre d'hotes)/.test(value)) return 'hotel_restaurant';
  if (/(esthétique|esthet|coiff|spa|massage|barber|ongler|bien-être|bien etre|institut|maquill|épilation|epilation|coach sportif|nutrition)/.test(value)) return 'beaute_bien_etre';
  if (/(médecin|medecin|dent|kiné|kine|ostéo|osteo|pharm|podolog|orthophon|psycholog|sage-femme|clinique|infirm)/.test(value)) return 'sante';
  if (/(naturopath|sophrolog|réflexolog|reflexolog|hypnos|magnét|magnet|énergét|energet|shiatsu|ayurv|reiki)/.test(value)) return 'medecine_douce';
  if (/(immobili|diagnostiqueur|promoteur|courtier|syndic|gestion locative|transaction|mandat)/.test(value)) return 'immobilier';
  if (/(ménage|menage|garde d'enfants|aide à domicile|aide a domicile|jardinage|dépannage|depannage|conciergerie|aide ménag|livraison)/.test(value)) return 'services_particuliers';
  if (/(créateur de site|createur de site|création de site|creation de site|site internet|site web|webmaster|imprimeur|imprimerie|enseigniste|enseigne lumineuse|signalétique|signaletique|vitrophanie|photographe professionnel|photographe pro|photo entreprise|portrait professionnel)/.test(value)) return 'communication';
  if (/(plateforme|marketplace|place de marché|place de marche|mise en relation|intermédiation numérique|intermediation numerique|annuaire en ligne|comparateur en ligne|réservation en ligne|reservation en ligne|matching en ligne|communauté en ligne|communaute en ligne|réseau professionnel en ligne|reseau professionnel en ligne|logiciel saas|solution saas|\bsaas\b|service en ligne|application web|application mobile|application métier|application metier|portail en ligne)/.test(value)) return 'plateformes_numeriques';
  if (/(consult|agence|marketing|formation|informat|b2b|expert-comptable|comptable|rh|recrutement|secrétariat|secretariat|cabinet de conseil)/.test(value)) return 'services_entreprises';
  if (/(communication|community manager|social media|attaché de presse|attache de presse|branding|studio créa|studio crea|graphiste|seo|sea|marketing digital|content manager)/.test(value)) return 'communication';
  if (/(juridique|avocat|notaire|juriste|huissier|commissaire de justice|cabinet juridique|droit)/.test(value)) return 'juridique';
  if (/(finance|courtage financier|gestion de patrimoine|patrimoine|cgp|conseiller financier|audit financier|daf|expert financier|trésorerie|tresorerie)/.test(value)) return 'finance';
  if (/(dj|disc[- ]?jockey|photograph|vidéaste|videaste|wedding|événement|evenement|salle de réception|salle de reception|location matériel|location materiel|traiteur évènement|traiteur evenement|magicien|magie|illusionniste|prestidigitateur|close[- ]?up)/.test(value)) return 'evenementiel';
  if (/(animal|vétér|veter|toilett|écurie|ecurie|éleveur|élevage|elevage|pension canine|pension féline|pension feline|maréchal|marechal)/.test(value)) return 'animalier';
  if (/(transport|taxi|vtc|chauffeur|ambulance|ambulancier|livraison|coursier|messagerie|fret|marchandises|logistique|demenagement)/.test(value)) return 'transport';
  if (/(sécurité|securite|gardiennage|incendie|télésurveillance|telesurveillance|vidéosurveillance|videosurveillance|contrôle d’accès|controle d'acces|agent de sécurité|agent de securite)/.test(value)) return 'securite';

  return DEFAULT_ACTIVITY_SECTOR;
}

export function decodeBusinessSector(raw?: string | null): { sectorCategory: ActivitySectorCategory; profession: string } {
  const input = String(raw || '').trim();
  if (!input) return { sectorCategory: DEFAULT_ACTIVITY_SECTOR, profession: '' };

  const match = input.match(PREFIX_RE);
  if (match) {
    const maybe = match[1]?.toLowerCase?.() || '';
    const sectorCategory = isActivitySectorCategory(maybe) ? maybe : DEFAULT_ACTIVITY_SECTOR;
    return {
      sectorCategory,
      profession: input.replace(PREFIX_RE, '').trim(),
    };
  }

  return {
    sectorCategory: inferSectorCategoryFromProfession(input),
    profession: input,
  };
}

export function encodeBusinessSector(sectorCategory: string, profession: string): string {
  const category = isActivitySectorCategory(sectorCategory) ? sectorCategory : DEFAULT_ACTIVITY_SECTOR;
  const cleanProfession = String(profession || '').trim();
  return `[[SECTOR:${category}]] ${cleanProfession}`.trim();
}
