import { ACTIVITY_SECTOR_OPTIONS } from '@/lib/activitySectors';
import type { TemplateDef } from '@/lib/messageTemplates';
import { createSectorTemplates, type SectorTemplateDefinition } from './shared';
import { agriculture_producteursTemplates, buildAgricultureProducteursJobTemplates } from './agriculture_producteurs';
import { architecture_designTemplates, buildArchitectureDesignJobTemplates } from './architecture_design';
import { bois_foretTemplates, buildBoisForetJobTemplates } from './bois_foret';
import { energie_habitatTemplates, buildEnergieHabitatJobTemplates } from './energie_habitat';
import { funeraireTemplates, buildFuneraireJobTemplates } from './funeraire';
import { metiers_artTemplates, buildMetiersArtJobTemplates } from './metiers_art';
import { assuranceTemplates, buildAssuranceJobTemplates } from './assurance';
import { artisan_btpTemplates, buildArtisanBtpJobTemplates } from './artisan_btp';
import { automobileTemplates, buildAutomobileJobTemplates } from './automobile';
import { commerce_boutiqueTemplates, buildCommerceBoutiqueJobTemplates } from './commerce_boutique';
import { hotel_restaurantTemplates, buildHotelRestaurantJobTemplates } from './hotel_restaurant';
import { beaute_bien_etreTemplates, buildBeauteBienEtreJobTemplates } from './beaute_bien_etre';
import { santeTemplates, buildSanteJobTemplates } from './sante';
import { securiteTemplates, buildSecuriteJobTemplates } from './securite';
import { medecine_douceTemplates, buildMedecineDouceJobTemplates } from './medecine_douce';
import { immobilierTemplates, buildImmobilierJobTemplates } from './immobilier';
import { services_particuliersTemplates, buildServicesParticuliersJobTemplates } from './services_particuliers';
import { services_entreprisesTemplates, buildServicesEntreprisesJobTemplates } from './services_entreprises';
import { communicationTemplates, buildCommunicationJobTemplates } from './communication';
import { education_enfanceTemplates, buildEducationEnfanceJobTemplates } from './education_enfance';
import { formation_enseignementTemplates, buildFormationEnseignementJobTemplates } from './formation_enseignement';
import { industrieTemplates, buildIndustrieJobTemplates } from './industrie';
import { juridiqueTemplates, buildJuridiqueJobTemplates } from './juridique';
import { loisirs_sportTemplates, buildLoisirsSportJobTemplates } from './loisirs_sport';
import { exterieur_jardinTemplates, buildExterieurJardinJobTemplates } from './exterieur_jardin';
import { financeTemplates, buildFinanceJobTemplates } from './finance';
import { evenementielTemplates, buildEvenementielJobTemplates } from './evenementiel';
import { animalierTemplates, buildAnimalierJobTemplates } from './animalier';
import { transportTemplates, buildTransportJobTemplates } from './transport';
import { tourismeTemplates, buildTourismeJobTemplates } from './tourisme';
import { hygiene_habitatTemplates, buildHygieneHabitatJobTemplates } from './hygiene_habitat';
import { plateformes_numeriquesTemplates, buildPlateformesNumeriquesJobTemplates } from './plateformes_numeriques';
import { autreTemplates, buildAutreJobTemplates } from './autre';

export const SECTOR_TEMPLATE_DEFINITIONS: Record<string, SectorTemplateDefinition> = {
  agriculture_producteurs: agriculture_producteursTemplates,
  architecture_design: architecture_designTemplates,
  bois_foret: bois_foretTemplates,
  energie_habitat: energie_habitatTemplates,
  funeraire: funeraireTemplates,
  metiers_art: metiers_artTemplates,
  assurance: assuranceTemplates,
  artisan_btp: artisan_btpTemplates,
  automobile: automobileTemplates,
  commerce_boutique: commerce_boutiqueTemplates,
  hotel_restaurant: hotel_restaurantTemplates,
  beaute_bien_etre: beaute_bien_etreTemplates,
  sante: santeTemplates,
  securite: securiteTemplates,
  medecine_douce: medecine_douceTemplates,
  immobilier: immobilierTemplates,
  industrie: industrieTemplates,
  services_particuliers: services_particuliersTemplates,
  services_entreprises: services_entreprisesTemplates,
  communication: communicationTemplates,
  education_enfance: education_enfanceTemplates,
  formation_enseignement: formation_enseignementTemplates,
  juridique: juridiqueTemplates,
  loisirs_sport: loisirs_sportTemplates,
  finance: financeTemplates,
  evenementiel: evenementielTemplates,
  exterieur_jardin: exterieur_jardinTemplates,
  animalier: animalierTemplates,
  transport: transportTemplates,
  tourisme: tourismeTemplates,
  hygiene_habitat: hygiene_habitatTemplates,
  plateformes_numeriques: plateformes_numeriquesTemplates,
  autre: autreTemplates,
};

export function buildSectorTemplates(): TemplateDef[] {
  const out: TemplateDef[] = [];
  for (const option of ACTIVITY_SECTOR_OPTIONS) {
    const definition = SECTOR_TEMPLATE_DEFINITIONS[option.value];
    if (definition) out.push(...createSectorTemplates(definition));
    switch (option.value) {
      case 'agriculture_producteurs':
        out.push(...buildAgricultureProducteursJobTemplates());
        break;
      case 'architecture_design':
        out.push(...buildArchitectureDesignJobTemplates());
        break;
      case 'bois_foret':
        out.push(...buildBoisForetJobTemplates());
        break;
      case 'energie_habitat':
        out.push(...buildEnergieHabitatJobTemplates());
        break;
      case 'funeraire':
        out.push(...buildFuneraireJobTemplates());
        break;
      case 'metiers_art':
        out.push(...buildMetiersArtJobTemplates());
        break;
      case 'assurance':
        out.push(...buildAssuranceJobTemplates());
        break;
      case 'artisan_btp':
        out.push(...buildArtisanBtpJobTemplates());
        break;
      case 'automobile':
        out.push(...buildAutomobileJobTemplates());
        break;
      case 'commerce_boutique':
        out.push(...buildCommerceBoutiqueJobTemplates());
        break;
      case 'hotel_restaurant':
        out.push(...buildHotelRestaurantJobTemplates());
        break;
      case 'beaute_bien_etre':
        out.push(...buildBeauteBienEtreJobTemplates());
        break;
      case 'sante':
        out.push(...buildSanteJobTemplates());
        break;
      case 'securite':
        out.push(...buildSecuriteJobTemplates());
        break;
      case 'medecine_douce':
        out.push(...buildMedecineDouceJobTemplates());
        break;
      case 'immobilier':
        out.push(...buildImmobilierJobTemplates());
        break;
      case 'services_particuliers':
        out.push(...buildServicesParticuliersJobTemplates());
        break;
      case 'services_entreprises':
        out.push(...buildServicesEntreprisesJobTemplates());
        break;
      case 'communication':
        out.push(...buildCommunicationJobTemplates());
        break;
      case 'education_enfance':
        out.push(...buildEducationEnfanceJobTemplates());
        break;
      case 'formation_enseignement':
        out.push(...buildFormationEnseignementJobTemplates());
        break;
      case 'industrie':
        out.push(...buildIndustrieJobTemplates());
        break;
      case 'juridique':
        out.push(...buildJuridiqueJobTemplates());
        break;
      case 'loisirs_sport':
        out.push(...buildLoisirsSportJobTemplates());
        break;
      case 'exterieur_jardin':
        out.push(...buildExterieurJardinJobTemplates());
        break;
      case 'finance':
        out.push(...buildFinanceJobTemplates());
        break;
      case 'evenementiel':
        out.push(...buildEvenementielJobTemplates());
        break;
      case 'animalier':
        out.push(...buildAnimalierJobTemplates());
        break;
      case 'transport':
        out.push(...buildTransportJobTemplates());
        break;
      case 'tourisme':
        out.push(...buildTourismeJobTemplates());
        break;
      case 'hygiene_habitat':
        out.push(...buildHygieneHabitatJobTemplates());
        break;
      case 'plateformes_numeriques':
        out.push(...buildPlateformesNumeriquesJobTemplates());
        break;
      case 'autre':
        out.push(...buildAutreJobTemplates());
        break;
      default:
        break;
    }
  }
  return out;
}
