"use client";

import { useTranslations } from "next-intl";


import {
  getActiveBrowserUserId,
  readAccountCacheValue,
} from "@/lib/browserAccountCache";
import {
  readPinterestBoardUiCache,
  writePinterestBoardUiCache,
} from "@/lib/pinterestUiSessionCache";

import { useCallback, useEffect, useMemo, useState } from "react";
import { confirmInrcy } from "@/lib/inrcyDialog";

import styles from "../../dashboard.module.css";
import ConnectionPill from "../../_components/ConnectionPill";
import StatusMessage from "../../_components/StatusMessage";

const cardStyle = {
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.03)",
  borderRadius: 14,
  padding: 12,
  display: "grid",
  gap: 10,
} as const;

const inputStyle = {
  width: "100%",
  minWidth: 0,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(15,23,42,0.65)",
  colorScheme: "dark" as const,
  padding: "10px 12px",
  color: "white",
  outline: "none",
} as const;

type PinterestBoard = {
  id: string;
  name: string;
  url?: string | null;
  privacy?: string | null;
  pin_count?: number | null;
};

type PinterestSettings = {
  connected: boolean;
  accountConnected: boolean;
  requiresUpdate: boolean;
  connectionStatus: "connected" | "disconnected" | "needs_update";
  mode: "oauth" | "manual";
  accountName: string;
  username: string;
  profileUrl: string;
  publicProfileUrl: string;
  preferredMedia: "image" | "video" | "auto";
  autoHashtags: boolean;
  boards: PinterestBoard[];
  defaultBoardId: string;
  scopes: string;
  expiresAt: string | null;
};

const DEFAULT_SETTINGS: PinterestSettings = {
  connected: false,
  accountConnected: false,
  requiresUpdate: false,
  connectionStatus: "disconnected",
  mode: "manual",
  accountName: "",
  username: "",
  profileUrl: "",
  publicProfileUrl: "",
  preferredMedia: "auto",
  autoHashtags: true,
  boards: [],
  defaultBoardId: "",
  scopes: "",
  expiresAt: null,
};

const DASHBOARD_CHANNEL_STATE_CACHE_KEY = "inrcy_dashboard_channel_state_v1";
const PINTEREST_UI_CACHE_TTL_MS = 10 * 60 * 1000;
const PINTEREST_EVENTUAL_CONSISTENCY_TTL_MS = 2 * 60 * 1000;

type PinterestUiCacheEntry = {
  settings: PinterestSettings;
  updatedAt: number;
};

type RecentBoardMutation = {
  board?: PinterestBoard;
  expiresAt: number;
};

const pinterestUiCache = new Map<string, PinterestUiCacheEntry>();
const recentCreatedBoards = new Map<string, Map<string, RecentBoardMutation>>();
const recentRenamedBoards = new Map<string, Map<string, RecentBoardMutation>>();
const recentDeletedBoards = new Map<string, Map<string, RecentBoardMutation>>();

function getPinterestCacheKey() {
  return getActiveBrowserUserId() || "current";
}

function pruneMutationMap(map: Map<string, RecentBoardMutation> | undefined) {
  if (!map) return;
  const now = Date.now();
  for (const [id, value] of map.entries()) {
    if (value.expiresAt <= now) map.delete(id);
  }
}

function rememberBoardMutation(
  store: Map<string, Map<string, RecentBoardMutation>>,
  boardId: string,
  board?: PinterestBoard,
) {
  const key = getPinterestCacheKey();
  const map = store.get(key) || new Map<string, RecentBoardMutation>();
  map.set(boardId, {
    board,
    expiresAt: Date.now() + PINTEREST_EVENTUAL_CONSISTENCY_TTL_MS,
  });
  store.set(key, map);
}

function mergeLiveBoardsWithRecentMutations(boards: PinterestBoard[]) {
  const key = getPinterestCacheKey();
  const created = recentCreatedBoards.get(key);
  const renamed = recentRenamedBoards.get(key);
  const deleted = recentDeletedBoards.get(key);
  pruneMutationMap(created);
  pruneMutationMap(renamed);
  pruneMutationMap(deleted);

  const deletedIds = new Set(deleted ? [...deleted.keys()] : []);
  const byId = new Map<string, PinterestBoard>();

  for (const board of boards) {
    if (!deletedIds.has(board.id)) byId.set(board.id, board);
  }

  if (renamed) {
    for (const [id, mutation] of renamed.entries()) {
      if (deletedIds.has(id) || !mutation.board) continue;
      byId.set(id, { ...(byId.get(id) || mutation.board), ...mutation.board });
    }
  }

  if (created) {
    for (const [id, mutation] of created.entries()) {
      if (deletedIds.has(id) || !mutation.board) continue;
      byId.set(id, { ...(byId.get(id) || mutation.board), ...mutation.board });
    }
  }

  const createdIds = new Set(created ? [...created.keys()] : []);
  return [...byId.values()].sort((a, b) => {
    const aRecent = createdIds.has(a.id) ? 1 : 0;
    const bRecent = createdIds.has(b.id) ? 1 : 0;
    return bRecent - aRecent;
  });
}

function readDashboardPinterestConnectionHint(): boolean | null {
  try {
    const raw = readAccountCacheValue(DASHBOARD_CHANNEL_STATE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const state = asRecord(parsed.state || parsed);
    return typeof state.pinterestConnected === "boolean"
      ? state.pinterestConnected
      : null;
  } catch {
    return null;
  }
}

function getInitialPinterestSettings(): PinterestSettings {
  const key = getPinterestCacheKey();
  const cached = pinterestUiCache.get(key);
  if (cached && Date.now() - cached.updatedAt <= PINTEREST_UI_CACHE_TTL_MS) {
    return cached.settings;
  }

  const sharedBoardCache = readPinterestBoardUiCache();
  const connectedHint = readDashboardPinterestConnectionHint();
  if (sharedBoardCache) {
    return {
      ...DEFAULT_SETTINGS,
      connected: Boolean(connectedHint),
      accountConnected: Boolean(connectedHint),
      mode: connectedHint ? "oauth" : "manual",
      accountName: connectedHint ? "Compte Pinterest connecté" : "",
      boards: sharedBoardCache.boards,
      defaultBoardId: sharedBoardCache.defaultBoardId,
    };
  }
  if (connectedHint) {
    return {
      ...DEFAULT_SETTINGS,
      connected: true,
      accountConnected: true,
      mode: "oauth",
      accountName: "Compte Pinterest connecté",
    };
  }
  return DEFAULT_SETTINGS;
}

function cachePinterestSettings(settings: PinterestSettings) {
  pinterestUiCache.set(getPinterestCacheKey(), {
    settings,
    updatedAt: Date.now(),
  });
  writePinterestBoardUiCache(settings.boards, settings.defaultBoardId);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asBoard(value: unknown): PinterestBoard | null {
  const board = asRecord(value);
  const id = String(board.id || "").trim();
  if (!id) return null;
  return {
    id,
    name: String(board.name || "Tableau Pinterest"),
    url: String(board.url || "") || null,
    privacy: String(board.privacy || "") || null,
    pin_count: typeof board.pin_count === "number" ? board.pin_count : null,
  };
}

function normalizeBoards(value: unknown): PinterestBoard[] {
  return Array.isArray(value)
    ? value.map(asBoard).filter((item): item is PinterestBoard => Boolean(item))
    : [];
}

function mergeSettings(
  saved: PinterestSettings,
  status: any,
): PinterestSettings {
  if (!status?.ok) return saved;
  const liveBoards = normalizeBoards(status.boards);
  const boards = liveBoards.length > 0 ? liveBoards : saved.boards;
  const requiresUpdate = Boolean(status.status === "needs_update" || status.requiresUpdate);
  const accountConnected = Boolean(status.connected && !requiresUpdate);
  const hasPublicProfileUrl = Object.prototype.hasOwnProperty.call(status, "publicProfileUrl");
  const publicProfileUrl = hasPublicProfileUrl
    ? String(status.publicProfileUrl || "")
    : saved.publicProfileUrl;
  const hasProfileUrl = Object.prototype.hasOwnProperty.call(status, "profileUrl");
  const profileUrl = hasProfileUrl
    ? String(status.profileUrl || publicProfileUrl || "")
    : String(publicProfileUrl || saved.profileUrl || "");
  return {
    ...saved,
    connected: accountConnected,
    accountConnected,
    requiresUpdate,
    connectionStatus: requiresUpdate ? "needs_update" : accountConnected ? "connected" : "disconnected",
    mode: accountConnected ? "oauth" : saved.mode,
    accountName: String(
      status.accountName || status.username || saved.accountName || "",
    ),
    username: String(status.username || saved.username || ""),
    profileUrl,
    publicProfileUrl,
    boards,
    defaultBoardId: String(
      status.defaultBoardId || saved.defaultBoardId || "",
    ).trim(),
    scopes: String(status.scopes || ""),
    expiresAt: String(status.expiresAt || "") || null,
  };
}

function emitDashboardUpdate(settings: PinterestSettings) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("inrcy:pinterest-settings-updated", {
      detail: {
        connected: settings.connected,
        requiresUpdate: settings.requiresUpdate,
        connectionStatus: settings.connectionStatus,
        profileUrl: settings.publicProfileUrl || settings.profileUrl,
        accountName: settings.accountName || settings.username,
      },
    }),
  );
}

export default function PinterestSettingsContent({ onUnsavedChange }: { onUnsavedChange?: (hasUnsavedChanges: boolean) => void }) {
  const i18nT = useTranslations("settings");
  const [settings, setSettings] = useState<PinterestSettings>(() =>
    getInitialPinterestSettings(),
  );
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [boardAction, setBoardAction] = useState<string | null>(null);
  const [newBoardName, setNewBoardName] = useState("");
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [editingBoardName, setEditingBoardName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileLinkDraft, setProfileLinkDraft] = useState("");
  const [savingProfileLink, setSavingProfileLink] = useState(false);

  const editingBoard = editingBoardId ? settings.boards.find((board) => board.id === editingBoardId) : null;
  const hasUnsavedChanges = Boolean(
    newBoardName.trim() ||
      (editingBoard && editingBoardName.trim() !== editingBoard.name) ||
      profileLinkDraft !== (settings.publicProfileUrl || settings.profileUrl || ""),
  );

  useEffect(() => {
    onUnsavedChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChange]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Le statut local iNrCy doit arriver vite : aucune requête Pinterest externe
      // n'est nécessaire pour savoir si le compte OAuth est connecté.
      const statusResponse = await fetch("/api/integrations/pinterest/status", {
        cache: "no-store" as any,
      }).catch(() => null);
      const status = statusResponse?.ok
        ? await statusResponse.json().catch(() => null)
        : null;

      setSettings((current) => {
        const nextSettings = mergeSettings(current, status);
        cachePinterestSettings(nextSettings);
        emitDashboardUpdate(nextSettings);
        return nextSettings;
      });
    } catch (err) {
      console.warn("[pinterest-settings] load failed", err);
      setError(i18nT("chargement_des_reglages_pinterest_impossible_d9ba9660"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    cachePinterestSettings(settings);
  }, [settings]);

  useEffect(() => {
    setProfileLinkDraft(settings.publicProfileUrl || settings.profileUrl || "");
  }, [settings.profileUrl, settings.publicProfileUrl]);

  const connectPinterest = useCallback(() => {
    if (typeof window === "undefined") return;
    window.location.href =
      "/api/integrations/pinterest/start?returnTo=/dashboard?panel=pinterest";
  }, []);

  const refreshBoards = useCallback(
    async (successMessage = "Tableaux Pinterest actualisés.") => {
      setSyncing(true);
      setNotice(null);
      setError(null);
      try {
        const response = await fetch("/api/integrations/pinterest/boards", {
          cache: "no-store" as any,
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok)
          throw new Error(
            String(
              json?.error || "Impossible de récupérer les tableaux Pinterest.",
            ),
          );
        const liveBoards = normalizeBoards(json.boards);
        const boards = mergeLiveBoardsWithRecentMutations(liveBoards);
        const defaultBoardId = String(json.defaultBoardId || "").trim();
        setSettings((current) => ({ ...current, boards, defaultBoardId }));
        if (successMessage) setNotice(successMessage);
        return boards;
      } catch (err) {
        console.warn("[pinterest-settings] boards sync failed", err);
        setError(
          err instanceof Error
            ? err.message
            : "Synchronisation des tableaux Pinterest impossible.",
        );
        return [];
      } finally {
        setSyncing(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (loading || !settings.accountConnected) return;

    // Les tableaux sont synchronisés en arrière-plan sans bloquer l'affichage
    // du statut connecté ni effacer le cache UI pendant la propagation Pinterest.
    void refreshBoards("");

    let cancelled = false;
    void fetch("/api/integrations/pinterest/status?live=1", {
      cache: "no-store" as any,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json().catch(() => null);
      })
      .then((status) => {
        if (cancelled || !status?.ok) return;
        setSettings((current) => {
          const nextSettings = mergeSettings(current, status);
          cachePinterestSettings(nextSettings);
          emitDashboardUpdate(nextSettings);
          return nextSettings;
        });
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [loading, settings.accountConnected, refreshBoards]);

  const createBoard = useCallback(async () => {
    const name = newBoardName.trim().replace(/\s+/g, " ");
    if (!name) {
      setError(i18nT("saisis_un_nom_de_tableau_e2f85894"));
      return;
    }

    setBoardAction("create");
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/integrations/pinterest/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok)
        throw new Error(
          String(json?.error || "Création du tableau impossible."),
        );
      const createdBoard = asBoard(json?.board);
      const defaultBoardId = String(json?.defaultBoardId || "").trim();
      if (createdBoard) {
        rememberBoardMutation(
          recentCreatedBoards,
          createdBoard.id,
          createdBoard,
        );
      }

      setNewBoardName("");
      setSettings((current) => {
        const boards = createdBoard
          ? [
              createdBoard,
              ...current.boards.filter((item) => item.id !== createdBoard.id),
            ]
          : current.boards;
        return {
          ...current,
          boards,
          defaultBoardId:
            defaultBoardId || current.defaultBoardId || createdBoard?.id || "",
        };
      });
      setNotice(i18nT("tableau_value_cree_sur_pinterest_7d83f856", { value0: name }));
    } catch (err) {
      console.warn("[pinterest-settings] board create failed", err);
      setError(
        err instanceof Error
          ? err.message
          : "Création du tableau Pinterest impossible.",
      );
    } finally {
      setBoardAction(null);
    }
  }, [newBoardName]);

  const startRenameBoard = useCallback((board: PinterestBoard) => {
    setEditingBoardId(board.id);
    setEditingBoardName(board.name);
    setNotice(null);
    setError(null);
  }, []);

  const renameBoard = useCallback(
    async (board: PinterestBoard) => {
      const name = editingBoardName.trim().replace(/\s+/g, " ");
      if (!name) {
        setError(i18nT("le_nom_du_tableau_est_obligatoire_34572b49"));
        return;
      }
      if (name === board.name) {
        setEditingBoardId(null);
        setEditingBoardName("");
        return;
      }

      setBoardAction(`rename:${board.id}`);
      setNotice(null);
      setError(null);
      try {
        const response = await fetch(
          `/api/integrations/pinterest/boards/${encodeURIComponent(board.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          },
        );
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok)
          throw new Error(
            String(json?.error || "Modification du tableau impossible."),
          );
        const updatedBoard = asBoard(json?.board) || { ...board, name };
        rememberBoardMutation(recentRenamedBoards, board.id, updatedBoard);
        setSettings((current) => ({
          ...current,
          boards: current.boards.map((item) =>
            item.id === board.id ? { ...item, ...updatedBoard, name } : item,
          ),
        }));
        setEditingBoardId(null);
        setEditingBoardName("");
        setNotice(i18nT("tableau_renomme_value_dc8dea92", { value0: name }));
      } catch (err) {
        console.warn("[pinterest-settings] board rename failed", err);
        setError(
          err instanceof Error
            ? err.message
            : "Modification du tableau Pinterest impossible.",
        );
      } finally {
        setBoardAction(null);
      }
    },
    [editingBoardName],
  );

  const deleteBoard = useCallback(
    async (board: PinterestBoard) => {
      const confirmed = await confirmInrcy({
        eyebrow: i18nT("reglages_pinterest_1265d980"),
        title: i18nT("supprimer_ce_tableau_f5d4ca0f"),
        message: i18nT("le_tableau_value_sera_supprime_directement_7d8c42b7", { value0: board.name }),
        confirmLabel: i18nT("supprimer_1acfc1c7"),
        cancelLabel: i18nT("annuler_49ba3292"),
        variant: "danger",
      });
      if (!confirmed) return;

      setBoardAction(`delete:${board.id}`);
      setNotice(null);
      setError(null);
      try {
        const response = await fetch(
          `/api/integrations/pinterest/boards/${encodeURIComponent(board.id)}`,
          {
            method: "DELETE",
          },
        );
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok)
          throw new Error(
            String(json?.error || "Suppression du tableau impossible."),
          );
        rememberBoardMutation(recentDeletedBoards, board.id);
        if (editingBoardId === board.id) {
          setEditingBoardId(null);
          setEditingBoardName("");
        }
        const nextDefaultBoardId = String(json?.defaultBoardId || "").trim();
        setSettings((current) => ({
          ...current,
          boards: current.boards.filter((item) => item.id !== board.id),
          defaultBoardId:
            current.defaultBoardId === board.id
              ? nextDefaultBoardId
              : current.defaultBoardId,
        }));
        setNotice(i18nT("tableau_value_supprime_de_pinterest_bc6dcc3c", { value0: board.name }));
      } catch (err) {
        console.warn("[pinterest-settings] board delete failed", err);
        setError(
          err instanceof Error
            ? err.message
            : "Suppression du tableau Pinterest impossible.",
        );
      } finally {
        setBoardAction(null);
      }
    },
    [editingBoardId],
  );

  const setDefaultBoard = useCallback(async (board: PinterestBoard) => {
    setBoardAction(`default:${board.id}`);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/integrations/pinterest/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultBoardId: board.id }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok)
        throw new Error(String(json?.error || "Enregistrement impossible."));
      setSettings((current) => ({ ...current, defaultBoardId: board.id }));
      setNotice(i18nT("value_est_maintenant_le_tableau_par_309d14f4", { value0: board.name }));
    } catch (err) {
      console.warn("[pinterest-settings] default board failed", err);
      setError(
        err instanceof Error
          ? err.message
          : "Enregistrement du tableau par défaut impossible.",
      );
    } finally {
      setBoardAction(null);
    }
  }, []);

  const savePublicProfileUrl = useCallback(async () => {
    setSavingProfileLink(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/integrations/pinterest/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicProfileUrl: profileLinkDraft }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(String(json?.error || "Enregistrement du lien Pinterest impossible."));
      }
      const publicProfileUrl = String(json.publicProfileUrl || "");
      setSettings((current) => {
        const next = {
          ...current,
          publicProfileUrl,
          profileUrl: publicProfileUrl || current.profileUrl,
        };
        cachePinterestSettings(next);
        emitDashboardUpdate(next);
        return next;
      });
      setProfileLinkDraft(publicProfileUrl);
      setNotice(publicProfileUrl ? "Lien public Pinterest enregistré." : "Lien public Pinterest supprimé.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement du lien Pinterest impossible.");
    } finally {
      setSavingProfileLink(false);
    }
  }, [profileLinkDraft]);

  const disconnectPinterest = useCallback(async () => {
    setSyncing(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/integrations/pinterest/disconnect", {
        method: "POST",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok)
        throw new Error(String(json?.error || "Déconnexion impossible."));
      const nextSettings = {
        ...settings,
        connected: false,
        accountConnected: false,
        mode: "manual" as const,
        accountName: "",
        username: "",
        profileUrl: settings.publicProfileUrl || "",
        publicProfileUrl: settings.publicProfileUrl,
        boards: [],
        defaultBoardId: "",
        scopes: "",
        expiresAt: null,
      };
      setSettings(nextSettings);
      emitDashboardUpdate(nextSettings);
      setNotice(i18nT("pinterest_deconnecte_72f1ef65"));
    } catch (err) {
      console.warn("[pinterest-settings] disconnect failed", err);
      setError(i18nT("deconnexion_pinterest_impossible_199f4e79"));
    } finally {
      setSyncing(false);
    }
  }, [settings]);

  const boardOptions = useMemo(() => settings.boards, [settings.boards]);
  const statusLabel =
    loading && !settings.accountConnected
      ? "Chargement..."
      : settings.requiresUpdate
        ? "À reconnecter"
      : settings.accountConnected
        ? "Connecté"
        : "À connecter";
  const statusColor = settings.requiresUpdate
    ? "rgba(251,146,60,0.95)"
    : settings.accountConnected
    ? "rgba(34,197,94,0.95)"
    : loading
      ? "rgba(250,204,21,0.95)"
      : "rgba(148,163,184,0.9)";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(15,23,42,0.65)",
            padding: "8px 10px",
            borderRadius: 999,
            color: "rgba(255,255,255,0.92)",
            fontSize: 13,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: statusColor,
            }}
          />
          {i18nT("statut_b20e7fc2")}{" "}<strong>{statusLabel}</strong>
        </span>
      </div>

      <section style={cardStyle}>
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("compte_connecte_a442afe1")}</div>
          <ConnectionPill
            connected={settings.accountConnected}
            label={
              loading && !settings.accountConnected
                ? "Chargement..."
                : undefined
            }
          />
        </div>
        <div className={styles.blockSub}>
          {i18nT("connectez_le_compte_pinterest_utilise_pour_b841b241")}{" "}</div>

        <div style={{ display: "grid", gap: 8 }}>
          <input
            style={{
              ...inputStyle,
              opacity: settings.accountConnected ? 1 : 0.8,
            }}
            value={
              settings.accountConnected
                ? settings.accountName ||
                  settings.username ||
                  "Compte Pinterest connecté"
                : ""
            }
            readOnly
            placeholder={
              settings.accountConnected
                ? "Compte Pinterest connecté"
                : "Aucun compte connecté"
            }
            disabled={loading || !settings.accountConnected}
          />
        </div>

        {settings.accountConnected ? (
          <div style={{ display: "grid", gap: 7 }}>
            <label style={{ color: "rgba(255,255,255,0.88)", fontSize: 13, fontWeight: 750 }}>
              {i18nT("lien_public_de_votre_profil_pinterest_40c8dbbe")}{" "}</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                style={{ ...inputStyle, flex: "1 1 280px" }}
                value={profileLinkDraft}
                onChange={(event) => setProfileLinkDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void savePublicProfileUrl();
                  }
                }}
                placeholder="https://www.pinterest.fr/votre-profil/"
                disabled={savingProfileLink || loading}
                inputMode="url"
                autoComplete="url"
              />
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.pinterestConfigActionBtn} ${styles.connectBtn}`}
                onClick={() => void savePublicProfileUrl()}
                disabled={savingProfileLink || loading}
                style={{ flex: "0 0 auto" }}
              >
                {savingProfileLink ? i18nT("enregistrement_9bf1058a") : i18nT("enregistrer_le_lien_147106ab")}
              </button>
            </div>
            <small style={{ color: "rgba(255,255,255,0.58)", fontSize: 12 }}>
              {i18nT("ce_lien_est_deduit_automatiquement_du_fa27ff3a")}{" "}</small>
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "nowrap",
            alignItems: "center",
            overflowX: "auto",
          }}
        >
          {!settings.accountConnected ? (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.pinterestConfigActionBtn} ${styles.connectBtn}`}
              onClick={connectPinterest}
              disabled={loading || syncing}
            >
              {syncing ? i18nT("connexion_7adf849f") : i18nT("connecter_pinterest_05788f6c")}
            </button>
          ) : (
            <>
              {settings.profileUrl ? (
                <a
                  href={settings.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`${styles.actionBtn} ${styles.pinterestConfigActionBtn} ${styles.viewBtn}`}
                  style={{ flex: "0 0 auto" }}
                >
                  {i18nT("voir_le_compte_1cbd7501")}{" "}</a>
              ) : null}
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.pinterestConfigActionBtn} ${styles.secondaryBtn}`}
                onClick={connectPinterest}
                disabled={loading || syncing}
                style={{ flex: "0 0 auto" }}
              >
                {i18nT("reconnecter_823c9e87")}{" "}</button>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.pinterestConfigActionBtn} ${styles.disconnectBtn}`}
                onClick={disconnectPinterest}
                disabled={syncing}
                style={{ flex: "0 0 auto" }}
              >
                {syncing ? i18nT("deconnexion_f5a5666d") : i18nT("deconnecter_9c1ef392")}
              </button>
            </>
          )}
        </div>
      </section>

      {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
      {notice ? (
        <StatusMessage variant="success">{notice}</StatusMessage>
      ) : null}

      {settings.accountConnected ? (
        <section style={cardStyle}>
          <div className={styles.blockHeaderRow}>
            <div className={styles.blockTitle}>{i18nT("mes_tableaux_pinterest_b7d9585a")}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.pinterestConfigActionBtn} ${styles.secondaryBtn}`}
                onClick={() => void refreshBoards("")}
                disabled={Boolean(boardAction) || syncing || loading}
                title={i18nT("actualiser_les_tableaux_a0569620")}
                aria-label={i18nT("actualiser_les_tableaux_pinterest_42c576bb")}
                style={{ minWidth: 34, minHeight: 30, padding: "0 9px" }}
              >
                {syncing ? "…" : "↻"}
              </button>
              <ConnectionPill connected={settings.accountConnected} />
            </div>
          </div>
          <div className={styles.blockSub}>
            {i18nT("gerez_ici_vos_tableaux_les_actions_443e4562")}{" "}</div>

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <input
              style={{ ...inputStyle, flex: "1 1 260px" }}
              value={newBoardName}
              onChange={(event) => setNewBoardName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void createBoard();
                }
              }}
              maxLength={180}
              placeholder={i18nT("nom_du_nouveau_tableau_ecd5a307")}
              disabled={Boolean(boardAction) || syncing || loading}
            />
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.pinterestConfigActionBtn} ${styles.connectBtn}`}
              onClick={() => void createBoard()}
              disabled={
                Boolean(boardAction) ||
                syncing ||
                loading ||
                !newBoardName.trim()
              }
            >
              {boardAction === "create" ? i18nT("creation_dca950ed") : i18nT("creer_un_tableau_4beff6f9")}
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gap: 8,
              maxHeight: boardOptions.length >= 5 ? 360 : undefined,
              overflowY: boardOptions.length >= 5 ? "auto" : "visible",
              overscrollBehavior: "contain",
              paddingRight: boardOptions.length >= 5 ? 4 : 0,
              scrollbarGutter: boardOptions.length >= 5 ? "stable" : undefined,
            }}
          >
            {boardOptions.length === 0 ? (
              <div
                style={{
                  color: "rgba(255,255,255,0.68)",
                  fontSize: 13,
                  padding: "8px 2px",
                }}
              >
                {i18nT("aucun_tableau_disponible_creez_votre_premier_36cf04bd")}{" "}</div>
            ) : (
              boardOptions.map((board) => {
                const isEditing = editingBoardId === board.id;
                const isRenaming = boardAction === `rename:${board.id}`;
                const isDeleting = boardAction === `delete:${board.id}`;
                const isSettingDefault = boardAction === `default:${board.id}`;
                const isDefault = settings.defaultBoardId === board.id;
                const isBusy = Boolean(boardAction) || syncing;

                return (
                  <div
                    key={board.id}
                    style={{
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(15,23,42,0.45)",
                      borderRadius: 12,
                      padding: 10,
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    {isEditing ? (
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        <input
                          style={{ ...inputStyle, flex: "1 1 240px" }}
                          value={editingBoardName}
                          onChange={(event) =>
                            setEditingBoardName(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void renameBoard(board);
                            }
                            if (event.key === "Escape") {
                              setEditingBoardId(null);
                              setEditingBoardName("");
                            }
                          }}
                          maxLength={180}
                          autoFocus
                          disabled={isRenaming}
                        />
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles.pinterestConfigActionBtn} ${styles.connectBtn}`}
                          onClick={() => void renameBoard(board)}
                          disabled={isRenaming || !editingBoardName.trim()}
                        >
                          {isRenaming ? i18nT("enregistrement_9bf1058a") : i18nT("enregistrer_f7c8bcd8")}
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles.pinterestConfigActionBtn} ${styles.secondaryBtn}`}
                          onClick={() => {
                            setEditingBoardId(null);
                            setEditingBoardName("");
                          }}
                          disabled={isRenaming}
                        >
                          {i18nT("annuler_49ba3292")}{" "}</button>
                      </div>
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          gap: 10,
                          flexWrap: "wrap",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            <div
                              style={{
                                color: "white",
                                fontWeight: 700,
                                overflowWrap: "anywhere",
                              }}
                            >
                              {board.name}
                            </div>
                            {isDefault ? (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 800,
                                  color: "#fde68a",
                                  border: "1px solid rgba(250,204,21,0.35)",
                                  background: "rgba(250,204,21,0.10)",
                                  borderRadius: 999,
                                  padding: "3px 7px",
                                }}
                              >
                                {i18nT("par_defaut_fa7ad5b3")}{" "}</span>
                            ) : null}
                          </div>
                          {typeof board.pin_count === "number" ? (
                            <div
                              style={{
                                color: "rgba(255,255,255,0.58)",
                                fontSize: 12,
                                marginTop: 2,
                              }}
                            >
                              {board.pin_count}{" "}
                              {board.pin_count > 1 ? i18nT("epingles_df9ab1a3") : i18nT("epingle_3dfeed54")}
                            </div>
                          ) : null}
                        </div>
                        <div
                          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                        >
                          {!isDefault ? (
                            <button
                              type="button"
                              className={`${styles.actionBtn} ${styles.pinterestConfigActionBtn} ${styles.secondaryBtn}`}
                              onClick={() => void setDefaultBoard(board)}
                              disabled={isBusy}
                            >
                              {isSettingDefault
                                ? i18nT("enregistrement_9bf1058a")
                                : i18nT("definir_par_defaut_a8ce62ae")}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={`${styles.actionBtn} ${styles.pinterestConfigActionBtn} ${styles.secondaryBtn}`}
                            onClick={() => startRenameBoard(board)}
                            disabled={isBusy}
                          >
                            {i18nT("renommer_8e8a86e8")}{" "}</button>
                          <button
                            type="button"
                            className={`${styles.actionBtn} ${styles.pinterestConfigActionBtn} ${styles.disconnectBtn}`}
                            onClick={() => void deleteBoard(board)}
                            disabled={isBusy}
                          >
                            {isDeleting ? i18nT("suppression_a67d695d") : i18nT("supprimer_1acfc1c7")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
