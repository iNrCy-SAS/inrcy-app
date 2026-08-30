"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import type { DashboardChannelKey } from "@/lib/dashboardChannels";
import type { InrstatsChannelBlock } from "@/lib/inrstats/channelBlocks";
import type { ChannelResourcePhase } from "./channelResourcePhase";

type PatchChannelConnectionLocally = (
  channel: DashboardChannelKey,
  patch: Partial<InrstatsChannelBlock["connection"]>,
  options?: { clearData?: boolean; clearError?: boolean },
) => void;

type TriggerChannelRefresh = (channel: DashboardChannelKey) => Promise<void>;

type UpdateRootSettingsKey = (key: "gmb" | "facebook" | "instagram" | "linkedin", nextObj: any) => Promise<void>;

type LinkedinOrganization = { id: string; name: string; url?: string | null };
type LinkedinConnectionTarget = "profile" | "organization";

type UseLinkedinChannelOptions = {
  panel?: string | null;
  searchParams?: { get(name: string): string | null };
  patchChannelConnectionLocally: PatchChannelConnectionLocally;
  triggerChannelRefresh: TriggerChannelRefresh;
  updateRootSettingsKey: UpdateRootSettingsKey;
};

export function useLinkedinChannel({
  panel,
  searchParams,
  patchChannelConnectionLocally,
  triggerChannelRefresh,
  updateRootSettingsKey,
}: UseLinkedinChannelOptions) {
  const [linkedinUrl, setLinkedinUrl] = useState<string>("");
  const [linkedinAccountConnected, setLinkedinAccountConnected] = useState<boolean>(false);
  const [linkedinConnected, setLinkedinConnected] = useState<boolean>(false);
  const [linkedinConnectionStatus, setLinkedinConnectionStatus] = useState<ConnectionDisplayStatus>("disconnected");
  const [linkedinDisplayName, setLinkedinDisplayName] = useState<string>("");
  const [linkedinUrlNotice, setLinkedinUrlNotice] = useState<string | null>(null);
  const [linkedinUrlError, setLinkedinUrlError] = useState<string | null>(null);
  const [linkedinOrganizations, setLinkedinOrganizations] = useState<LinkedinOrganization[]>([]);
  const [linkedinOrganizationsLoading, setLinkedinOrganizationsLoading] = useState(false);
  const [linkedinOrganizationsPhase, setLinkedinOrganizationsPhase] = useState<ChannelResourcePhase>("idle");
  const [linkedinOrganizationPickerOpen, setLinkedinOrganizationPickerOpen] = useState(false);
  const [linkedinSelectedOrganizationId, setLinkedinSelectedOrganizationId] = useState<string>("");
  const [linkedinSelectedOrganizationName, setLinkedinSelectedOrganizationName] = useState<string>("");
  const [linkedinShareToPersonalProfile, setLinkedinShareToPersonalProfile] = useState<boolean>(false);
  const [linkedinShareToPersonalProfileBusy, setLinkedinShareToPersonalProfileBusy] = useState<boolean>(false);
  const organizationsAutoLoadRef = useRef(false);

  const clearPanelNotices = useCallback(() => {
    setLinkedinUrlNotice(null);
    setLinkedinUrlError(null);
  }, []);

  const setPanelSuccess = useCallback((message: string, timeout = 2200) => {
    clearPanelNotices();
    const clean = message.trim();
    setLinkedinUrlNotice(clean);
    window.setTimeout(clearPanelNotices, timeout);
  }, [clearPanelNotices]);

  const setPanelError = useCallback((input: unknown, fallback: string, timeout = 3200) => {
    clearPanelNotices();
    const clean = getSimpleFrenchErrorMessage(input, fallback);
    setLinkedinUrlError(clean);
    window.setTimeout(clearPanelNotices, timeout);
  }, [clearPanelNotices]);

  const connectLinkedinAccount = useCallback(async (target: LinkedinConnectionTarget = "profile") => {
    const targetParam = target === "organization" ? "&linkedinTarget=organization" : "&linkedinTarget=profile";
    const returnTo = encodeURIComponent(`/dashboard?panel=linkedin${targetParam}`);
    window.location.href = `/api/integrations/linkedin/start?returnTo=${returnTo}`;
  }, []);

  const connectLinkedinBusinessAccount = useCallback(async () => {
    await connectLinkedinAccount("organization");
  }, [connectLinkedinAccount]);

  const disconnectLinkedinAccount = useCallback(async () => {
    const response = await fetch("/api/integrations/linkedin/disconnect-account", { method: "POST" }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    if (!response || !response.ok || payload?.ok === false) {
      setPanelError(payload?.error, "Impossible de déconnecter le compte LinkedIn.");
      return;
    }
    setLinkedinAccountConnected(false);
    setLinkedinConnected(false);
    setLinkedinDisplayName("");
    setLinkedinUrl("");
    setLinkedinOrganizations([]);
    setLinkedinOrganizationPickerOpen(false);
    setLinkedinSelectedOrganizationId("");
    setLinkedinSelectedOrganizationName("");
    setLinkedinShareToPersonalProfile(false);
    organizationsAutoLoadRef.current = false;
    setLinkedinOrganizationsPhase("idle");
    patchChannelConnectionLocally("linkedin", {
      connected: false,
      accountConnected: false,
      configured: false,
      expired: false,
      resourceId: null,
      resourceLabel: null,
      resourceUrl: null,
    }, { clearData: true });
    await updateRootSettingsKey("linkedin", {
      accountConnected: false,
      connected: false,
      displayName: "",
      url: "",
      profileUrl: "",
      orgId: "",
      orgName: "",
      orgUrl: "",
      shareToPersonalProfile: false,
    });
    await triggerChannelRefresh("linkedin");
    setPanelSuccess("Compte LinkedIn déconnecté.");
  }, [patchChannelConnectionLocally, updateRootSettingsKey, triggerChannelRefresh, setPanelError, setPanelSuccess]);

  const persistLinkedinOrganization = useCallback(async (org: LinkedinOrganization, options?: { silent?: boolean }) => {
    if (!org?.id) return false;

    const resolvedUrl = (org.url || `https://www.linkedin.com/company/${org.id}`).trim();
    const res = await fetch("/api/integrations/linkedin/select-organization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: org.id, orgName: org.name, orgUrl: resolvedUrl }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPanelError(data?.error || "Impossible de connecter cette page LinkedIn.", "Impossible de connecter cette page LinkedIn.", 4200);
      return false;
    }

    const nextUrl = String(data?.profileUrl || data?.organizationUrl || resolvedUrl || linkedinUrl || "");
    setLinkedinSelectedOrganizationId(org.id);
    setLinkedinSelectedOrganizationName(org.name);
    setLinkedinOrganizationPickerOpen(false);
    setLinkedinAccountConnected(true);
    setLinkedinConnected(true);
    setLinkedinConnectionStatus("connected");
    if (nextUrl) setLinkedinUrl(nextUrl);
    await updateRootSettingsKey("linkedin", {
      accountConnected: true,
      connected: true,
      displayName: linkedinDisplayName,
      url: nextUrl,
      orgId: org.id,
      orgName: org.name,
      orgUrl: nextUrl,
    });
    patchChannelConnectionLocally("linkedin", {
      connected: true,
      accountConnected: true,
      configured: true,
      resourceId: org.id,
      resourceLabel: org.name,
      resourceUrl: nextUrl || null,
    }, { clearData: true });
    await triggerChannelRefresh("linkedin");
    if (!options?.silent) setPanelSuccess(`Page LinkedIn « ${org.name} » connectée.`, 2400);
    return true;
  }, [linkedinDisplayName, linkedinUrl, updateRootSettingsKey, patchChannelConnectionLocally, triggerChannelRefresh, setPanelSuccess, setPanelError]);

  const loadLinkedinOrganizations = useCallback(async (options?: { resetSelection?: boolean }) => {
    if (!linkedinAccountConnected) {
      setPanelError("Connectez d'abord votre accès LinkedIn.", "Connectez d'abord votre accès LinkedIn.", 2600);
      return;
    }

    setLinkedinOrganizationsLoading(true);
    setLinkedinOrganizationsPhase("searching");
    try {
      const res = await fetch("/api/integrations/linkedin/organizations", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Impossible de récupérer les pages LinkedIn.");
      const orgs: unknown[] = Array.isArray(data?.organizations) ? data.organizations : [];
      const cleanOrgs: LinkedinOrganization[] = orgs
        .map((org): LinkedinOrganization => {
          const record = org && typeof org === "object" ? (org as Record<string, unknown>) : {};
          const rawId = record.id;
          const rawName = record.name;
          const rawUrl = record.url;
          const id = typeof rawId === "string" ? rawId : String(rawId || "");
          const name = typeof rawName === "string" ? rawName : String(rawName || id || "");
          const url = typeof rawUrl === "string" && rawUrl.trim() ? rawUrl.trim() : (id ? `https://www.linkedin.com/company/${id}` : null);
          return { id, name, url };
        })
        .filter((org: LinkedinOrganization) => Boolean(org.id && org.name));

      setLinkedinOrganizations(cleanOrgs);

      if (cleanOrgs.length === 1) {
        const only = cleanOrgs[0];
        const alreadyConnected = linkedinSelectedOrganizationId === only.id && linkedinConnected && !options?.resetSelection;
        const shouldRefreshStoredLabel = alreadyConnected && (
          (only.name && only.name !== linkedinSelectedOrganizationName) ||
          (only.url && only.url !== linkedinUrl)
        );

        if (alreadyConnected) {
          setLinkedinSelectedOrganizationName(only.name);
          if (only.url) setLinkedinUrl(only.url);
          if (shouldRefreshStoredLabel) {
            setLinkedinOrganizationsPhase("connecting");
            await persistLinkedinOrganization(only, { silent: true });
          }
        } else {
          setLinkedinOrganizationsPhase("connecting");
          const ok = await persistLinkedinOrganization(only, { silent: true });
          if (ok) setPanelSuccess(`Page LinkedIn « ${only.name} » connectée automatiquement.`, 2600);
        }
        setLinkedinOrganizationPickerOpen(false);
        return;
      }

      const matchedSelected = cleanOrgs.find((org: LinkedinOrganization) => org.id === linkedinSelectedOrganizationId);
      if (matchedSelected?.name) {
        setLinkedinSelectedOrganizationName(matchedSelected.name);
        if (matchedSelected.url && !options?.resetSelection) setLinkedinUrl(matchedSelected.url);
        if (!options?.resetSelection && (
          matchedSelected.name !== linkedinSelectedOrganizationName ||
          (matchedSelected.url && matchedSelected.url !== linkedinUrl)
        )) {
          setLinkedinOrganizationsPhase("connecting");
          await persistLinkedinOrganization(matchedSelected, { silent: true });
        }
      }

      if (!cleanOrgs.length) {
        setLinkedinOrganizationPickerOpen(false);
        setPanelError(
          "Aucune page LinkedIn administrée trouvée. Vérifiez les droits OAuth puis reconnectez LinkedIn.",
          "Aucune page LinkedIn administrée trouvée.",
          4200,
        );
      } else {
        setLinkedinOrganizationPickerOpen(true);
        if (!linkedinSelectedOrganizationId || options?.resetSelection) {
          setPanelSuccess("Sélectionnez la page LinkedIn à connecter.", 2400);
        }
      }
    } catch (error) {
      setPanelError(error, "Impossible de récupérer les pages LinkedIn.", 4200);
    } finally {
      setLinkedinOrganizationsLoading(false);
      setLinkedinOrganizationsPhase("idle");
    }
  }, [linkedinAccountConnected, linkedinConnected, linkedinSelectedOrganizationId, linkedinSelectedOrganizationName, linkedinUrl, persistLinkedinOrganization, setPanelSuccess, setPanelError]);

  useEffect(() => {
    const linked = searchParams?.get("linked");
    const ok = searchParams?.get("ok");
    const target = searchParams?.get("linkedinTarget");
    const shouldAutoLoad = panel === "linkedin" && linked === "linkedin" && ok === "1" && target === "organization";

    if (!shouldAutoLoad) {
      organizationsAutoLoadRef.current = false;
      return;
    }

    if (!linkedinAccountConnected || linkedinOrganizationsLoading || organizationsAutoLoadRef.current) return;

    organizationsAutoLoadRef.current = true;
    void loadLinkedinOrganizations();
  }, [panel, searchParams, linkedinAccountConnected, linkedinOrganizationsLoading, loadLinkedinOrganizations]);

  const selectLinkedinOrganization = useCallback(async (orgId: string) => {
    const org = linkedinOrganizations.find((item: LinkedinOrganization) => item.id === orgId);
    if (!org) return;
    setLinkedinOrganizationsPhase("connecting");
    try {
      await persistLinkedinOrganization(org);
    } finally {
      setLinkedinOrganizationsPhase("idle");
    }
  }, [linkedinOrganizations, persistLinkedinOrganization]);

  const useLinkedinPersonalProfile = useCallback(async () => {
    if (!linkedinAccountConnected) {
      setPanelError("Connectez d'abord votre profil LinkedIn.", "Connectez d'abord votre profil LinkedIn.", 2600);
      return;
    }

    const res = await fetch("/api/integrations/linkedin/select-organization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "profile" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPanelError(data?.error || "Impossible d'utiliser le profil LinkedIn.", "Impossible d'utiliser le profil LinkedIn.", 4200);
      return;
    }

    const nextUrl = String(data?.profileUrl || linkedinUrl || "");
    setLinkedinSelectedOrganizationId("");
    setLinkedinSelectedOrganizationName("");
    setLinkedinShareToPersonalProfile(false);
    setLinkedinOrganizationPickerOpen(false);
    setLinkedinConnected(true);
    setLinkedinConnectionStatus("connected");
    if (nextUrl) setLinkedinUrl(nextUrl);
    await updateRootSettingsKey("linkedin", {
      accountConnected: true,
      connected: true,
      displayName: linkedinDisplayName,
      url: nextUrl,
      profileUrl: nextUrl,
      orgId: "",
      orgName: "",
      orgUrl: "",
      shareToPersonalProfile: false,
    });
    patchChannelConnectionLocally("linkedin", {
      connected: true,
      accountConnected: true,
      configured: true,
      resourceId: null,
      resourceLabel: linkedinDisplayName || null,
      resourceUrl: nextUrl || null,
    }, { clearData: true });
    await triggerChannelRefresh("linkedin");
    setPanelSuccess("Profil personnel LinkedIn activé.", 2200);
  }, [linkedinAccountConnected, linkedinDisplayName, linkedinUrl, updateRootSettingsKey, patchChannelConnectionLocally, triggerChannelRefresh, setPanelSuccess, setPanelError]);

  const updateLinkedinShareToPersonalProfile = useCallback(async (enabled: boolean) => {
    const nextEnabled = Boolean(enabled);
    const previous = linkedinShareToPersonalProfile;
    setLinkedinShareToPersonalProfile(nextEnabled);
    setLinkedinShareToPersonalProfileBusy(true);
    clearPanelNotices();

    try {
      const res = await fetch("/api/integrations/linkedin/share-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Impossible d'enregistrer l'option LinkedIn.");
      setPanelSuccess("Option LinkedIn enregistrée.", 1600);
    } catch (error) {
      setLinkedinShareToPersonalProfile(previous);
      setPanelError(error, "Impossible d'enregistrer l'option LinkedIn.", 3600);
    } finally {
      setLinkedinShareToPersonalProfileBusy(false);
    }
  }, [linkedinShareToPersonalProfile, clearPanelNotices, setPanelSuccess, setPanelError]);

  const saveLinkedinProfileUrl = useCallback(async () => {
    const raw = (linkedinUrl ?? "").trim();

    if (raw.length > 0) {
      const ok =
        raw.startsWith("https://www.linkedin.com/in/") ||
        raw.startsWith("https://linkedin.com/in/") ||
        raw.startsWith("https://www.linkedin.com/pub/") ||
        raw.startsWith("https://linkedin.com/pub/") ||
        raw.startsWith("https://www.linkedin.com/company/") ||
        raw.startsWith("https://linkedin.com/company/");
      if (!ok) {
        setPanelError("Lien LinkedIn invalide.", "Lien LinkedIn invalide. Exemple : https://www.linkedin.com/in/votre-profil ou https://www.linkedin.com/company/votre-page", 3600);
        return;
      }
    }

    const nextLinkedinSettings: Record<string, unknown> = {
      accountConnected: linkedinAccountConnected,
      connected: linkedinConnected,
      displayName: linkedinDisplayName,
      url: raw,
      orgId: linkedinSelectedOrganizationId,
      orgName: linkedinSelectedOrganizationName,
    };
    if (linkedinSelectedOrganizationId) {
      nextLinkedinSettings.orgUrl = raw;
    } else {
      nextLinkedinSettings.profileUrl = raw;
      nextLinkedinSettings.orgUrl = "";
    }

    await updateRootSettingsKey("linkedin", nextLinkedinSettings);

    patchChannelConnectionLocally("linkedin", {
      connected: linkedinConnected,
      accountConnected: linkedinAccountConnected,
      configured: linkedinConnected,
      resourceLabel: linkedinSelectedOrganizationName || linkedinDisplayName || null,
      resourceUrl: raw || null,
    }, { clearData: false });
    triggerChannelRefresh("linkedin");
    setPanelSuccess("Lien LinkedIn enregistré.", 1800);
  }, [linkedinUrl, linkedinAccountConnected, linkedinConnected, linkedinDisplayName, linkedinSelectedOrganizationId, linkedinSelectedOrganizationName, patchChannelConnectionLocally, updateRootSettingsKey, triggerChannelRefresh, setPanelSuccess, setPanelError]);

  return {
    linkedinUrl,
    setLinkedinUrl,
    linkedinAccountConnected,
    setLinkedinAccountConnected,
    linkedinConnected,
    setLinkedinConnected,
    linkedinConnectionStatus,
    setLinkedinConnectionStatus,
    linkedinDisplayName,
    setLinkedinDisplayName,
    linkedinUrlNotice,
    setLinkedinUrlNotice,
    linkedinUrlError,
    connectLinkedinAccount,
    connectLinkedinBusinessAccount,
    disconnectLinkedinAccount,
    saveLinkedinProfileUrl,
    linkedinOrganizations,
    linkedinOrganizationsLoading,
    linkedinOrganizationsPhase,
    linkedinOrganizationPickerOpen,
    linkedinSelectedOrganizationId,
    setLinkedinSelectedOrganizationId,
    linkedinSelectedOrganizationName,
    setLinkedinSelectedOrganizationName,
    linkedinShareToPersonalProfile,
    setLinkedinShareToPersonalProfile,
    linkedinShareToPersonalProfileBusy,
    updateLinkedinShareToPersonalProfile,
    loadLinkedinOrganizations,
    selectLinkedinOrganization,
    useLinkedinPersonalProfile,
    clearPanelNotices,
    setPanelSuccess,
    setPanelError,
  };
}
