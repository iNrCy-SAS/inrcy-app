import type { ActivitySectorCategory } from '@/lib/activitySectors';

type JobCatalog = {
  label: string;
  services: string[];
};

type SectorCatalog = {
  label: string;
  jobs: Record<string, JobCatalog>;
};

export const ACTIVITY_CATALOG: Record<ActivitySectorCategory, SectorCatalog> = {
  animalier: {
    label: 'Animalier',
    jobs: {
      ecurie: { label: 'Écurie / Centre équestre', services: ['Pension cheval', 'Cours', 'Balades', 'Stage', 'Demi-pension', 'Sorties concours', 'Travail du cheval', 'Visite découverte'] },
      educateur_canin: { label: 'Éducateur canin', services: ['Bilan comportemental', 'Éducation chiot', 'Rééducation', 'Cours individuels', 'Cours collectifs', 'Balades éducatives', 'Conseils maîtres', 'Suivi'] },
      eleveur: { label: 'Éleveur', services: ['Présentation élevage', 'Disponibilités', 'Conseils adoption', 'Réservation', 'Suivi portée', 'Visite élevage', 'Informations santé', 'Accompagnement nouveau propriétaire'] },
      pension_animaliere: { label: 'Pension animale', services: ['Garde chien', 'Garde chat', 'Promenade', 'Jeux / socialisation', 'Séjour court', 'Séjour long', 'Visite des installations', 'Réservation'] },
      pet_sitter: { label: 'Pet-sitter', services: ['Visite à domicile', 'Promenade', 'Garde courte durée', 'Garde vacances', 'Soins de base', 'Nouvelles régulières', 'Rencontre préalable', 'Devis personnalisé'] },
      toilettage: { label: 'Salon de toilettage', services: ['Toilettage chien', 'Toilettage chat', 'Bain', 'Tonte', 'Démêlage', 'Coupe griffes', 'Entretien pelage', 'Forfait entretien'] },
      veterinaire: { label: 'Vétérinaire', services: ['Consultation', 'Vaccination', 'Bilan santé', 'Urgence', 'Conseils prévention', 'Chirurgie', 'Suivi animal', 'Informations cabinet'] },
    },
  },
  agriculture_producteurs: {
    label: 'Agriculture / Producteurs locaux',
    jobs: {
      ferme_producteur_local: { label: 'Ferme / producteur local', services: ['Vente directe', 'Produits de saison', 'Panier local', 'Visite ferme', 'Marchés locaux', 'Commande groupée', 'Retrait ferme', 'Offre découverte'] },
      maraicher: { label: 'Maraîcher', services: ['Légumes de saison', 'Paniers légumes', 'Vente à la ferme', 'Marché local', 'Commande semaine', 'Production locale', 'Conseils conservation', 'Offre saisonnière'] },
      apiculteur: { label: 'Apiculteur', services: ['Miel local', 'Produits de la ruche', 'Vente directe', 'Coffret cadeau', 'Marchés locaux', 'Visite découverte', 'Commande entreprise', 'Offre saisonnière'] },
      pepinieriste: { label: 'Pépiniériste', services: ['Plants', 'Arbres / arbustes', 'Conseil plantation', 'Aménagement jardin', 'Commande saisonnière', 'Vente locale', 'Livraison végétaux', 'Devis plantation'] },
      viticulteur_domaine: { label: 'Viticulteur / domaine', services: ['Dégustation', 'Vente directe', 'Visite domaine', 'Commande vin', 'Coffret cadeau', 'Événement domaine', 'Offre entreprise', 'Expédition'] },
    },
  },
  architecture_design: {
    label: 'Architecture / Design intérieur',
    jobs: {
      architecte: { label: 'Architecte', services: ['Conception projet', 'Permis de construire', 'Plans', 'Suivi chantier', 'Extension', 'Rénovation', 'Maison neuve', 'Étude faisabilité'] },
      architecte_interieur: { label: 'Architecte d’intérieur', services: ['Aménagement intérieur', 'Plans 3D', 'Optimisation espaces', 'Rénovation intérieure', 'Choix matériaux', 'Suivi travaux', 'Conseil déco', 'Projet sur mesure'] },
      decorateur_interieur: { label: 'Décorateur d’intérieur', services: ['Conseil déco', 'Planche ambiance', 'Shopping list', 'Home staging', 'Choix couleurs', 'Mobilier', 'Visite conseil', 'Projet pièce par pièce'] },
      maitre_oeuvre: { label: 'Maître d’œuvre', services: ['Coordination travaux', 'Suivi chantier', 'Planning artisans', 'Budget travaux', 'Rénovation', 'Extension', 'Réception chantier', 'Devis projet'] },
      bureau_etudes_batiment: { label: 'Bureau d’études bâtiment', services: ['Étude structure', 'Étude thermique', 'Plans techniques', 'Note de calcul', 'Diagnostic bâtiment', 'Accompagnement chantier', 'Conseil technique', 'Dossier projet'] },
    },
  },
  bois_foret: {
    label: 'Bois & Forêt',
    jobs: {
      bois_chauffage: { label: 'Bois de chauffage', services: ['Stères bois', 'Bûches sèches', 'Livraison bois', 'Bois compressé', 'Granulés', 'Commande hiver', 'Conseil stockage', 'Devis livraison'] },
      exploitant_forestier: { label: 'Exploitant forestier', services: ['Achat bois sur pied', 'Exploitation parcelle', 'Coupe forestière', 'Débardage', 'Gestion forestière', 'Estimation bois', 'Travaux mécanisés', 'Devis exploitation'] },
      travaux_forestiers: { label: 'Travaux forestiers', services: ['Abattage forestier', 'Débroussaillage', 'Débardage', 'Broyage', 'Entretien parcelle', 'Ouverture chemin', 'Nettoyage coupe', 'Devis travaux'] },
      scierie: { label: 'Scierie', services: ['Sciage bois', 'Bois de construction', 'Débit sur mesure', 'Bois d’aménagement', 'Séchage bois', 'Conseil essence', 'Commande professionnelle', 'Devis bois'] },
      negoce_bois: { label: 'Négoce de bois', services: ['Vente bois', 'Bois construction', 'Bois extérieur', 'Panneaux bois', 'Commande pro', 'Livraison', 'Conseil essence', 'Devis négoce'] },
    },
  },
  energie_habitat: {
    label: 'Énergie / Équipements habitat',
    jobs: {
      installateur_panneaux_solaires: { label: 'Installateur panneaux solaires', services: ['Étude solaire', 'Installation panneaux', 'Autoconsommation', 'Batterie', 'Raccordement', 'Suivi production', 'Entretien', 'Devis solaire'] },
      pompe_chaleur: { label: 'Pompe à chaleur', services: ['Installation PAC', 'Remplacement chauffage', 'Entretien PAC', 'Dépannage', 'Étude économies', 'Air/eau', 'Air/air', 'Devis chauffage'] },
      domotique: { label: 'Domotique', services: ['Maison connectée', 'Automatisation', 'Éclairage connecté', 'Volets connectés', 'Sécurité connectée', 'Pilotage chauffage', 'Installation box', 'Devis domotique'] },
      poele_cheminee: { label: 'Poêle / cheminée', services: ['Pose poêle', 'Insert cheminée', 'Conduit fumée', 'Conseil chauffage bois', 'Entretien', 'Remplacement appareil', 'Sécurité installation', 'Devis pose'] },
      bornes_recharge: { label: 'Bornes de recharge', services: ['Installation borne', 'Recharge véhicule électrique', 'Étude puissance', 'Copropriété', 'Entreprise', 'Maintenance borne', 'Aide démarches', 'Devis IRVE'] },
    },
  },
  funeraire: {
    label: 'Funéraire',
    jobs: {
      pompes_funebres: { label: 'Pompes funèbres', services: ['Organisation obsèques', 'Contrat obsèques', 'Transport défunt', 'Cérémonie', 'Démarches administratives', 'Articles funéraires', 'Accompagnement famille', 'Devis obsèques'] },
      marbrerie_funeraire: { label: 'Marbrerie funéraire', services: ['Monument funéraire', 'Gravure', 'Entretien sépulture', 'Rénovation monument', 'Plaque funéraire', 'Pose caveau', 'Devis marbrerie', 'Conseil famille'] },
      fleurissement_sepulture: { label: 'Fleurissement sépulture', services: ['Fleurissement tombe', 'Entretien régulier', 'Composition florale', 'Toussaint', 'Nettoyage sépulture', 'Abonnement entretien', 'Photo suivi', 'Commande à distance'] },
    },
  },
  metiers_art: {
    label: 'Métiers d’art / Artisanat spécialisé',
    jobs: {
      ebeniste: { label: 'Ébéniste', services: ['Meuble sur mesure', 'Restauration meuble', 'Agencement bois', 'Vernis / finition', 'Conseil essence', 'Création unique', 'Réparation bois', 'Devis atelier'] },
      ferronnier_art: { label: 'Ferronnier d’art', services: ['Portail fer forgé', 'Garde-corps', 'Escalier métal', 'Création sur mesure', 'Restauration', 'Mobilier métal', 'Décoration fer', 'Devis ferronnerie'] },
      ceramiste: { label: 'Céramiste', services: ['Pièce artisanale', 'Atelier découverte', 'Commande personnalisée', 'Vaisselle', 'Décoration', 'Cadeau artisanal', 'Petite série', 'Vente atelier'] },
      couturier_retouches: { label: 'Couturier / retouches', services: ['Retouches vêtements', 'Ourlet', 'Ajustement', 'Réparation textile', 'Création sur mesure', 'Robe / costume', 'Conseil essayage', 'Devis couture'] },
      tapissier_decorateur: { label: 'Tapissier décorateur', services: ['Réfection fauteuil', 'Tissus ameublement', 'Rideaux sur mesure', 'Coussins', 'Conseil déco', 'Restauration siège', 'Garnissage', 'Devis tapisserie'] },
    },
  },
  assurance: {
    label: 'Assurance',
    jobs: {
      assureur: { label: 'Assureur', services: ['Assurance auto', 'Assurance habitation', 'Mutuelle santé', 'Prévoyance', 'Assurance emprunteur', 'Assurance professionnelle', 'Responsabilité civile pro', 'Accompagnement sinistre'] },
      agent_general_assurance: { label: 'Agent général d’assurance', services: ['Assurance auto', 'Assurance habitation', 'Mutuelle santé', 'Prévoyance', 'Assurance emprunteur', 'Assurance professionnelle', 'Responsabilité civile pro', 'Accompagnement sinistre'] },
      courtier_assurance: { label: 'Courtier en assurance', services: ['Comparaison de contrats', 'Assurance emprunteur', 'Assurance auto', 'Assurance habitation', 'Mutuelle santé', 'Prévoyance', 'Assurance professionnelle', 'Accompagnement sinistre'] },
      conseiller_assurances: { label: 'Conseiller en assurances', services: ['Bilan assurance', 'Assurance auto', 'Assurance habitation', 'Mutuelle santé', 'Prévoyance', 'Assurance emprunteur', 'Assurance professionnelle', 'Suivi de contrat'] },
      cabinet_assurance: { label: 'Cabinet d’assurance', services: ['Assurance auto', 'Assurance habitation', 'Mutuelle santé', 'Prévoyance', 'Assurance emprunteur', 'Assurance professionnelle', 'Responsabilité civile pro', 'Accompagnement sinistre'] },
    },
  },
  automobile: {
    label: 'Automobile',
    jobs: {
      carrosserie: { label: 'Carrosserie', services: ['Débosselage', 'Peinture carrosserie', 'Réparation choc', 'Pare-chocs', 'Remplacement éléments', 'Lustrage', 'Rénovation optiques', 'Véhicule de courtoisie'] },
      centre_auto: { label: 'Centre auto', services: ['Pneus', 'Parallélisme', 'Batterie', 'Freins', 'Vidange', 'Balais essuie-glace', 'Climatisation', 'Diagnostic rapide'] },
      concession: { label: 'Concession', services: ['Véhicules neufs', 'Véhicules d’occasion', 'Reprise de véhicule', 'Financement', 'LOA / LLD', 'Essai véhicule', 'Entretien & SAV', 'Accessoires & options'] },
      controle_technique: { label: 'Contrôle technique', services: ['Contrôle périodique', 'Contre-visite', 'Contrôle pollution', 'Véhicule utilitaire', 'Véhicule particulier', 'Rendez-vous rapide', 'Rappel échéance', 'Informations contrôle'] },
      depannage_auto: { label: 'Dépannage auto', services: ['Remorquage', 'Batterie', 'Panne démarrage', 'Crevaison', 'Ouverture véhicule', 'Assistance route', 'Diagnostic sur place', 'Intervention urgence'] },
      garage_auto: { label: 'Garage auto', services: ['Révision', 'Vidange', 'Freinage', 'Diagnostic panne', 'Distribution', 'Embrayage', 'Pré-contrôle technique', 'Entretien courant'] },
      garage_moto: { label: 'Garage moto', services: ['Entretien moto', 'Pneus moto', 'Freinage', 'Révision scooter', 'Diagnostic', 'Préparation saison', 'Pièces / accessoires', 'Réparation mécanique'] },
      lavage_auto: { label: 'Lavage auto', services: ['Lavage extérieur', 'Nettoyage intérieur', 'Shampoing sièges', 'Lustrage', 'Préparation vente', 'Traitement carrosserie', 'Nettoyage utilitaire', 'Formule abonnement'] },
      location_vehicules: { label: 'Location de véhicules', services: ['Location courte durée', 'Location utilitaire', 'Location longue durée', 'Réservation véhicule', 'Assurance', 'Options', 'Devis location', 'Disponibilités'] },
      pare_brise: { label: 'Pare-brise', services: ['Remplacement pare-brise', 'Réparation impact', 'Vitrage latéral', 'Lunette arrière', 'Calibration caméra', 'Prise en charge assurance', 'Intervention rapide', 'Diagnostic vitrage'] },
    },
  },

  autre: {
    label: 'Autre',
    jobs: {
      autre_activite: { label: 'Autre activité', services: ['Prestation principale', 'Service complémentaire', 'Conseil', 'Accompagnement', 'Intervention', 'Offre découverte', 'Suivi client', 'Demande de devis'] },
    },
  },

  beaute_bien_etre: {
    label: 'Beauté / Bien-être',
    jobs: {
      coach_sportif: { label: 'Coach sportif', services: ['Coaching individuel', 'Programme personnalisé', 'Remise en forme', 'Renforcement musculaire', 'Perte de poids', 'Préparation physique', 'Suivi à distance', 'Bilan forme'] },
      coiffeur: { label: 'Coiffeur / Barber', services: ['Coupe femme', 'Coupe homme', 'Brushing', 'Coloration', 'Balayage', 'Coiffure événement', 'Soin capillaire', 'Abonnement / fidélité'] },
      estheticienne: { label: 'Institut de beauté', services: ['Soin visage', 'Soin corps', 'Épilation', 'Beauté des mains', 'Beauté des pieds', 'Maquillage', 'Carte cadeau', 'Cure / abonnement'] },
      masseur: { label: 'Massage / Relaxation', services: ['Massage détente', 'Massage sportif', 'Massage duo', 'Drainage', 'Bon cadeau', 'Cure', 'Séance découverte', 'Conseils bien-être'] },
      nutritionniste: { label: 'Nutritionniste', services: ['Bilan nutritionnel', 'Rééquilibrage alimentaire', 'Suivi personnalisé', 'Programme nutrition', 'Objectif forme', 'Conseils repas', 'Accompagnement sportif', 'Rendez-vous suivi'] },
      onglerie: { label: 'Onglerie', services: ['Pose gel', 'Semi-permanent', 'Remplissage', 'Nail art', 'Beauté des mains', 'Beauté des pieds', 'Réparation ongle', 'Carte fidélité'] },
      spa: { label: 'Spa / Bien-être', services: ['Massage', 'Accès spa', 'Rituel duo', 'Sauna / hammam', 'Cure bien-être', 'Bon cadeau', 'Offre détente', 'Privatisation'] },
      tatoueur: { label: 'Tatouage / Piercing', services: ['Projet tatouage', 'Retouche', 'Flash du moment', 'Piercing', 'Conseils cicatrisation', 'Carte cadeau', 'Rendez-vous projet', 'Création personnalisée'] },
    },
  },
  artisan_btp: {
    label: 'BTP',
    jobs: {
      carreleur: { label: 'Carreleur', services: ['Pose carrelage', 'Faïence salle de bain', 'Crédence cuisine', 'Terrasse carrelée', 'Ragréage', 'Réparation joints', 'Pose grand format', 'Rénovation sols'] },
      charpente: { label: 'Charpente', services: ['Charpente traditionnelle', 'Charpente bois', 'Traitement charpente', 'Rénovation charpente', 'Extension bois', 'Diagnostic structure', 'Réparation charpente', 'Devis travaux'] },
      chauffagiste: { label: 'Chauffagiste', services: ['Entretien chaudière', 'Dépannage chauffage', 'Installation chaudière', 'Pompe à chaleur', 'Radiateurs', 'Chauffe-eau', 'Contrat d’entretien', 'Urgence chauffage'] },
      construction: { label: 'Construction', services: ['Construction maison', 'Extension', 'Gros œuvre', 'Coordination travaux', 'Étude projet', 'Devis construction', 'Suivi chantier', 'Réception travaux'] },
      couvreur: { label: 'Couvreur', services: ['Réparation toiture', 'Recherche infiltration', 'Nettoyage toiture', 'Pose couverture', 'Zinguerie', 'Isolation toiture', 'Entretien gouttières', 'Urgence après intempéries'] },
      electricien: { label: 'Électricien', services: ['Dépannage électrique', 'Mise aux normes', 'Installation tableau électrique', 'Éclairage intérieur', 'Éclairage extérieur', 'Prises et interrupteurs', 'Rénovation électrique', 'Bornes / solutions de recharge'] },
      facade: { label: 'Façade', services: ['Ravalement façade', 'Nettoyage façade', 'Enduit extérieur', 'Traitement fissures', 'Peinture façade', 'Isolation extérieure', 'Diagnostic façade', 'Devis ravalement'] },
      macon: { label: 'Maçon', services: ['Maçonnerie générale', 'Dalle béton', 'Mur porteur', 'Ouverture mur', 'Terrasse', 'Fondations', 'Clôture maçonnée', 'Petits travaux de maçonnerie'] },
      menuisier: { label: 'Menuisier', services: ['Menuiserie intérieure', 'Pose de portes', 'Pose de fenêtres', 'Placards sur mesure', 'Escaliers', 'Aménagement intérieur', 'Volets', 'Rénovation menuiserie'] },
      peintre: { label: 'Peintre', services: ['Peinture intérieure', 'Peinture extérieure', 'Préparation supports', 'Rafraîchissement logement', 'Revêtements muraux', 'Protection façade', 'Décoration', 'Peinture après sinistre'] },
      plombier: { label: 'Plombier', services: ['Dépannage fuite', 'Débouchage', 'Remplacement chauffe-eau', 'Installation sanitaire', 'Rénovation salle de bain', 'Recherche de fuite', 'Entretien plomberie', 'Urgence plomberie'] },
      renovation: { label: 'Rénovation', services: ['Rénovation intérieure', 'Rénovation complète', 'Second œuvre', 'Aménagement logement', 'Coordination artisans', 'Modernisation habitat', 'Suivi chantier', 'Devis rénovation'] },
      serrurerie: { label: 'Serrurerie', services: ['Ouverture porte', 'Remplacement serrure', 'Blindage porte', 'Dépannage urgence', 'Sécurisation accès', 'Cylindre haute sécurité', 'Rideau métallique', 'Devis serrurerie'] },
      terrassement: { label: 'Terrassement', services: ['Terrassement terrain', 'Préparation chantier', 'Fondations', 'Tranchées réseaux', 'Nivellement', 'Assainissement extérieur', 'Accès chantier', 'Devis terrassement'] },
      etancheur: { label: 'Étancheur', services: ['Étanchéité toiture terrasse', 'Recherche infiltration', 'Réparation membrane', 'Isolation toiture plate', 'Entretien toiture', 'Diagnostic étanchéité', 'Travaux après pluie', 'Devis étanchéité'] },
      poseur_sols: { label: 'Poseur de sols', services: ['Pose parquet', 'Sol PVC', 'Stratifié', 'Moquette', 'Préparation support', 'Ragréage', 'Rénovation sol', 'Devis sol'] },
      agenceur: { label: 'Agenceur', services: ['Agencement intérieur', 'Mobilier sur mesure', 'Optimisation espace', 'Dressing', 'Bureau / commerce', 'Conception 3D', 'Pose', 'Devis aménagement'] },
      cuisiniste: { label: 'Cuisiniste', services: ['Conception cuisine', 'Pose cuisine', 'Meubles sur mesure', 'Plan de travail', 'Rénovation cuisine', 'Conseil agencement', 'Showroom', 'Devis cuisine'] },
      plaquiste: { label: 'Plaquiste', services: ['Pose placo', 'Cloisons', 'Faux plafonds', 'Isolation intérieure', 'Bandes / joints', 'Aménagement combles', 'Doublage murs', 'Devis placo'] },
    },
  },
  commerce_boutique: {
    label: 'Commerce / Boutique',
    jobs: {
      bijouterie: { label: 'Bijouterie', services: ['Bijoux', 'Montres', 'Réparation bijou', 'Création personnalisée', 'Gravure', 'Conseil cadeau', 'Entretien', 'Commande spéciale'] },
      boulangerie: { label: 'Boulangerie / Pâtisserie', services: ['Pain du jour', 'Pâtisseries', 'Commande spéciale', 'Pièces montées', 'Snacking', 'Traiteur sucré / salé', 'Livraison', 'Formules entreprise'] },
      boutique_mode: { label: 'Boutique mode', services: ['Nouvelle collection', 'Conseil style', 'Essayage', 'Retouches', 'Accessoires', 'Sélection saisonnière', 'Carte cadeau', 'Privatisation boutique'] },
      caviste: { label: 'Caviste', services: ['Conseil vin', 'Sélection bouteilles', 'Coffrets cadeau', 'Dégustation', 'Accords mets vins', 'Commande spéciale', 'Événement cave', 'Livraison locale'] },
      epicerie: { label: 'Épicerie / Commerce alimentaire', services: ['Produits frais', 'Paniers du moment', 'Produits locaux', 'Commande spéciale', 'Livraison', 'Click & collect', 'Coffrets cadeau', 'Événements dégustation'] },
      fleuriste: { label: 'Fleuriste', services: ['Bouquets', 'Compositions florales', 'Mariage', 'Deuil', 'Livraison fleurs', 'Abonnement floral', 'Décoration événement', 'Conseil entretien fleurs'] },
      librairie: { label: 'Librairie / Papeterie', services: ['Sélection livres', 'Commande ouvrage', 'Papeterie', 'Cadeaux', 'Animations / dédicaces', 'Listes scolaires', 'Conseil lecture', 'Réservation'] },
      magasin_meubles: { label: 'Magasin de meubles', services: ['Mobilier salon', 'Mobilier chambre', 'Conseil aménagement', 'Commande meuble', 'Livraison', 'Montage', 'Showroom', 'Projet sur mesure'] },
      opticien: { label: 'Opticien', services: ['Lunettes de vue', 'Lunettes solaires', 'Ajustement monture', 'Lentilles', 'Contrôle visuel', 'Devis mutuelle', 'Entretien lunettes', 'Conseil équipement'] },
    },
  },

  communication: {
    label: 'Communication',
    jobs: {
      agence_communication: { label: 'Agence de communication', services: ['Stratégie de communication', 'Identité visuelle', 'Campagne locale', 'Communication digitale', 'Accompagnement image de marque', 'Supports print', 'Conseil éditorial', 'Plan d’action'] },
      agence_seo: { label: 'Agence SEO / SEA', services: ['Audit SEO', 'Optimisation pages', 'Rédaction SEO', 'Campagnes Google Ads', 'Suivi positionnement', 'Netlinking', 'Reporting', 'Accompagnement visibilité locale'] },
      community_manager: { label: 'Community manager', services: ['Calendrier éditorial', 'Gestion réseaux sociaux', 'Création de contenus', 'Animation de communauté', 'Réponses messages', 'Reporting', 'Stratégie Instagram / Facebook', 'Shooting / reels'] },
      graphiste: { label: 'Graphiste / Studio créatif', services: ['Logo', 'Charte graphique', 'Flyers', 'Brochures', 'Visuels réseaux sociaux', 'Cartes de visite', 'Supports publicitaires', 'Habillage de marque'] },
      redacteur_web: { label: 'Rédacteur web / Copywriter', services: ['Pages site web', 'Articles SEO', 'Emails marketing', 'Fiches service', 'Storytelling', 'Optimisation conversion', 'Réécriture', 'Calendrier éditorial'] },
      photographe_pro: { label: 'Photographe professionnel', services: ['Portrait professionnel', 'Photo entreprise', 'Reportage métier', 'Produits / catalogue', 'Photos réseaux sociaux', 'Shooting équipe', 'Retouche', 'Livraison galerie'] },
      enseigniste: { label: 'Enseigniste', services: ['Enseigne lumineuse', 'Signalétique', 'Vitrophanie', 'Panneaux', 'Marquage véhicule', 'Pose enseigne', 'Habillage façade', 'Devis signalétique'] },
      imprimeur: { label: 'Imprimeur', services: ['Flyers', 'Cartes de visite', 'Brochures', 'Affiches', 'Supports print', 'Impression grand format', 'Finitions', 'Devis impression'] },
      createur_sites_internet: { label: 'Créateur de sites internet', services: ['Site vitrine', 'Refonte site', 'Landing page', 'Référencement local', 'Maintenance site', 'Hébergement', 'Optimisation mobile', 'Accompagnement contenu'] },
    },
  },
  education_enfance: {
    label: 'Éducation / Enfance',
    jobs: {
      creche: { label: 'Crèche', services: ['Accueil enfants', 'Garde régulière', 'Adaptation', 'Activités d’éveil', 'Repas / sieste', 'Communication parents', 'Inscription', 'Visite structure'] },
      soutien_scolaire: { label: 'Soutien scolaire', services: ['Aide aux devoirs', 'Remise à niveau', 'Préparation examens', 'Cours particuliers', 'Méthodologie', 'Français', 'Mathématiques', 'Suivi parents'] },
      ecole_privee: { label: 'École privée', services: ['Inscription', 'Portes ouvertes', 'Projet pédagogique', 'Suivi élèves', 'Activités périscolaires', 'Restauration', 'Vie scolaire', 'Rendez-vous famille'] },
      coach_scolaire: { label: 'Coach scolaire', services: ['Méthodologie', 'Motivation', 'Organisation travail', 'Orientation', 'Préparation examens', 'Gestion stress', 'Suivi personnalisé', 'Rendez-vous bilan'] },
      centre_loisirs: { label: 'Centre de loisirs', services: ['Accueil vacances', 'Mercredis', 'Activités créatives', 'Sorties', 'Sports / jeux', 'Inscription', 'Planning activités', 'Communication parents'] },
    },
  },
  formation_enseignement: {
    label: 'Formation & Enseignement',
    jobs: {
      auto_ecole: {
        label: 'Auto-école',
        services: ['Permis B', 'Conduite accompagnée', 'Conduite supervisée', 'Leçons de conduite', 'Évaluation de départ', 'Boîte manuelle / automatique', 'Passerelle boîte automatique', 'Formation en ligne'],
      },
      moto_ecole: {
        label: 'Moto-école',
        services: ['Permis AM / scooter', 'Permis A1', 'Permis A2', 'Passerelle A2 vers A', 'Formation 125 cm³', 'Cours plateau', 'Cours circulation', 'Équipement / sécurité'],
      },
      bateau_ecole: {
        label: 'Bateau-école',
        services: ['Permis côtier', 'Permis fluvial', 'Extension hauturière', 'Cours théoriques', 'Formation pratique', 'Examen blanc', 'Dossier d’inscription', 'Révision en ligne'],
      },
      formation_poids_lourd_transport: {
        label: 'Formation poids lourd et transport',
        services: ['Permis C', 'Permis CE', 'Permis D', 'FIMO', 'FCO', 'Titre professionnel transport', 'Formation marchandises / voyageurs', 'Accompagnement financement'],
      },
      recuperation_points: {
        label: 'Stage de récupération de points',
        services: ['Stage volontaire', 'Stage obligatoire', 'Récupération jusqu’à 4 points', 'Inscription rapide', 'Dates disponibles', 'Centre agréé', 'Informations permis', 'Attestation de stage'],
      },
      formation_code_route: {
        label: 'Centre de formation au Code de la route',
        services: ['Cours de code en salle', 'Code en ligne', 'Examens blancs', 'Suivi pédagogique', 'Préparation ETG', 'Préparation ETM', 'Inscription examen', 'Remise à niveau'],
      },
    },
  },

  evenementiel: {
    label: 'Événementiel',
    jobs: {
      decorateur_evenementiel: { label: 'Décoration événementielle', services: ['Location décoration', 'Location de mobilier', 'Location de vaisselle', 'Scénographie', 'Projet sur mesure', 'Coordination', 'Installation', 'Personnalisation'] },
      dj: { label: 'DJ / Animation', services: ['Mariage', 'Anniversaire', 'Soirée entreprise', 'Sonorisation', 'Éclairage', 'Playlist sur mesure', 'Pack animation', 'Devis événement'] },
      location_materiel: { label: 'Location de matériel', services: ['Location mobilier', 'Sonorisation', 'Éclairage', 'Vaisselle', 'Structures', 'Livraison', 'Installation', 'Devis sur mesure'] },
      magicien: { label: 'Magicien', services: ['Magie close-up', 'Spectacle de magie', 'Mariage', 'Anniversaire', 'Événement d’entreprise', 'Cocktail / réception', 'Soirée privée', 'Animation sur mesure'] },
      photographe: { label: 'Photographe', services: ['Mariage', 'Portrait', 'Famille', 'Entreprise', 'Événement', 'Shooting extérieur', 'Album / tirages', 'Séance découverte'] },
      salle_reception: { label: 'Salle de réception', services: ['Location salle', 'Mariage', 'Séminaire', 'Anniversaire', 'Capacité accueil', 'Visite salle', 'Options réception', 'Devis événement'] },
      traiteur_evenementiel: { label: 'Traiteur événementiel', services: ['Cocktail', 'Buffet', 'Repas assis', 'Brunch', 'Entreprise', 'Mariage', 'Livraison', 'Devis sur mesure'] },
      videaste: { label: 'Vidéaste', services: ['Film événement', 'Mariage', 'Vidéo entreprise', 'Interview', 'Montage vidéo', 'Clip promotionnel', 'Captation', 'Devis vidéo'] },
      wedding_planner: { label: 'Wedding planner', services: ['Organisation mariage', 'Coordination jour J', 'Sélection prestataires', 'Décoration', 'Planning', 'Accompagnement budget', 'Cérémonie laïque', 'Rendez-vous découverte'] },
    },
  },
  exterieur_jardin: {
    label: 'Extérieur / Jardin',
    jobs: {
      arrosage_automatique: { label: 'Arrosage automatique', services: ['Installation arrosage', 'Programmation', 'Goutte-à-goutte', 'Arrosage pelouse', 'Maintenance réseau', 'Réglage saisonnier', 'Diagnostic fuite', 'Devis installation'] },
      cloture_portail: { label: 'Clôture / Portail', services: ['Pose clôture', 'Pose portail', 'Portail motorisé', 'Brise-vue', 'Sécurisation accès', 'Réparation portail', 'Clôture rigide', 'Devis extérieur'] },
      elagueur: { label: 'Élagueur', services: ['Élagage', 'Abattage', 'Taille raisonnée', 'Dessouchage', 'Évacuation déchets verts', 'Diagnostic arbre', 'Intervention sécurisée', 'Devis élagage'] },
      entretien_jardin: { label: 'Entretien de jardin', services: ['Tonte', 'Taille de haies', 'Désherbage', 'Nettoyage extérieur', 'Entretien saisonnier', 'Ramassage feuilles', 'Remise en état', 'Contrat entretien'] },
      paysagiste: { label: 'Paysagiste', services: ['Création jardin', 'Aménagement paysager', 'Massifs', 'Plantations', 'Allées extérieures', 'Terrasse paysagée', 'Conseil végétal', 'Devis aménagement'] },
      pisciniste: { label: 'Pisciniste', services: ['Construction piscine', 'Rénovation piscine', 'Entretien piscine', 'Mise en service', 'Hivernage', 'Traitement eau', 'Réparation équipement', 'Sécurité piscine'] },
      terrassement_paysager: { label: 'Terrassement paysager', services: ['Préparation terrain', 'Nivellement jardin', 'Création accès', 'Tranchées extérieures', 'Drainage', 'Empierrement', 'Remodelage terrain', 'Devis terrassement'] },
    },
  },
  finance: {
    label: 'Finance',
    jobs: {
      expert_comptable_finance: { label: 'Cabinet comptable / financier', services: ['Comptabilité', 'Bilan', 'Tableau de bord', 'Prévisionnel', 'Déclarations', 'Accompagnement dirigeant', 'Optimisation gestion', 'Rendez-vous conseil'] },
      gestion_patrimoine: { label: 'Conseiller en gestion de patrimoine', services: ['Bilan patrimonial', 'Stratégie d’investissement', 'Préparation retraite', 'Transmission', 'Optimisation fiscale', 'Assurance-vie', 'Rendez-vous conseil', 'Suivi patrimonial'] },
      courtier_credit: { label: 'Courtier en crédit', services: ['Simulation', 'Étude financement', 'Crédit immobilier', 'Renégociation', 'Assurance emprunteur', 'Montage dossier', 'Accompagnement banque', 'Conseil budget'] },
      daf_externalise: { label: 'DAF externalisé / Conseil financier', services: ['Pilotage trésorerie', 'Budget', 'Reporting', 'Prévisionnel', 'Analyse rentabilité', 'Structuration financière', 'Recherche financement', 'Accompagnement dirigeant'] },
    },
  },

  hotel_restaurant: {
    label: 'Hôtel / Restaurant',
    jobs: {
      bar: { label: 'Bar / Café', services: ['Happy hour', 'Soirée à thème', 'Réservation groupe', 'Afterwork', 'Diffusion événement', 'Petite restauration', 'Privatisation', 'Animations'] },
      chambre_hotes: { label: 'Chambre d’hôtes / Gîte', services: ['Réservation séjour', 'Week-end', 'Bon cadeau', 'Accueil famille', 'Séjour thématique', 'Petit-déjeuner', 'Long séjour', 'Conseils visite locale'] },
      hotel: { label: 'Hôtel', services: ['Réservation chambre', 'Séjour week-end', 'Offre entreprise', 'Petit-déjeuner', 'Accueil groupe', 'Événement / séminaire', 'Carte cadeau', 'Offre saisonnière'] },
      restaurant: { label: 'Restaurant', services: ['Menu du jour', 'Réservation', 'Repas de groupe', 'Événement privé', 'Carte saisonnière', 'Vente à emporter', 'Livraison', 'Carte cadeau'] },
      snack: { label: 'Snack / Fast food', services: ['Menu rapide', 'Commande à emporter', 'Livraison', 'Formules midi', 'Offres étudiantes', 'Privatisation', 'Événements', 'Carte fidélité'] },
      traiteur: { label: 'Traiteur', services: ['Cocktail', 'Buffet', 'Mariage', 'Entreprise', 'Livraison', 'Plateaux repas', 'Événement privé', 'Devis sur mesure'] },
    },
  },


  hygiene_habitat: {
    label: 'Hygiène / Habitat',
    jobs: {
      assainissement: { label: 'Assainissement', services: ['Diagnostic assainissement', 'Débouchage canalisation', 'Curage', 'Pompage', 'Entretien fosse', 'Mise aux normes', 'Intervention urgence', 'Devis assainissement'] },
      debarras: { label: 'Débarras', services: ['Débarras maison', 'Débarras cave', 'Débarras grenier', 'Succession', 'Encombrants', 'Nettoyage après débarras', 'Intervention rapide', 'Devis gratuit'] },
      deratiseur: { label: 'Dératiseur', services: ['Dératisation', 'Désinsectisation', 'Traitement nuisibles', 'Intervention urgence', 'Contrat prévention', 'Traitement souris', 'Traitement rats', 'Diagnostic infestation'] },
      desinsectisation: { label: 'Désinsectisation', services: ['Traitement insectes', 'Punaises de lit', 'Guêpes / frelons', 'Cafards', 'Fourmis', 'Diagnostic infestation', 'Intervention urgence', 'Contrat prévention'] },
      nettoyage: { label: 'Nettoyage', services: ['Nettoyage industriel', 'Nettoyage bureaux', 'Nettoyage vitres', 'Remise en état', 'Nettoyage après chantier', 'Désinfection', 'Entretien régulier', 'Intervention ponctuelle'] },
      ramonage: { label: 'Ramonage', services: ['Ramonage cheminée', 'Entretien conduit', 'Poêle à bois', 'Certificat ramonage', 'Intervention annuelle', 'Diagnostic conduit', 'Nettoyage conduit', 'Conseils sécurité'] },
      traitement_humidite: { label: 'Traitement humidité', services: ['Diagnostic humidité', 'Remontées capillaires', 'Traitement murs', 'Ventilation', 'Assèchement', 'Prévention moisissures', 'Contrôle logement', 'Devis traitement'] },
      vitrier: { label: 'Vitrier', services: ['Remplacement vitre', 'Double vitrage', 'Vitrine magasin', 'Dépannage casse', 'Pose vitrage', 'Sécurisation', 'Miroiterie', 'Urgence vitrerie'] },
    },
  },
  immobilier: {
    label: 'Immobilier',
    jobs: {
      agence_immobiliere: { label: 'Agence immobilière', services: ['Estimation', 'Vente', 'Location', 'Visite', 'Mise en valeur du bien', 'Accompagnement acheteur', 'Accompagnement vendeur', 'Conseils marché local'] },
      courtier: { label: 'Courtier', services: ['Étude financement', 'Simulation', 'Renégociation', 'Assurance emprunteur', 'Accompagnement dossier', 'Investissement', 'Premier achat', 'Conseils budget'] },
      diagnostiqueur_immobilier: { label: 'Diagnostiqueur immobilier', services: ['DPE', 'Diagnostic amiante', 'Diagnostic plomb', 'Diagnostic électricité', 'Diagnostic gaz', 'ERP', 'Audit logement', 'Devis diagnostics'] },
      gestion_locative: { label: 'Gestion locative', services: ['Mise en location', 'Gestion quotidienne', 'Sélection locataire', 'États des lieux', 'Suivi propriétaire', 'Conseils rentabilité', 'Garanties', 'Accompagnement juridique'] },
      home_staging: { label: 'Home staging', services: ['Valorisation bien', 'Conseil déco', 'Préparation visite', 'Mise en scène', 'Optimisation photos', 'Pack vente', 'Accompagnement vendeur', 'Visite conseil'] },
      promoteur_immobilier: { label: 'Promoteur immobilier', services: ['Programme immobilier', 'Vente neuf', 'Réservation logement', 'Investissement', 'Suivi projet', 'Informations chantier', 'Accompagnement acquéreur', 'Rendez-vous programme'] },
      syndic: { label: 'Syndic / Copropriété', services: ['Gestion copropriété', 'Suivi travaux', 'Assemblées', 'Communication résidents', 'Interventions techniques', 'Accompagnement conseil syndical', 'Suivi prestataires', 'Information réglementaire'] },
    },
  },
  industrie: {
    label: 'Industrie',
    jobs: {
      chaudronnerie: { label: 'Chaudronnerie', services: ['Fabrication chaudronnée', 'Soudure', 'Assemblage métal', 'Réparation pièces', 'Prototype', 'Plan technique', 'Intervention atelier', 'Devis fabrication'] },
      fabrication_industrielle: { label: 'Fabrication industrielle', services: ['Production série', 'Assemblage', 'Sous-traitance industrielle', 'Contrôle qualité', 'Prototype', 'Planification production', 'Conditionnement', 'Devis industriel'] },
      maintenance_industrielle: { label: 'Maintenance industrielle', services: ['Maintenance préventive', 'Dépannage machine', 'Diagnostic panne', 'Intervention site', 'Contrat maintenance', 'Remise en service', 'Contrôle équipements', 'Rapport intervention'] },
      mecanique_industrielle: { label: 'Mécanique industrielle', services: ['Mécanique de précision', 'Réparation mécanique', 'Assemblage mécanique', 'Contrôle dimensionnel', 'Pièces techniques', 'Maintenance mécanique', 'Montage', 'Devis mécanique'] },
      metallurgie: { label: 'Métallurgie', services: ['Transformation métal', 'Découpe', 'Pliage', 'Assemblage', 'Traitement métal', 'Fabrication sur plan', 'Contrôle qualité', 'Devis métallurgie'] },
      plasturgie: { label: 'Plasturgie', services: ['Fabrication plastique', 'Injection plastique', 'Pièces techniques', 'Prototype', 'Assemblage plastique', 'Contrôle qualité', 'Petite série', 'Devis plasturgie'] },
      soudure_industrielle: { label: 'Soudure industrielle', services: ['Soudure TIG', 'Soudure MIG/MAG', 'Réparation soudure', 'Assemblage métal', 'Intervention sur site', 'Contrôle soudure', 'Fabrication pièce', 'Devis soudure'] },
      traitement_surface: { label: 'Traitement de surface', services: ['Traitement anticorrosion', 'Sablage', 'Peinture industrielle', 'Métallisation', 'Préparation surface', 'Protection pièces', 'Contrôle finition', 'Devis traitement'] },
      usinage: { label: 'Usinage', services: ['Usinage CNC', 'Fraisage', 'Tournage', 'Pièce sur plan', 'Petite série', 'Prototype', 'Contrôle précision', 'Devis usinage'] },
    },
  },
  juridique: {
    label: 'Juridique',
    jobs: {
      avocat: { label: 'Avocat', services: ['Premier rendez-vous', 'Conseil juridique', 'Analyse dossier', 'Rédaction d’actes', 'Négociation', 'Procédure', 'Suivi client', 'Accompagnement contentieux'] },
      huissier: { label: 'Commissaire de justice / Huissier', services: ['Constat', 'Recouvrement', 'Signification', 'Exécution décision', 'Jeux concours', 'Conseil pré-contentieux', 'Rendez-vous étude', 'Suivi dossier'] },
      juriste_entreprise: { label: 'Juriste / Conseil aux entreprises', services: ['Contrats', 'Conformité', 'CGV / mentions légales', 'Protection des données', 'Secrétariat juridique', 'Audit juridique', 'Accompagnement création', 'Support dirigeants'] },
      notaire: { label: 'Notaire', services: ['Rendez-vous étude', 'Achat immobilier', 'Succession', 'Donation', 'Contrat de mariage', 'Création société', 'Conseil patrimonial', 'Signature acte'] },
    },
  },
  loisirs_sport: {
    label: 'Loisirs / Sport',
    jobs: {
      salle_sport: { label: 'Salle de sport', services: ['Abonnement', 'Cours collectifs', 'Coaching', 'Plateau musculation', 'Cardio', 'Bilan forme', 'Offre découverte', 'Planning séances'] },
      club_sport: { label: 'Club de sport', services: ['Inscription club', 'Entraînement', 'Compétitions', 'Stages', 'École jeunes', 'Événements club', 'Planning séances', 'Licence sportive'] },
      escape_game: { label: 'Escape game', services: ['Réservation partie', 'Team building', 'Anniversaire', 'Scénario immersif', 'Groupe amis', 'Entreprise', 'Bon cadeau', 'Privatisation'] },
      parc_loisirs: { label: 'Parc de loisirs', services: ['Billetterie', 'Attractions', 'Anniversaire', 'Groupes', 'Scolaires', 'Restauration', 'Événements', 'Offre famille'] },
      activites_nautiques: { label: 'Activités nautiques', services: ['Location matériel', 'Cours encadrés', 'Sortie mer', 'Paddle', 'Kayak', 'Voile', 'Stage', 'Réservation'] },
      professeur_danse_yoga: { label: 'Professeur de danse / yoga', services: ['Cours individuel', 'Cours collectif', 'Stage', 'Initiation', 'Danse', 'Yoga', 'Bien-être', 'Planning cours'] },
    },
  },

  medecine_douce: {
    label: 'Médecine douce',
    jobs: {
      hypnotherapeute: { label: 'Hypnothérapeute', services: ['Gestion stress', 'Confiance', 'Arrêt tabac', 'Sommeil', 'Phobies', 'Séance découverte', 'Accompagnement personnalisé', 'Suivi'] },
      magnetiseur: { label: 'Magnétiseur', services: ['Séance magnétisme', 'Rééquilibrage énergétique', 'Accompagnement émotionnel', 'Fatigue', 'Stress', 'Séance découverte', 'Suivi personnalisé', 'Conseils bien-être'] },
      naturopathe: { label: 'Naturopathe', services: ['Bilan vitalité', 'Conseils nutrition', 'Gestion stress', 'Sommeil', 'Accompagnement saisonnier', 'Séance découverte', 'Programme bien-être', 'Atelier'] },
      energeticien: { label: 'Praticien énergétique', services: ['Séance énergétique', 'Rééquilibrage', 'Fatigue', 'Émotions', 'Ancrage', 'Découverte', 'Suivi régulier', 'Atelier'] },
      reflexologue: { label: 'Réflexologue', services: ['Réflexologie plantaire', 'Réflexologie palmaire', 'Gestion stress', 'Détente', 'Accompagnement douleur', 'Séance découverte', 'Cure', 'Carte cadeau'] },
      reiki: { label: 'Reiki', services: ['Séance reiki', 'Harmonisation énergétique', 'Détente', 'Gestion stress', 'Accompagnement émotionnel', 'Séance découverte', 'Suivi régulier', 'Atelier initiation'] },
      shiatsu: { label: 'Shiatsu / Pratique corporelle', services: ['Séance shiatsu', 'Détente', 'Équilibre', 'Stress', 'Fatigue', 'Programme bien-être', 'Séance découverte', 'Suivi'] },
      sophrologue: { label: 'Sophrologue', services: ['Gestion stress', 'Sommeil', 'Préparation examen', 'Confiance en soi', 'Burn-out', 'Séance individuelle', 'Atelier', 'Respiration'] },
    },
  },
  sante: {
    label: 'Santé',
    jobs: {
      dentiste: { label: 'Dentiste', services: ['Bilan dentaire', 'Détartrage', 'Urgence dentaire', 'Soins', 'Prothèse', 'Implantologie', 'Orthodontie', 'Conseils hygiène'] },
      infirmier: { label: 'Infirmier / Infirmière', services: ['Soins à domicile', 'Prises de sang', 'Pansements', 'Suivi traitement', 'Accompagnement patient', 'Vaccination', 'Conseils', 'Disponibilités intervention'] },
      kine: { label: 'Kinésithérapeute', services: ['Rééducation', 'Massage', 'Drainage', 'Suivi post-opératoire', 'Sport', 'Douleurs chroniques', 'Respiratoire', 'Exercices à domicile'] },
      medecin_generaliste: { label: 'Médecin généraliste', services: ['Consultation', 'Suivi patient', 'Prévention', 'Téléconsultation', 'Renouvellement', 'Dossier médical', 'Vaccination', 'Informations cabinet'] },
      orthophoniste: { label: 'Orthophoniste', services: ['Bilan orthophonique', 'Troubles langage', 'Rééducation', 'Suivi enfant', 'Suivi adulte', 'Accompagnement famille', 'Rendez-vous suivi', 'Informations cabinet'] },
      osteopathe: { label: 'Ostéopathe', services: ['Consultation adulte', 'Consultation nourrisson', 'Sportif', 'Douleurs dos', 'Suivi postural', 'Conseils prévention', 'Urgence rendez-vous', 'Entretiens réguliers'] },
      pharmacie: { label: 'Pharmacie', services: ['Conseil santé', 'Parapharmacie', 'Vaccination', 'Matériel médical', 'Ordonnances', 'Téléservice', 'Livraison / retrait', 'Prévention saisonnière'] },
      podologue: { label: 'Podologue', services: ['Bilan podologique', 'Soins pédicurie', 'Semelles orthopédiques', 'Suivi sportif', 'Douleurs pied', 'Conseils chaussage', 'Suivi patient', 'Rendez-vous cabinet'] },
      psychologue: { label: 'Psychologue', services: ['Consultation individuelle', 'Accompagnement adulte', 'Accompagnement enfant', 'Gestion stress', 'Burn-out', 'Soutien émotionnel', 'Suivi régulier', 'Rendez-vous découverte'] },
    },
  },


  securite: {
    label: 'Sécurité',
    jobs: {
      agent_securite: { label: 'Agent de sécurité', services: ['Surveillance site', 'Contrôle entrées', 'Ronde sécurité', 'Accueil sécurité', 'Prévention risques', 'Événementiel', 'Gardiennage', 'Devis sécurité'] },
      controle_acces: { label: 'Contrôle d’accès', services: ['Installation contrôle accès', 'Badge / lecteur', 'Interphone', 'Portail sécurisé', 'Maintenance système', 'Audit accès', 'Sécurisation locaux', 'Devis installation'] },
      securite_incendie: { label: 'Sécurité incendie', services: ['Prévention incendie', 'Agent SSIAP', 'Ronde incendie', 'Contrôle équipements', 'Évacuation', 'Consignes sécurité', 'Formation sensibilisation', 'Audit site'] },
      telesurveillance: { label: 'Télésurveillance', services: ['Surveillance à distance', 'Gestion alertes', 'Abonnement télésurveillance', 'Intervention alarme', 'Installation système', 'Maintenance', 'Audit sécurité', 'Devis protection'] },
      videosurveillance: { label: 'Vidéosurveillance', services: ['Installation caméras', 'Caméra extérieure', 'Enregistrement vidéo', 'Maintenance système', 'Audit sécurité', 'Accès à distance', 'Protection locaux', 'Devis vidéosurveillance'] },
    },
  },

  plateformes_numeriques: {
    label: 'Plateformes & services numériques',
    jobs: {
      plateforme_mise_en_relation: { label: 'Plateforme de mise en relation', services: ['Création de profil', 'Recherche ciblée', 'Dépôt d’une demande', 'Mise en relation qualifiée', 'Messagerie sécurisée', 'Demande de devis', 'Prise de rendez-vous', 'Accompagnement utilisateur'] },
      mise_en_relation_particuliers_pros: { label: 'Plateforme particuliers / professionnels', services: ['Recherche de professionnels', 'Dépôt du besoin', 'Mise en relation locale', 'Demande de devis', 'Comparaison des réponses', 'Prise de rendez-vous', 'Profils vérifiés', 'Support utilisateurs'] },
      mise_en_relation_b2b: { label: 'Plateforme de mise en relation B2B', services: ['Recherche de partenaires', 'Publication d’un besoin', 'Qualification des demandes', 'Mise en relation B2B', 'Demande de devis', 'Espace professionnel', 'Suivi des échanges', 'Accompagnement entreprises'] },
      mise_en_relation_particuliers: { label: 'Plateforme entre particuliers', services: ['Création de profil', 'Publication d’une annonce', 'Recherche par critères', 'Mise en relation entre particuliers', 'Messagerie sécurisée', 'Gestion des favoris', 'Signalement / modération', 'Support utilisateurs'] },
      marketplace_services: { label: 'Marketplace de services', services: ['Catalogue de services', 'Recherche de prestataires', 'Dépôt d’une demande', 'Réservation de service', 'Mise en relation', 'Avis et évaluations', 'Espace prestataire', 'Support utilisateurs'] },
      annuaire_comparateur: { label: 'Annuaire / comparateur en ligne', services: ['Référencement professionnel', 'Recherche par activité', 'Recherche géolocalisée', 'Fiche professionnelle', 'Demande de contact', 'Demande de devis', 'Avis et recommandations', 'Offres de visibilité'] },
      plateforme_reservation: { label: 'Plateforme de réservation', services: ['Recherche de disponibilités', 'Réservation en ligne', 'Confirmation automatique', 'Rappels de rendez-vous', 'Gestion des annulations', 'Espace prestataire', 'Planning en ligne', 'Support réservation'] },
      plateforme_emploi_talents: { label: 'Plateforme emploi / talents', services: ['Publication d’offres', 'Création de profil candidat', 'Recherche de talents', 'Matching candidat / recruteur', 'Gestion des candidatures', 'Prise de rendez-vous', 'Alertes emploi', 'Espace recruteur'] },
      communaute_reseau: { label: 'Communauté / réseau professionnel', services: ['Création de profil', 'Annuaire des membres', 'Groupes thématiques', 'Mise en relation professionnelle', 'Messagerie', 'Événements communautaires', 'Partage de ressources', 'Animation de communauté'] },
      logiciel_saas: { label: 'Logiciel / service en ligne (SaaS)', services: ['Création de compte', 'Abonnement en ligne', 'Tableau de bord', 'Automatisation', 'Collaboration en équipe', 'Intégrations', 'Assistance utilisateur', 'Démonstration produit'] },
    },
  },

  services_entreprises: {
    label: 'Services aux entreprises',
    jobs: {
      agence_marketing: { label: 'Agence marketing / communication', services: ['Stratégie', 'Création contenu', 'Community management', 'Publicité', 'SEO', 'Emailing', 'Branding', 'Reporting'] },
      consultant: { label: 'Consultant', services: ['Audit', 'Conseil stratégique', 'Accompagnement projet', 'Atelier', 'Formation', 'Diagnostic', 'Suivi mission', 'Intervention ponctuelle'] },
      expert_comptable: { label: 'Expert-comptable / Gestion', services: ['Comptabilité', 'Paie', 'Conseil gestion', 'Création entreprise', 'Tableau de bord', 'Déclarations', 'Accompagnement dirigeant', 'Rendez-vous bilan'] },
      organisme_formation: { label: 'Formation', services: ['Formation inter', 'Formation intra', 'Atelier', 'Coaching', 'Programme sur mesure', 'E-learning', 'Audit besoins', 'Suivi apprenants'] },
      informatique: { label: 'Informatique / IT', services: ['Dépannage informatique', 'Maintenance', 'Cybersécurité', 'Installation matériel', 'Sauvegarde', 'Cloud', 'Support utilisateur', 'Audit système'] },
      juridique: { label: 'Juridique / Conseil', services: ['Conseil', 'Rédaction', 'Accompagnement dossier', 'Conformité', 'Audit', 'Rendez-vous', 'Formation', 'Suivi client'] },
      recrutement: { label: 'Recrutement', services: ['Recherche candidat', 'Préqualification', 'Entretien', 'Annonce emploi', 'Sourcing', 'Accompagnement RH', 'Audit besoin', 'Suivi recrutement'] },
      secretariat_externalise: { label: 'Secrétariat externalisé', services: ['Gestion appels', 'Gestion agenda', 'Saisie administrative', 'Suivi dossiers', 'Relances clients', 'Devis / factures', 'Assistance administrative', 'Organisation'] },
    },
  },
  services_particuliers: {
    label: 'Services aux particuliers',
    jobs: {
      aide_domicile: { label: 'Aide à domicile', services: ['Accompagnement quotidien', 'Courses', 'Présence', 'Aide administrative', 'Aide repas', 'Soutien autonomie', 'Visites régulières', 'Devis personnalisé'] },
      conciergerie: { label: 'Conciergerie', services: ['Gestion location courte durée', 'Accueil voyageurs', 'Ménage', 'Linge', 'Check-in / check-out', 'Assistance', 'Optimisation annonce', 'Suivi propriétaire'] },
      depannage_domestique: { label: 'Dépannage à domicile', services: ['Petit bricolage', 'Montage meuble', 'Réparation', 'Installation équipement', 'Petites urgences', 'Intervention rapide', 'Devis simple', 'Entretien courant'] },
      garde_enfants: { label: 'Garde d’enfants', services: ['Garde régulière', 'Sortie école', 'Aide devoirs', 'Garde ponctuelle', 'Mercredi / vacances', 'Accompagnement activités', 'Baby-sitting soirée', 'Rencontre préalable'] },
      jardinage: { label: 'Jardinage', services: ['Tonte', 'Taille haies', 'Désherbage', 'Entretien saisonnier', 'Remise en état', 'Petits aménagements', 'Évacuation déchets verts', 'Contrat entretien'] },
      menage: { label: 'Ménage / Entretien', services: ['Ménage régulier', 'Grand nettoyage', 'Fin de chantier', 'Vitres', 'Repassage', 'Nettoyage locatif', 'Intervention ponctuelle', 'Formule abonnement'] },
    },
  },

  tourisme: {
    label: 'Tourisme',
    jobs: {
      camping: { label: 'Camping', services: ['Emplacements', 'Mobil-homes', 'Réservation séjour', 'Activités', 'Piscine / loisirs', 'Services vacanciers', 'Offre famille', 'Disponibilités'] },
      location_saisonniere: { label: 'Location saisonnière', services: ['Location courte durée', 'Week-end', 'Séjour vacances', 'Accueil voyageurs', 'Ménage / linge', 'Disponibilités', 'Réservation', 'Conciergerie'] },
      guide_touristique: { label: 'Guide touristique', services: ['Visite guidée', 'Circuit privé', 'Visite groupe', 'Patrimoine local', 'Balade découverte', 'Excursion', 'Réservation', 'Conseil séjour'] },
      excursions: { label: 'Excursions', services: ['Sortie journée', 'Circuit local', 'Activité groupe', 'Transport', 'Réservation', 'Programme sur mesure', 'Découverte région', 'Offre famille'] },
      activite_touristique: { label: 'Office / activité touristique', services: ['Billetterie', 'Réservation activité', 'Groupes', 'Familles', 'Découverte locale', 'Saison touristique', 'Offre spéciale', 'Informations pratiques'] },
    },
  },

  transport: {
    label: 'Transport',
    jobs: {
      ambulance: { label: 'Ambulancier', services: ['Transport assis', 'Transport médicalisé', 'Aller-retour consultation', 'Hospitalisation', 'Réservation', 'Prise en charge administrative', 'Accompagnement patient', 'Disponibilités'] },
      coursier: { label: 'Coursier / Livraison', services: ['Course urgente', 'Livraison documents', 'Livraison colis', 'Tournées', 'Entreprise', 'Suivi livraison', 'Course dédiée', 'Devis pro'] },
      demenagement: { label: 'Déménagement', services: ['Visite technique', 'Déménagement particulier', 'Déménagement entreprise', 'Emballage', 'Garde-meuble', 'Monte-meubles', 'Transport longue distance', 'Devis sur mesure'] },
      taxi: { label: 'Taxi', services: ['Trajet local', 'Gare', 'Aéroport', 'Transport médical', 'Mise à disposition', 'Réservation', 'Entreprise', 'Course longue distance'] },
      marchandises: { label: 'Transport de marchandises', services: ['Livraison locale', 'Messagerie', 'Transport express', 'Tournées régulières', 'Transport palettes', 'Livraison entreprise', 'Course dédiée', 'Devis logistique'] },
      vtc: { label: 'VTC', services: ['Transfert gare', 'Transfert aéroport', 'Trajet professionnel', 'Mise à disposition', 'Événement', 'Longue distance', 'Réservation', 'Accueil personnalisé'] },
    },
  },};

const FORMATION_ENSEIGNEMENT_JOB_ALIASES: Record<string, string> = {
  'auto ecole': 'auto_ecole',
  'ecole de conduite': 'auto_ecole',
  'auto ecole en ligne': 'auto_ecole',
  'permis b': 'auto_ecole',
  'conduite accompagnee': 'auto_ecole',
  'conduite supervisee': 'auto_ecole',
  'moto ecole': 'moto_ecole',
  'permis moto': 'moto_ecole',
  'formation 125': 'moto_ecole',
  'bateau ecole': 'bateau_ecole',
  'permis bateau': 'bateau_ecole',
  'formation poids lourd': 'formation_poids_lourd_transport',
  'centre de formation poids lourd': 'formation_poids_lourd_transport',
  'permis poids lourd': 'formation_poids_lourd_transport',
  'permis remorque': 'formation_poids_lourd_transport',
  'formation transport': 'formation_poids_lourd_transport',
  'stage de recuperation de points': 'recuperation_points',
  'recuperation de points': 'recuperation_points',
  'centre de recuperation de points': 'recuperation_points',
  'formation au code de la route': 'formation_code_route',
  'centre de formation au code de la route': 'formation_code_route',
  'code de la route': 'formation_code_route',
  'formation code de la route': 'formation_code_route',
};

const EVENEMENTIEL_JOB_ALIASES: Record<string, string> = {
  'magie': 'magicien',
  'magie close up': 'magicien',
  'spectacle de magie': 'magicien',
  'animation magie': 'magicien',
  'illusionniste': 'magicien',
  'prestidigitateur': 'magicien',
  'magicien professionnel': 'magicien',
};

const PLATEFORMES_NUMERIQUES_JOB_ALIASES: Record<string, string> = {
  'plateforme en ligne': 'plateforme_mise_en_relation',
  'mise en relation': 'plateforme_mise_en_relation',
  'site de mise en relation': 'plateforme_mise_en_relation',
  'intermediaire en ligne': 'plateforme_mise_en_relation',
  'intermediation numerique': 'plateforme_mise_en_relation',
  'plateforme de devis': 'mise_en_relation_particuliers_pros',
  'mise en relation particuliers professionnels': 'mise_en_relation_particuliers_pros',
  'plateforme b2b': 'mise_en_relation_b2b',
  'mise en relation entre entreprises': 'mise_en_relation_b2b',
  'plateforme c2c': 'mise_en_relation_particuliers',
  'mise en relation entre particuliers': 'mise_en_relation_particuliers',
  'place de marche de services': 'marketplace_services',
  'comparateur': 'annuaire_comparateur',
  'annuaire professionnel': 'annuaire_comparateur',
  'reservation en ligne': 'plateforme_reservation',
  'plateforme de recrutement': 'plateforme_emploi_talents',
  'reseau professionnel': 'communaute_reseau',
  'saas': 'logiciel_saas',
  'application web': 'logiciel_saas',
};

function normalizeJobLabel(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function getJobsForSector(sector: string) {
  const pack = ACTIVITY_CATALOG[sector as ActivitySectorCategory] ?? ACTIVITY_CATALOG.autre;
  return Object.entries(pack.jobs).map(([value, job]) => ({ value, label: job.label }));
}

export function getServicesForSectorAndJob(sector: string, job: string) {
  const pack = ACTIVITY_CATALOG[sector as ActivitySectorCategory] ?? ACTIVITY_CATALOG.autre;
  const current = pack.jobs[job];
  if (!current) return [] as string[];
  return current.services;
}

export function getJobLabel(sector: string, job: string) {
  const pack = ACTIVITY_CATALOG[sector as ActivitySectorCategory] ?? ACTIVITY_CATALOG.autre;
  return pack.jobs[job]?.label ?? '';
}

export function isValidJobForSector(sector: string, job: string) {
  const pack = ACTIVITY_CATALOG[sector as ActivitySectorCategory] ?? ACTIVITY_CATALOG.autre;
  return Boolean(pack.jobs[job]);
}

export function findJobValueByLabel(sector: string, label: string) {
  const pack = ACTIVITY_CATALOG[sector as ActivitySectorCategory] ?? ACTIVITY_CATALOG.autre;
  const normalized = normalizeJobLabel(label);
  for (const [value, job] of Object.entries(pack.jobs)) {
    if (normalizeJobLabel(job.label) === normalized) return value;
  }
  if (sector === 'formation_enseignement') {
    return FORMATION_ENSEIGNEMENT_JOB_ALIASES[normalized] || '';
  }
  if (sector === 'evenementiel') {
    return EVENEMENTIEL_JOB_ALIASES[normalized] || '';
  }
  if (sector === 'plateformes_numeriques') {
    return PLATEFORMES_NUMERIQUES_JOB_ALIASES[normalized] || '';
  }
  return '';
}
