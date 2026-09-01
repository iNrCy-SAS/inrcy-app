import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");
const readJson = <T,>(relativePath: string) => JSON.parse(read(relativePath)) as T;
const locales = readdirSync(join(root, "messages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

type DashboardMessages = {
  userMenu: { activity: string; profile: string };
  drawer: { titles: { activite: string; profil: string } };
  generatorSteps: {
    activity: { shortLabel: string };
    profile: { shortLabel: string };
  };
  setupAlert: {
    bothIncomplete: string;
    profileIncomplete: string;
    activityIncomplete: string;
  };
};

type MediaMessages = {
  ai_generator_subject_profile: string;
  ai_generator_subject_profile_hint: string;
  ai_generator_booster_context: string;
  ai_generator_booster_activity_context: string;
};

const profileSubjectByLocale: Record<string, string> = {
  "de-DE": "Profil",
  "en-GB": "Profile",
  "es-ES": "Perfil",
  "fr-FR": "Profil",
  "it-IT": "Profilo",
  "nl-NL": "Profiel",
  "pt-PT": "Perfil",
  "th-TH": "โปรไฟล์",
  "zh-CN": "个人资料",
};

const legacyActivityLabelByLocale: Record<string, RegExp> = {
  "de-DE": /Meine Aktivitäten|Meine Tätigkeit/i,
  "en-GB": /My Activity|My Business/i,
  "es-ES": /Mi actividad/i,
  "fr-FR": /Mon activité/i,
  "it-IT": /La mia attività/i,
  "nl-NL": /Mijn activiteiten?|Mijn bedrijfsactiviteit/i,
  "pt-PT": /Minha atividade|A minha atividade|Meu Negócio/i,
  "th-TH": /กิจกรรมของฉัน/,
  "zh-CN": /我的活动|我的业务/,
};

test("all dashboard entry points expose one Profile destination", () => {
  assert.deepEqual(locales, Object.keys(profileSubjectByLocale).sort());

  for (const locale of locales) {
    const dashboard = readJson<DashboardMessages>(`messages/${locale}/dashboard.json`);
    assert.equal(dashboard.userMenu.activity, dashboard.userMenu.profile, `${locale}: menu`);
    assert.equal(dashboard.drawer.titles.activite, dashboard.drawer.titles.profil, `${locale}: drawer`);
    assert.equal(
      dashboard.generatorSteps.activity.shortLabel,
      dashboard.generatorSteps.profile.shortLabel,
      `${locale}: generator recommendation`,
    );
    assert.equal(dashboard.setupAlert.profileIncomplete, dashboard.setupAlert.bothIncomplete, `${locale}: alert profile`);
    assert.equal(dashboard.setupAlert.activityIncomplete, dashboard.setupAlert.bothIncomplete, `${locale}: alert business details`);
  }
});

test("media generation consistently uses the unified profile", () => {
  for (const locale of locales) {
    const media = readJson<MediaMessages>(`messages/${locale}/media.json`);
    assert.equal(media.ai_generator_subject_profile, profileSubjectByLocale[locale], `${locale}: media subject`);

    const visibleCopy = [
      media.ai_generator_subject_profile_hint,
      media.ai_generator_booster_context,
      media.ai_generator_booster_activity_context,
    ].join(" ");
    assert.doesNotMatch(visibleCopy, legacyActivityLabelByLocale[locale], `${locale}: legacy media wording`);
  }
});

test("GPS no longer presents Profile and Activity as separate destinations", () => {
  const gpsKeys = [
    "avant_de_publier_ou_d_analyser_d71524fb",
    "avant_de_publier_ou_d_envoyer_622660b3",
    "chaque_donnee_a_un_seul_emplacement_357d476c",
    "chaque_donnee_a_un_seul_emplacement_5b3dbeae",
    "les_horaires_publics_de_mon_activite_33aa1e9a",
    "les_horaires_publics_de_mon_activite_b187c890",
    "mon_activite_6c9c1750",
    "mon_activite_7732bf80",
    "mon_activite_est_precise_et_a_08276404",
    "mon_activite_est_renseignee_et_les_337741fe",
    "ouvrir_mon_activite_2786763e",
    "remplir_mon_activite_metier_prestations_speciali_47667b2a",
    "utiliser_mon_activite_pour_le_metier_9afc1af8",
    "verifier_mon_activite_mon_profil_et_c02fc29a",
    "votre_activite_votre_profil_et_votre_cd0c8c24",
  ];

  for (const locale of locales) {
    const gps = readJson<Record<string, string>>(`messages/${locale}/gps.json`);
    const visibleCopy = gpsKeys.map((key) => String(gps[key] ?? "")).join(" ");
    assert.doesNotMatch(visibleCopy, legacyActivityLabelByLocale[locale], `${locale}: legacy GPS wording`);
  }
});

test("hard-coded AI, quality and notification copy also uses Profile", () => {
  const boosterPrompt = read("app/api/booster/generate/route.ts");
  const mailPrompt = read("lib/templateAiGeneration.ts");
  const searchQuality = read("lib/inrSearchQuality.ts");
  const notifications = read("lib/notifications.ts");

  assert.doesNotMatch(boosterPrompt, /de Mon activité, de Mon profil/);
  assert.doesNotMatch(mailPrompt, /Profil \/ Activité/);
  assert.doesNotMatch(searchQuality, /métier dans Mon activité/);
  assert.doesNotMatch(notifications, /Complétez votre activité|Ouvrir mon activité/);
  assert.match(notifications, /row\.kind === "onboarding_complete_activity"[\s\S]*title: "Complétez votre profil"/);
});
