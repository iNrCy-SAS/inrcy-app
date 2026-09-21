"use client";

import { useTranslations } from "next-intl";

import React from "react";
import { getSimpleFrenchApiError, getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { confirmInrcy } from "@/lib/inrcyDialog";
import styles from "./MailsSettingsContent.module.css";

type Props = {
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
};

type ImapPublicSettings = {
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_starttls: boolean;
};

type MailAccount = {
  id: string;
  provider: "gmail" | "microsoft" | "imap";
  email_address: string;
  display_name: string | null;
  status: "connected" | "expired" | "error" | string;
  connection_status?: "connected" | "needs_update" | "disconnected";
  requires_update?: boolean;
  connection_version?: number;
  imap_settings?: ImapPublicSettings | null;
  created_at: string;
};

type MessengerAccount = {
  id: string;
  page_id: string;
  page_name: string | null;
  status: "connected" | "expired" | "error";
  created_at: string;
} | null;

const MAIL_ACCOUNTS_UPDATED_EVENT = "inrsend:mail-accounts-updated";

function dispatchMailAccountsUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MAIL_ACCOUNTS_UPDATED_EVENT));
}

function GlassCard({
  step,
  tone,
  title,
  subtitle,
  children,
}: {
  step: number;
  tone: "cyan" | "violet";
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${styles.stepCard} ${tone === "cyan" ? styles.stepCyan : styles.stepViolet}`}>
      <div className={styles.stepHeader}>
        <span className={styles.stepNumber}>{step}</span>
        <div className={styles.stepCopy}>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>

      <div className={styles.stepBody}>{children}</div>
    </section>
  );
}

function Btn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={styles.pillButton}
      type="button"
      onClick={onClick}
      disabled={!!disabled}
    >
      {label}
    </button>
  );
}

function MailConnectionStatusColor(acc: MailAccount) {
  const status = acc.connection_status || (acc.status === "connected" ? "connected" : "disconnected");
  if (status === "needs_update") return "#fbbf24";
  if (status === "connected") return "#34d399";
  return "rgba(255,255,255,0.72)";
}

function mailAccountRefreshUrl(acc: MailAccount) {
  const params = new URLSearchParams({
    returnTo: "/dashboard?panel=mails",
    loginHint: acc.email_address,
  });
  if (acc.provider === "gmail") return `/api/integrations/google/start?${params.toString()}`;
  if (acc.provider === "microsoft") return `/api/integrations/microsoft/start?${params.toString()}`;
  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Impossible de lire l’image."));
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Impossible de charger l’image."));
    img.src = dataUrl;
  });
}

async function prepareSignatureImage(file: File): Promise<string> {
  const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
  if (!allowed.includes(file.type)) {
    throw new Error("Format d’image non pris en charge. Utilisez PNG, JPG, WEBP, GIF ou SVG.");
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Image trop lourde. Choisissez un fichier inférieur à 5 Mo.");
  }

  const sourceDataUrl = await readFileAsDataUrl(file);
  if (file.type === "image/svg+xml" || file.type === "image/gif") {
    return sourceDataUrl;
  }

  const img = await loadImageFromDataUrl(sourceDataUrl);
  const maxWidth = 600;
  const targetWidth = Math.min(img.width || maxWidth, maxWidth);
  const scale = targetWidth / Math.max(img.width || targetWidth, 1);
  const targetHeight = Math.max(1, Math.round((img.height || targetWidth) * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Impossible de préparer l’image.");
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  const preferredType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const quality = preferredType === "image/jpeg" ? 0.9 : undefined;
  const output = canvas.toDataURL(preferredType, quality);

  if (output.length > 950000) {
    throw new Error("Image encore trop lourde après optimisation. Choisissez une image plus légère.");
  }

  return output;
}

async function dataUrlToFile(dataUrl: string, fallbackName: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : blob.type === "image/gif" ? "gif" : blob.type === "image/svg+xml" ? "svg" : "jpg";
  return new File([blob], `${fallbackName}.${ext}`, { type: blob.type || "image/jpeg" });
}

const SIGNATURE_WIDTH_OPTIONS = [
  { value: 300, label: "Petit (300 px)" },
  { value: 400, label: "Normal (400 px)" },
  { value: 500, label: "Grand (500 px)" },
  { value: 600, label: "Très grand (600 px)" },
];

export default function MailsSettingsContent({ onUnsavedChange }: Props) {
  const i18nT = useTranslations("mails");

  function ProviderLabel(p: MailAccount["provider"]) {
    return p === "gmail" ? i18nT("gmail_eabdf94e") : p === "imap" ? "IMAP" : i18nT("microsoft_11f32421");
  }

  function MailConnectionStatusLabel(acc: MailAccount) {
    const status = acc.connection_status || (acc.status === "connected" ? "connected" : "disconnected");
    if (status === "needs_update") return i18nT("a_actualiser_228d3b1c");
    if (status === "connected") return i18nT("connectee_ef6ef9e9");
    return i18nT("deconnectee_0f5dae32");
  }

  const [loading, setLoading] = React.useState(true);
  const [mailAccounts, setMailAccounts] = React.useState<MailAccount[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [busyDisconnect, setBusyDisconnect] = React.useState<string | null>(null);
  const refreshMailAccounts = React.useCallback(async (notify = false) => {
    const res = await fetch("/api/integrations/status", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(await getSimpleFrenchApiError(res, "Impossible de charger les boîtes mail."));
    setMailAccounts(data.mailAccounts || []);
    if (notify) dispatchMailAccountsUpdated();
    return data.mailAccounts || [];
  }, []);

  const [signatureEnabled, setSignatureEnabled] = React.useState(true);
  const [signatureTemplate, setSignatureTemplate] = React.useState(`{{nom_complet}}
{{nom_entreprise}}
Tél : {{telephone}}
Email : {{email}}`);
  const [signaturePreview, setSignaturePreview] = React.useState("");
  const [signatureImageUrl, setSignatureImageUrl] = React.useState("");
  const [signatureImagePath, setSignatureImagePath] = React.useState("");
  const [signatureBusy, setSignatureBusy] = React.useState(false);
  const [signatureImageWidth, setSignatureImageWidth] = React.useState(400);
  const [signatureToast, setSignatureToast] = React.useState<string | null>(null);
  const signatureFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const savedSignatureSignatureRef = React.useRef("");

  // --- IMAP (slot 4 only) ---
  type ImapPresetKey = "ovh" | "ionos" | "orange" | "sfr" | "other";
  type ImapSettings = {
    imap_host: string;
    imap_port: number;
    imap_secure: boolean;
    smtp_host: string;
    smtp_port: number;
    smtp_secure: boolean;
    smtp_starttls: boolean;
  };
  type ImapSecurityMode = "ssl" | "none";
  type SmtpSecurityMode = "ssl" | "starttls" | "none";
  const IMAP_PRESETS: Record<ImapPresetKey, {
    label: string;
  } & ImapSettings> = {
    ovh: { label: "OVH", imap_host: "ssl0.ovh.net", imap_port: 993, imap_secure: true, smtp_host: "smtp.mail.ovh.net", smtp_port: 465, smtp_secure: true, smtp_starttls: false },
    ionos: { label: "IONOS", imap_host: "imap.ionos.com", imap_port: 993, imap_secure: true, smtp_host: "smtp.ionos.com", smtp_port: 587, smtp_secure: false, smtp_starttls: true },
    orange: { label: i18nT("orange_09fb6aab"), imap_host: "imap.orange.fr", imap_port: 993, imap_secure: true, smtp_host: "smtp.orange.fr", smtp_port: 465, smtp_secure: true, smtp_starttls: false },
    sfr: { label: "SFR", imap_host: "imap.sfr.fr", imap_port: 993, imap_secure: true, smtp_host: "smtp.sfr.fr", smtp_port: 465, smtp_secure: true, smtp_starttls: false },
    other: { label: i18nT("autre_fournisseur_ce6f5c74"), imap_host: "", imap_port: 993, imap_secure: true, smtp_host: "", smtp_port: 587, smtp_secure: false, smtp_starttls: true },
  };

  const [imapModalOpen, setImapModalOpen] = React.useState(false);
  const [imapEditingAccountId, setImapEditingAccountId] = React.useState<string | null>(null);
  const [imapPresetKey, setImapPresetKey] = React.useState<ImapPresetKey>("ovh");
  const [imapLogin, setImapLogin] = React.useState("");
  const [imapPassword, setImapPassword] = React.useState("");
  const [imapCustom, setImapCustom] = React.useState<ImapSettings>({
    imap_host: "",
    imap_port: 993,
    imap_secure: true,
    smtp_host: "",
    smtp_port: 587,
    smtp_secure: false,
    smtp_starttls: true,
  });
  const [imapShowPassword, setImapShowPassword] = React.useState(false);
  const [imapTestBusy, setImapTestBusy] = React.useState(false);
  const [imapConnectBusy, setImapConnectBusy] = React.useState(false);
  const [imapFormError, setImapFormError] = React.useState<string | null>(null);
  const [imapAssistMessage, setImapAssistMessage] = React.useState<string | null>(null);
  const imapModalBaselineSignatureRef = React.useRef("");

  const signatureDraftSignature = JSON.stringify({
    signatureEnabled,
    signatureTemplate,
    signatureImageUrl,
    signatureImagePath,
    signatureImageWidth,
  });
  const imapDraftSignature = JSON.stringify({
    imapEditingAccountId,
    imapPresetKey,
    imapLogin,
    imapPassword,
    imapCustom,
  });

  const requestCloseImapModal = React.useCallback(async () => {
    const hasUnsavedImapChanges = imapModalOpen
      && imapModalBaselineSignatureRef.current !== ""
      && imapModalBaselineSignatureRef.current !== imapDraftSignature;
    if (hasUnsavedImapChanges) {
      const confirmed = await confirmInrcy({
        eyebrow: i18nT("connexion_imap_1ee91f71"),
        title: i18nT("fermer_sans_enregistrer_a3304100"),
        message: i18nT("les_informations_de_connexion_saisies_seront_bc451150"),
        confirmLabel: i18nT("fermer_sans_enregistrer_15fdc373"),
        cancelLabel: i18nT("continuer_la_saisie_c2b2fe38"),
        variant: "warning",
      });
      if (!confirmed) return;
    }
    imapModalBaselineSignatureRef.current = "";
    setImapModalOpen(false);
    setImapEditingAccountId(null);
  }, [imapDraftSignature, imapModalOpen]);

  React.useEffect(() => {
    if (loading) {
      onUnsavedChange?.(false);
      return;
    }

    // Si le chargement de la signature échoue, on considère l’état affiché
    // comme la référence afin de ne pas bloquer la fermeture inutilement.
    if (savedSignatureSignatureRef.current === "") {
      savedSignatureSignatureRef.current = signatureDraftSignature;
    }

    const signatureHasUnsavedChanges = savedSignatureSignatureRef.current !== signatureDraftSignature;
    const imapHasUnsavedChanges = imapModalOpen
      && imapModalBaselineSignatureRef.current !== ""
      && imapModalBaselineSignatureRef.current !== imapDraftSignature;
    onUnsavedChange?.(signatureHasUnsavedChanges || imapHasUnsavedChanges);
  }, [imapDraftSignature, imapModalOpen, loading, onUnsavedChange, signatureDraftSignature]);

  const smtpSecurityModeFromSettings = React.useCallback((settings: ImapSettings): SmtpSecurityMode => {
    if (settings.smtp_secure) return "ssl";
    if (settings.smtp_starttls) return "starttls";
    return "none";
  }, []);

  const applySmtpSecurityMode = React.useCallback((settings: ImapSettings, mode: SmtpSecurityMode): ImapSettings => ({
    ...settings,
    smtp_secure: mode === "ssl",
    smtp_starttls: mode === "starttls",
  }), []);

  const suggestSmtpSecurityForPort = React.useCallback((port: number): { mode: SmtpSecurityMode; message: string | null } | null => {
    if (port === 465) {
      return { mode: "ssl", message: i18nT("configuration_recommandee_appliquee_port_465_ssl_16400633") };
    }
    if (port === 587) {
      return { mode: "starttls", message: i18nT("configuration_recommandee_appliquee_port_587_sta_2ec12239") };
    }
    return null;
  }, []);

  const applyImapPreset = React.useCallback((key: ImapPresetKey) => {
    const preset = IMAP_PRESETS[key];
    setImapCustom({
      imap_host: preset.imap_host,
      imap_port: preset.imap_port,
      imap_secure: preset.imap_secure,
      smtp_host: preset.smtp_host,
      smtp_port: preset.smtp_port,
      smtp_secure: preset.smtp_secure,
      smtp_starttls: preset.smtp_starttls,
    });
    setImapAssistMessage(
      key === "other"
        ? "Autre fournisseur sélectionné : renseignez vos paramètres librement."
        : `Réglages recommandés chargés pour ${IMAP_PRESETS[key].label}. Vous pouvez les modifier.`
    );
  }, []);

  function openImapModal(account: MailAccount | null) {
    const settings: ImapSettings = account?.imap_settings
      ? { ...account.imap_settings }
      : {
          imap_host: IMAP_PRESETS.ovh.imap_host,
          imap_port: IMAP_PRESETS.ovh.imap_port,
          imap_secure: IMAP_PRESETS.ovh.imap_secure,
          smtp_host: IMAP_PRESETS.ovh.smtp_host,
          smtp_port: IMAP_PRESETS.ovh.smtp_port,
          smtp_secure: IMAP_PRESETS.ovh.smtp_secure,
          smtp_starttls: IMAP_PRESETS.ovh.smtp_starttls,
        };
    const matchedPreset = account
      ? (Object.entries(IMAP_PRESETS).find(([key, preset]) => key !== "other"
          && preset.imap_host === settings.imap_host
          && preset.imap_port === settings.imap_port
          && preset.imap_secure === settings.imap_secure
          && preset.smtp_host === settings.smtp_host
          && preset.smtp_port === settings.smtp_port
          && preset.smtp_secure === settings.smtp_secure
          && preset.smtp_starttls === settings.smtp_starttls)?.[0] as ImapPresetKey | undefined)
      : "ovh";
    const nextPresetKey = matchedPreset || "other";
    const nextLogin = account?.email_address || "";
    const nextEditingAccountId = account?.id || null;

    setImapFormError(null);
    setImapAssistMessage(null);
    setImapEditingAccountId(nextEditingAccountId);
    setImapLogin(nextLogin);
    setImapPassword("");
    setImapPresetKey(nextPresetKey);
    setImapCustom(settings);
    setImapShowPassword(false);
    imapModalBaselineSignatureRef.current = JSON.stringify({
      imapEditingAccountId: nextEditingAccountId,
      imapPresetKey: nextPresetKey,
      imapLogin: nextLogin,
      imapPassword: "",
      imapCustom: settings,
    });
    setImapModalOpen(true);
  }

  const imapFieldStyle: React.CSSProperties = {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    padding: "10px 12px",
    color: "rgba(255,255,255,0.92)",
  };

  const imapSelectStyle: React.CSSProperties = {
    ...imapFieldStyle,
    background: "#ffffff",
    color: "#111827",
  };

  const [isMobileImapLayout, setIsMobileImapLayout] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobileImapLayout(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

React.useEffect(() => {
  const url = new URL(window.location.href);
  const t = url.searchParams.get("toast");

  if (t) {
    setToast(t);
    url.searchParams.delete("toast");
    window.history.replaceState({}, "", url.toString());
  }
}, []);

  React.useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        const data = { mailAccounts: await refreshMailAccounts(false) };
        const sigRes = await fetch("/api/inrsend/signature", { cache: "no-store" }).catch(() => null);
        const sigData = sigRes ? await sigRes.json().catch(() => ({})) : {};
        if (!alive) return;

        setMailAccounts(data.mailAccounts || []);
        if (sigRes?.ok) {
          setSignatureEnabled(sigData?.enabled !== false);
          setSignatureTemplate(String(sigData?.template || `{{nom_complet}}
{{nom_entreprise}}
Tél : {{telephone}}
Email : {{email}}`));
          setSignaturePreview(String(sigData?.preview || ""));
          setSignatureImagePath(String(sigData?.imagePath || ""));
          setSignatureImageUrl(String(sigData?.imageUrl || ""));
          setSignatureImageWidth(Number(sigData?.imageWidth || 400) || 400);
        }
        setError(null);
      } catch (e: any) {
        if (!alive) return;
        setError(getSimpleFrenchErrorMessage(e, "Impossible de charger les réglages mail."));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const slots = [0, 1, 2, 3];
  const oauthAccounts = mailAccounts.filter((a) => a.provider !== "imap");
  const imapAccount = mailAccounts.find((a) => a.provider === "imap") || null;
  const maxReached = oauthAccounts.length >= 3; // slots 1-3

  return (
    <div className={styles.settings}>
      <GlassCard
        step={1}
        tone="cyan"
        title="Boîtes d’envoi"
        subtitle="Connectez jusqu’à trois comptes Gmail ou Microsoft et une boîte IMAP."
      >
        <div className={styles.stepStack}>
          {loading || error ? (
            <div className={`${styles.notice} ${error ? styles.noticeWarning : ""}`} role="status">
              {loading ? i18nT("chargement_01cba1df") : error}
            </div>
          ) : null}

          {toast === "already_connected" && (
            <div className={`${styles.notice} ${styles.noticeWarning}`} role="status">
              {i18nT("cette_boite_mail_est_deja_connectee_a0c7c8ce")}
            </div>
          )}
          {toast === "connected" && (
            <div className={styles.notice} role="status">
              {i18nT("boite_mail_connectee_vous_pouvez_maintenant_6d472d63")}
            </div>
          )}
          {toast === "gmail_disconnected" && (
            <div className={styles.notice} role="status">
              {i18nT("boite_gmail_deconnectee_3d83ef35")}
            </div>
          )}
          {toast === "outlook_disconnected" && (
            <div className={styles.notice} role="status">
              {i18nT("boite_outlook_deconnectee_0544620c")}
            </div>
          )}
          {toast === "imap_disconnected" && (
            <div className={styles.notice} role="status">
              {i18nT("boite_imap_deconnectee_392ad047")}
            </div>
          )}
          {toast === "imap_test_ok" && (
            <div className={styles.notice} role="status">
              {i18nT("test_de_connexion_reussi_vous_pouvez_b896dce1")}
            </div>
          )}
          {toast === "imap_connected" && (
            <div className={styles.notice} role="status">
              {i18nT("boite_imap_connectee_vous_pouvez_maintenant_4d98651e")}
            </div>
          )}
          {toast === "imap_updated" && (
            <div className={styles.notice} role="status">
              {i18nT("imap_settings_saved")}
            </div>
          )}

          <div className={styles.accountList}>
        {slots.map((i) => {
          const isImapSlot = i === 3;
          const acc = isImapSlot ? imapAccount : oauthAccounts[i];

          return (
            <div className={`${styles.accountRow} ${acc ? styles.accountRowConnected : ""}`} key={i}>
              <div className={styles.accountIdentity}>
                <span className={styles.slotNumber}>{i + 1}</span>
                <div className={styles.accountCopy}>
                  <strong>{acc ? acc.email_address : i18nT("boite_mail_value_d30aaf7d", { value0: i + 1 })}</strong>
                  <span>{acc ? ProviderLabel(acc.provider) : isImapSlot ? "IMAP · OVH, IONOS, Orange, SFR…" : "Gmail ou Microsoft"}</span>
                </div>
              </div>

              {acc ? (
                <span
                  className={styles.statusPill}
                  style={{ color: MailConnectionStatusColor(acc) }}
                  aria-label={i18nT("statut_value_b14864f1", { value0: MailConnectionStatusLabel(acc) })}
                >
                  <span className={styles.statusDot} style={{ background: MailConnectionStatusColor(acc) }} />
                  {MailConnectionStatusLabel(acc)}
                </span>
              ) : null}

              <div className={styles.accountActions}>
              {!acc ? (
                <>
                  {!isImapSlot && (
                    <Btn
                      label={i18nT("connecter_gmail_45c39b69")}
                      disabled={loading || maxReached}
                   onClick={() => {
  window.location.href = "/api/integrations/google/start";
}}
                    />
                  )}
                  {!isImapSlot && (
                    <Btn
                      label={i18nT("connecter_microsoft_5ad49548")}
                      disabled={loading || maxReached}
                      onClick={() => {
                        window.location.href = "/api/integrations/microsoft/start";
                      }}
                    />
                  )}

                  {isImapSlot && (
                    <Btn
                      label={i18nT("connecter_imap_ovh_ionos_orange_sfr_9346ccf0")}
                      disabled={loading}
                      onClick={() => openImapModal(null)}
                    />
                  )}
                </>
              ) : (
                <>
                  {acc.provider === "imap" ? (
                    <Btn
                      label={i18nT("imap_settings_button")}
                      disabled={loading}
                      onClick={() => openImapModal(acc)}
                    />
                  ) : null}
                  {acc.provider !== "imap" && acc.connection_status === "needs_update" && mailAccountRefreshUrl(acc) ? (
                    <Btn
                      label={i18nT("reconnect_mailbox")}
                      disabled={loading}
                      onClick={() => {
                        const url = mailAccountRefreshUrl(acc);
                        if (url) window.location.href = url;
                      }}
                    />
                  ) : null}
                  <Btn
  label={busyDisconnect === acc.id ? "Déconnexion…" : "Déconnecter"}
  disabled={loading || busyDisconnect === acc.id}
  onClick={async () => {
    try {
      setBusyDisconnect(acc.id);
      const endpoint = acc.provider === "gmail"
        ? "/api/integrations/google/disconnect"
        : acc.provider === "microsoft"
          ? "/api/integrations/microsoft/disconnect"
          : "/api/integrations/imap/disconnect";

      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: acc.id }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(await getSimpleFrenchApiError(r, "Impossible de déconnecter cette boîte mail."));
      }
      setToast(acc.provider === "gmail" ? "gmail_disconnected" : acc.provider === "microsoft" ? "outlook_disconnected" : "imap_disconnected");
      await refreshMailAccounts(true);
    } catch (e: any) {
      setToast(getSimpleFrenchErrorMessage(e, "Impossible de déconnecter cette boîte mail."));
    } finally {
      setBusyDisconnect(null);
    }
  }}
/>
                </>
              )}
              </div>
            </div>
          );
        })}
          </div>
        </div>
      </GlassCard>

      <GlassCard
        step={2}
        tone="violet"
        title={i18nT("signature_automatique_77745712")}
        subtitle="Personnalisez le texte et l’image ajoutés à la fin de vos mails iNr’Send."
      >
        <div className={styles.signatureShell}>
          <label className={`${styles.toggleCard} ${signatureEnabled ? styles.toggleCardSelected : ""}`}>
            <input
              className={styles.visuallyHidden}
              type="checkbox"
              checked={signatureEnabled}
              onChange={(e) => setSignatureEnabled(e.target.checked)}
            />
            <span className={styles.checkIndicator} aria-hidden="true" />
            <span className={styles.toggleCopy}>
              <strong>{i18nT("activer_la_signature_automatique_d826254a")}</strong>
              <small>Ajoutée automatiquement à chaque message envoyé.</small>
            </span>
          </label>

          {signatureToast ? (
            <div className={`${styles.notice} ${signatureToast.startsWith("✅") ? "" : styles.noticeWarning}`} role="status">
              {signatureToast}
            </div>
          ) : null}

          <div className={styles.signatureGrid}>
            <div className={styles.editorPanel}>
              <label className={styles.fieldLabel} htmlFor="mails-signature-template">Texte de la signature</label>
              <textarea
                id="mails-signature-template"
                className={styles.signatureTextarea}
                value={signatureTemplate}
                onChange={(e) => setSignatureTemplate(e.target.value)}
                rows={4}
              />
              <p className={styles.variablesHelp}>
                Variables : {"{{nom_complet}}"}, {"{{nom_entreprise}}"}, {"{{telephone}}"}, {"{{email}}"}, {"{{ville}}"}…
              </p>

              <div className={styles.mediaTools}>
              <label
                className={`${styles.pillButton} ${styles.fileButton}`}
                aria-disabled={signatureBusy}
              >
                {i18nT("importer_une_image_fcd9d38d")}{" "}<input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  disabled={signatureBusy}
                  className={styles.visuallyHidden}
                  ref={signatureFileInputRef}
                  onChange={async (e) => {
                    const input = e.currentTarget;
                    const file = input.files?.[0];
                    if (!file) return;
                    try {
                      setSignatureBusy(true);
                      setSignatureToast(null);
                      const prepared = await prepareSignatureImage(file);
                      const preparedFile = await dataUrlToFile(prepared, file.name.replace(/\.[^.]+$/, "") || "signature");
                      const formData = new FormData();
                      formData.append("file", preparedFile);
                      const res = await fetch("/api/inrsend/signature-image", { method: "POST", body: formData });
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(await getSimpleFrenchApiError(res, "Impossible d’importer cette image."));
                      setSignatureImagePath(String(data?.imagePath || ""));
                      setSignatureImageUrl(String(data?.imageUrl || ""));
                      setSignatureToast(i18nT("image_inseree_pensez_a_sauvegarder_la_77ab6eef"));
                    } catch (err: any) {
                      setSignatureToast(`⚠️ ${getSimpleFrenchErrorMessage(err, "Impossible d’importer cette image.")}`);
                    } finally {
                      if (input) input.value = "";
                      setSignatureBusy(false);
                    }
                  }}
                />
              </label>
              {signatureImageUrl ? (
                <button
                  className={styles.pillButton}
                  type="button"
                  onClick={async () => {
                    try {
                      setSignatureBusy(true);
                      if (signatureImagePath) {
                        const res = await fetch("/api/inrsend/signature-image", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ imagePath: signatureImagePath }),
                        });
                        if (!res.ok) throw new Error(await getSimpleFrenchApiError(res, "Impossible de retirer cette image."));
                      }
                      setSignatureImagePath("");
                      setSignatureImageUrl("");
                      setSignatureToast(i18nT("image_retiree_99769015"));
                    } catch (err: any) {
                      setSignatureToast(`⚠️ ${getSimpleFrenchErrorMessage(err, "Impossible de retirer cette image.")}`);
                    } finally {
                      setSignatureBusy(false);
                    }
                  }}
                  disabled={signatureBusy}
                >
                  {i18nT("retirer_l_image_aae9b371")}
                </button>
              ) : null}

              <label className={styles.widthControl}>
                <span>{i18nT("taille_de_l_image_de_signature_6277a860")}</span>
              <select
                className={styles.signatureSelect}
                value={String(signatureImageWidth)}
                onChange={(e) => setSignatureImageWidth(Number(e.target.value || 400))}
              >
                {SIGNATURE_WIDTH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} style={{ background: "#ffffff", color: "#111111" }}>
                    {opt.label}
                  </option>
                ))}
              </select>
              </label>
              </div>
            </div>

            <div className={styles.previewPanel}>
              <span className={styles.fieldLabel}>{i18nT("apercu_actuel_8cb7a75c")}</span>
              <div className={styles.previewBox}>
                <pre className={styles.signaturePreview}>
              {signatureEnabled ? (signaturePreview || i18nT("apercu_indisponible_pour_le_moment_9ceb14a7")) : i18nT("signature_automatique_desactivee_9b6bd821")}
                </pre>
                {signatureEnabled && signatureImageUrl ? (
                  <div className={styles.signatureImageWrap}>
                    <img
                      src={signatureImageUrl}
                      alt={i18nT("apercu_image_de_signature_2631aa60")}
                      style={{ width: `${signatureImageWidth}px` }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className={styles.saveRow}>
            <Btn
              label={signatureBusy ? "Enregistrement…" : "Sauvegarder la signature"}
              disabled={signatureBusy}
              onClick={async () => {
                try {
                  setSignatureBusy(true);
                  const res = await fetch("/api/inrsend/signature", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enabled: signatureEnabled, template: signatureTemplate, imagePath: signatureImagePath, imageUrl: signatureImageUrl, imageWidth: signatureImageWidth }),
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(await getSimpleFrenchApiError(res, "Impossible d’enregistrer la signature."));
                  const nextSignatureEnabled = data?.enabled !== false;
                  const nextSignatureTemplate = String(data?.template || signatureTemplate);
                  const nextSignatureImagePath = String(data?.imagePath || signatureImagePath);
                  const nextSignatureImageUrl = String(data?.imageUrl || "");
                  const nextSignatureImageWidth = Number(data?.imageWidth || signatureImageWidth) || 400;
                  setSignatureEnabled(nextSignatureEnabled);
                  setSignatureTemplate(nextSignatureTemplate);
                  setSignatureImagePath(nextSignatureImagePath);
                  setSignatureImageUrl(nextSignatureImageUrl);
                  setSignaturePreview(String(data?.preview || ""));
                  setSignatureImageWidth(nextSignatureImageWidth);
                  savedSignatureSignatureRef.current = JSON.stringify({
                    signatureEnabled: nextSignatureEnabled,
                    signatureTemplate: nextSignatureTemplate,
                    signatureImageUrl: nextSignatureImageUrl,
                    signatureImagePath: nextSignatureImagePath,
                    signatureImageWidth: nextSignatureImageWidth,
                  });
                  onUnsavedChange?.(false);
                  setSignatureToast(i18nT("signature_enregistree_a0d7c464"));
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("inrsend:signature-updated"));
                  }
                } catch (e: any) {
                  setSignatureToast(`⚠️ ${getSimpleFrenchErrorMessage(e, "Impossible d’enregistrer la signature.")}`);
                } finally {
                  setSignatureBusy(false);
                }
              }}
            />
          </div>
        </div>
      </GlassCard>

      {imapModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(720px, 100%)",
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(20,20,24,0.95)",
              boxShadow: "0 18px 50px rgba(0,0,0,0.38)",
              padding: 16,
              color: "rgba(255,255,255,0.92)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 950 }}>
                  {imapEditingAccountId ? i18nT("imap_settings_title") : i18nT("connexion_imap_boite_4_6d4e6ca3")}
                </div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                  {imapEditingAccountId
                    ? i18nT("imap_settings_intro")
                    : <>{i18nT("choisissez_un_fournisseur_prerempli_saisissez_vo_9888b1f7")}{" "}<b>identifiant</b> {" "}{i18nT("et_votre_1db8b8ca")}{" "}<b>{i18nT("mot_de_passe_b47ea832")}</b>{i18nT("puis_cliquez_sur_cfcbb581")}{" "}<b>{i18nT("connecter_ca28e250")}</b>.</>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void requestCloseImapModal()}
                disabled={imapTestBusy || imapConnectBusy}
                style={{
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  padding: "8px 10px",
                  color: "rgba(255,255,255,0.9)",
                  cursor: "pointer",
                }}
              >
                {i18nT("fermer_5ab4ec64")}{" "}</button>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontSize: 12, opacity: 0.8 }}>{i18nT("fournisseur_97d91d89")}</label>
                <select
                  value={imapPresetKey}
                  onChange={(e) => {
                    const nextKey = e.target.value as ImapPresetKey;
                    setImapPresetKey(nextKey);
                    applyImapPreset(nextKey);
                  }}
                  style={imapSelectStyle}
                >
                  {Object.entries(IMAP_PRESETS).map(([k, v]) => (
                    <option key={k} value={k} style={{ background: "#ffffff", color: "#111827" }}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontSize: 12, opacity: 0.8 }}>{i18nT("identifiant_email_complet_47974259")}</label>
                <input
                  value={imapLogin}
                  onChange={(e) => setImapLogin(e.target.value)}
                  placeholder="contact@domaine.fr"
                  style={imapFieldStyle}
                />
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontSize: 12, opacity: 0.8 }}>{i18nT("mot_de_passe_ou_mot_de_0c1000b8")}</label>
                <div style={{ position: "relative" }}>
                  <input
                    value={imapPassword}
                    onChange={(e) => setImapPassword(e.target.value)}
                    type={imapShowPassword ? "text" : "password"}
                    placeholder="••••••••"
                    style={{ ...imapFieldStyle, width: "100%", paddingRight: 48 }}
                  />
                  <button
                    type="button"
                    onClick={() => setImapShowPassword((v) => !v)}
                    aria-label={imapShowPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    title={imapShowPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      border: "none",
                      background: "transparent",
                      color: "rgba(255,255,255,0.82)",
                      cursor: "pointer",
                      fontSize: 18,
                      lineHeight: 1,
                    }}
                  >
                    {imapShowPassword ? "🙈" : "👁️"}
                  </button>
                </div>
                {imapEditingAccountId ? (
                  <div style={{ fontSize: 12, opacity: 0.72 }}>{i18nT("imap_settings_password_hint")}</div>
                ) : null}
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {imapPresetKey === "other"
                    ? i18nT("autre_fournisseur_renseignez_vos_parametres_libr_6e3c39af")
                    : i18nT("reglages_preremplis_pour_value_tous_les_826097a0", { value0: IMAP_PRESETS[imapPresetKey].label })}
                </div>
                {imapAssistMessage ? (
                  <div style={{ fontSize: 12, color: "#93c5fd" }}>{imapAssistMessage}</div>
                ) : null}
                {isMobileImapLayout ? (
                  <>
                    <div style={{ display: "grid", gap: 8 }}>
                      <input
                        value={imapCustom.imap_host}
                        onChange={(e) => setImapCustom((p) => ({ ...p, imap_host: e.target.value }))}
                        placeholder={i18nT("serveur_imap_ex_imap_domaine_fr_e4179440")}
                        style={imapFieldStyle}
                      />
                      <div style={{ display: "grid", gridTemplateColumns: "96px minmax(0,1fr)", gap: 8 }}>
                        <input
                          value={imapCustom.imap_port}
                          onChange={(e) => setImapCustom((p) => ({ ...p, imap_port: Number(e.target.value || 0) }))}
                          placeholder="993"
                          type="number"
                          style={imapFieldStyle}
                        />
                        <select
                          value={imapCustom.imap_secure ? "ssl" : "none"}
                          onChange={(e) => {
                            const mode = e.target.value as ImapSecurityMode;
                            setImapCustom((p) => ({ ...p, imap_secure: mode === "ssl" }));
                          }}
                          style={{ ...imapSelectStyle, minWidth: 0 }}
                        >
                          <option value="ssl" style={{ background: "#ffffff", color: "#111827" }}>{i18nT("securite_imap_ssl_tls_e1dfe53d")}</option>
                          <option value="none" style={{ background: "#ffffff", color: "#111827" }}>{i18nT("securite_imap_aucune_8c6e8b55")}</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: 8 }}>
                      <input
                        value={imapCustom.smtp_host}
                        onChange={(e) => setImapCustom((p) => ({ ...p, smtp_host: e.target.value }))}
                        placeholder={i18nT("serveur_smtp_ex_smtp_domaine_fr_4946452d")}
                        style={imapFieldStyle}
                      />
                      <div style={{ display: "grid", gridTemplateColumns: "96px minmax(0,1fr)", gap: 8 }}>
                        <input
                          value={imapCustom.smtp_port}
                          onChange={(e) => {
                            const port = Number(e.target.value || 0);
                            setImapCustom((p) => {
                              const next = { ...p, smtp_port: port };
                              const suggestion = suggestSmtpSecurityForPort(port);
                              if (!suggestion) return next;
                              return applySmtpSecurityMode(next, suggestion.mode);
                            });
                            const suggestion = suggestSmtpSecurityForPort(port);
                            setImapAssistMessage(suggestion?.message || null);
                          }}
                          placeholder="587"
                          type="number"
                          style={imapFieldStyle}
                        />
                        <select
                          value={smtpSecurityModeFromSettings(imapCustom)}
                          onChange={(e) => {
                            const mode = e.target.value as SmtpSecurityMode;
                            setImapCustom((p) => applySmtpSecurityMode(p, mode));
                            setImapAssistMessage(
                              mode === "ssl"
                                ? "Sécurité SMTP réglée sur SSL/TLS. Recommandé le plus souvent avec le port 465."
                                : mode === "starttls"
                                ? "Sécurité SMTP réglée sur STARTTLS. Recommandé le plus souvent avec le port 587."
                                : "Sécurité SMTP personnalisée : aucun chiffrement sélectionné."
                            );
                          }}
                          style={{ ...imapSelectStyle, minWidth: 0 }}
                        >
                          <option value="ssl" style={{ background: "#ffffff", color: "#111827" }}>{i18nT("securite_smtp_ssl_tls_0bc61850")}</option>
                          <option value="starttls" style={{ background: "#ffffff", color: "#111827" }}>{i18nT("securite_smtp_starttls_5f10497e")}</option>
                          <option value="none" style={{ background: "#ffffff", color: "#111827" }}>{i18nT("securite_smtp_aucune_b257d5a8")}</option>
                        </select>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,0.86fr) 96px minmax(220px,0.64fr)", gap: 8 }}>
                      <input
                        value={imapCustom.imap_host}
                        onChange={(e) => setImapCustom((p) => ({ ...p, imap_host: e.target.value }))}
                        placeholder={i18nT("imap_host_ex_imap_domaine_fr_4ee758ea")}
                        style={imapFieldStyle}
                      />
                      <input
                        value={imapCustom.imap_port}
                        onChange={(e) => setImapCustom((p) => ({ ...p, imap_port: Number(e.target.value || 0) }))}
                        placeholder="993"
                        type="number"
                        style={imapFieldStyle}
                      />
                      <select
                        value={imapCustom.imap_secure ? "ssl" : "none"}
                        onChange={(e) => {
                          const mode = e.target.value as ImapSecurityMode;
                          setImapCustom((p) => ({ ...p, imap_secure: mode === "ssl" }));
                        }}
                        style={{ ...imapSelectStyle, minWidth: 0 }}
                      >
                        <option value="ssl" style={{ background: "#ffffff", color: "#111827" }}>{i18nT("securite_imap_ssl_tls_e1dfe53d")}</option>
                        <option value="none" style={{ background: "#ffffff", color: "#111827" }}>{i18nT("securite_imap_aucune_8c6e8b55")}</option>
                      </select>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,0.86fr) 96px minmax(220px,0.64fr)", gap: 8 }}>
                      <input
                        value={imapCustom.smtp_host}
                        onChange={(e) => setImapCustom((p) => ({ ...p, smtp_host: e.target.value }))}
                        placeholder={i18nT("smtp_host_ex_smtp_domaine_fr_d4b5a7fb")}
                        style={imapFieldStyle}
                      />
                      <input
                        value={imapCustom.smtp_port}
                        onChange={(e) => {
                          const port = Number(e.target.value || 0);
                          setImapCustom((p) => {
                            const next = { ...p, smtp_port: port };
                            const suggestion = suggestSmtpSecurityForPort(port);
                            if (!suggestion) return next;
                            return applySmtpSecurityMode(next, suggestion.mode);
                          });
                          const suggestion = suggestSmtpSecurityForPort(port);
                          setImapAssistMessage(suggestion?.message || null);
                        }}
                        placeholder="587"
                        type="number"
                        style={imapFieldStyle}
                      />
                      <select
                        value={smtpSecurityModeFromSettings(imapCustom)}
                        onChange={(e) => {
                          const mode = e.target.value as SmtpSecurityMode;
                          setImapCustom((p) => applySmtpSecurityMode(p, mode));
                          setImapAssistMessage(
                            mode === "ssl"
                              ? "Sécurité SMTP réglée sur SSL/TLS. Recommandé le plus souvent avec le port 465."
                              : mode === "starttls"
                              ? "Sécurité SMTP réglée sur STARTTLS. Recommandé le plus souvent avec le port 587."
                              : "Sécurité SMTP personnalisée : aucun chiffrement sélectionné."
                          );
                        }}
                        style={{ ...imapSelectStyle, minWidth: 0 }}
                      >
                        <option value="ssl" style={{ background: "#ffffff", color: "#111827" }}>{i18nT("securite_smtp_ssl_tls_0bc61850")}</option>
                        <option value="starttls" style={{ background: "#ffffff", color: "#111827" }}>{i18nT("securite_smtp_starttls_5f10497e")}</option>
                        <option value="none" style={{ background: "#ffffff", color: "#111827" }}>{i18nT("securite_smtp_aucune_b257d5a8")}</option>
                      </select>
                    </div>
                  </>
                )}
              </div>

              {imapFormError && (
                <div style={{ fontSize: 13, color: "#fbbf24" }}>⚠️ {imapFormError}</div>
              )}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                <button
                  type="button"
                  disabled={imapTestBusy || imapConnectBusy}
                  onClick={async () => {
                    try {
                      setImapFormError(null);
                      if (!imapLogin.trim() || (!imapEditingAccountId && !imapPassword)) {
                        setImapFormError(i18nT("saisis_identifiant_et_mot_de_passe_50c55741"));
                        return;
                      }
                      setImapConnectBusy(true);
                      const preset = imapCustom;
                      const r = await fetch("/api/integrations/imap/connect", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          login: imapLogin.trim(),
                          password: imapPassword,
                          accountId: imapEditingAccountId,
                          ...preset,
                        }),
                      });
                      const j = await r.json().catch(() => ({}));
                      if (!r.ok) throw new Error(await getSimpleFrenchApiError(r, "Connexion impossible"));
                      imapModalBaselineSignatureRef.current = "";
                      setImapModalOpen(false);
                      await refreshMailAccounts(true);
                      setToast(imapEditingAccountId ? "imap_updated" : "imap_connected");
                      setImapEditingAccountId(null);
                    } catch (e: any) {
                      setImapFormError(getSimpleFrenchErrorMessage(e, "Connexion impossible pour le moment."));
                    } finally {
                      setImapConnectBusy(false);
                    }
                  }}
                  style={{
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(56,189,248,0.18)",
                    color: "rgba(255,255,255,0.95)",
                    padding: "10px 12px",
                    cursor: "pointer",
                    opacity: imapTestBusy || imapConnectBusy ? 0.6 : 1,
                  }}
                >
                  {imapConnectBusy
                    ? (imapEditingAccountId ? i18nT("enregistrement_e7d5f232") : i18nT("connexion_807c2021"))
                    : (imapEditingAccountId ? i18nT("enregistrer_f7c8bcd8") : i18nT("connecter_ca28e250"))}
                </button>
              </div>

              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                {i18nT("astuce_si_votre_boite_a_la_167d4379")}{" "}<b>{i18nT("mot_de_passe_d_application_f6940e53")}</b>.
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
  );
}
