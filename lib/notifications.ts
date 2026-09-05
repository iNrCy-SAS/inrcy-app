import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { insertNotificationOnce } from "@/lib/notificationWriter";

export type NotificationCategory = "performance" | "action" | "information";

export type NotificationPreferenceRow = {
  user_id: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  performance_enabled: boolean;
  action_enabled: boolean;
  information_enabled: boolean;
  digest_every_hours: number;
  created_at?: string;
  updated_at?: string;
};

export type NotificationRow = {
  id: string;
  user_id: string;
  category: NotificationCategory;
  kind: string;
  title: string;
  body: string;
  cta_label: string | null;
  cta_url: string | null;
  read_at: string | null;
  meta: Record<string, unknown> | null;
  dedupe_key: string | null;
  created_at: string;
};

export function defaultNotificationPreferences(userId: string): NotificationPreferenceRow {
  return {
    user_id: userId,
    in_app_enabled: true,
    email_enabled: true,
    performance_enabled: true,
    action_enabled: true,
    information_enabled: true,
    digest_every_hours: 48,
  };
}

export async function ensureNotificationPreferences(userId: string) {
  const payload = {
    ...defaultNotificationPreferences(userId),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("notification_preferences")
    .upsert(payload, { onConflict: "user_id" })
    .select("user_id, in_app_enabled, email_enabled, performance_enabled, action_enabled, information_enabled, digest_every_hours, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(`notification_preferences_upsert_failed:${error.message}`);
  }

  return data as NotificationPreferenceRow;
}



type WelcomeNotificationSeed = {
  category: NotificationCategory;
  kind: string;
  title: string;
  body: string;
  cta_label: string;
  cta_url: string;
  meta?: Record<string, unknown>;
};

function getWelcomeNotificationSeeds(): WelcomeNotificationSeed[] {
  return [
    {
      category: "action",
      kind: "onboarding_complete_profile",
      title: "Complétez votre profil",
      body: "Ajoutez vos informations clés pour personnaliser iNrCy, fiabiliser vos communications et poser de bonnes bases dès le démarrage.",
      cta_label: "Ouvrir mon profil",
      cta_url: "/dashboard/mon-profil",
      meta: { source: "onboarding", step: "profil" },
    },
    {
      category: "action",
      kind: "onboarding_complete_activity",
      title: "Complétez votre profil",
      body: "Renseignez votre métier, vos services et votre zone d'action pour générer des contenus et recommandations plus utiles.",
      cta_label: "Ouvrir mon profil",
      cta_url: "/dashboard/mon-profil?section=activity",
      meta: { source: "onboarding", step: "activite" },
    },
    {
      category: "action",
      kind: "onboarding_connect_gmb",
      title: "Connectez Google Business",
      body: "Reliez votre fiche Google Business pour renforcer votre visibilité locale et publier plus facilement depuis iNrCy.",
      cta_label: "Connecter Google Business",
      cta_url: "/dashboard?panel=gmb",
      meta: { source: "onboarding", step: "gmb" },
    },
    {
      category: "action",
      kind: "onboarding_connect_facebook",
      title: "Connectez Facebook",
      body: "Ajoutez votre page Facebook pour centraliser vos prises de parole et gagner du temps sur vos publications.",
      cta_label: "Connecter Facebook",
      cta_url: "/dashboard?panel=facebook",
      meta: { source: "onboarding", step: "facebook" },
    },
    {
      category: "action",
      kind: "onboarding_connect_instagram",
      title: "Connectez Instagram",
      body: "Reliez votre compte Instagram pour préparer vos publications dès les premiers jours et activer un canal supplémentaire rapidement.",
      cta_label: "Connecter Instagram",
      cta_url: "/dashboard?panel=instagram",
      meta: { source: "onboarding", step: "instagram" },
    },
    {
      category: "information",
      kind: "onboarding_open_booster",
      title: "Lancez votre premier Booster",
      body: "Booster vous aide à produire rapidement un contenu utile pour vos canaux. Faites un premier essai pour prendre l'application en main.",
      cta_label: "Ouvrir Booster",
      cta_url: "/dashboard?action=publish",
      meta: { source: "onboarding", step: "booster" },
    },
  ];
}

export async function seedWelcomeNotifications(userId: string) {
  const seeds = getWelcomeNotificationSeeds();
  if (!userId || seeds.length === 0) return [];

  // Les identifiants historiques restent inchangés pour ne pas recréer les
  // mêmes notifications chez les comptes déjà existants.
  const dedupeKeys = seeds.map((seed) => `onboarding:${userId}:${seed.kind}`);
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("notifications")
    .select("dedupe_key")
    .eq("user_id", userId)
    .in("dedupe_key", dedupeKeys);

  if (existingError) {
    throw new Error(`notifications_onboarding_select_failed:${existingError.message}`);
  }

  const existingSet = new Set((existing ?? []).map((row) => String(row.dedupe_key || "")).filter(Boolean));
  const rows = seeds
    .filter((seed) => !existingSet.has(`onboarding:${userId}:${seed.kind}`))
    .map((seed) => ({
      user_id: userId,
      category: seed.category,
      kind: seed.kind,
      title: seed.title,
      body: seed.body,
      cta_label: seed.cta_label,
      cta_url: seed.cta_url,
      dedupe_key: `onboarding:${userId}:${seed.kind}`,
      meta: seed.meta ?? { source: "onboarding" },
    }));

  if (rows.length === 0) return [];

  const inserted = await Promise.all(
    rows.map((row) => insertNotificationOnce(row)),
  );
  return inserted
    .filter((result) => result.inserted && result.data)
    .map((result) => result.data as unknown as NotificationRow);
}

export function getCategoryLabel(category: NotificationCategory) {
  if (category === "performance") return "Performance";
  if (category === "action") return "Action";
  return "Information";
}

export function getCategoryAccent(category: NotificationCategory) {
  if (category === "performance") return "rgba(56,189,248,0.18)";
  if (category === "action") return "rgba(244,114,182,0.18)";
  return "rgba(251,146,60,0.16)";
}

export function safeMeta(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function formatRelativeDate(iso: string) {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "À l’instant";
  const delta = Date.now() - ts;
  const minutes = Math.round(delta / 60000);
  if (minutes <= 1) return "À l’instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `Il y a ${days} j`;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(new Date(ts));
}

export function toNotificationPayload(row: NotificationRow) {
  const unifiedProfileCopy = row.kind === "onboarding_complete_activity"
    ? {
        title: "Complétez votre profil",
        cta_label: "Ouvrir mon profil",
        cta_url: "/dashboard/mon-profil?section=activity",
      }
    : null;

  return {
    ...row,
    ...(unifiedProfileCopy ?? {}),
    categoryLabel: getCategoryLabel(row.category),
    relativeDate: formatRelativeDate(row.created_at),
    unread: !row.read_at,
  };
}
