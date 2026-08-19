"use client";

import { useLocale, useTranslations } from "next-intl";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";

import styles from "./diagnostic.module.css";

type Severity = "ok" | "warn" | "error" | "running" | "pending";

type DiagnosticCheck = {
  id: string;
  title: string;
  description: string;
  target: string;
  severity: Severity;
  statusText: string;
  detail?: string;
  durationMs?: number;
  httpStatus?: number;
};

type SendState = "idle" | "sending" | "sent" | "error";

const TEST_TIMEOUT_MS = 8000;

type Translator = (_key: string) => string;

function nowLabel(locale: string) {
  return new Date().toLocaleString(locale, {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function statusLabel(severity: Severity, i18nT: Translator) {
  switch (severity) {
    case "ok":
      return "OK";
    case "warn":
      return i18nT("a_verifier_8f5f7255");
    case "error":
      return i18nT("bloque_70f90b1a");
    case "running":
      return i18nT("test_en_cours_061a65d2");
    default:
      return i18nT("en_attente_5231158f");
  }
}

function getErrorMessage(error: unknown, i18nT: Translator): string {
  return getClientUserFacingErrorMessage(error, i18nT("une_verification_n_a_pas_pu_f122debc"));
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<{ response: Response; durationMs: number }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  const started = performance.now();

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    return { response, durationMs: Math.round(performance.now() - started) };
  } finally {
    window.clearTimeout(timeout);
  }
}

function buildInitialChecks(i18nT: Translator): DiagnosticCheck[] {
  return [
    {
      id: "browser",
      title: i18nT("navigateur_a93302c2"),
      description: i18nT("verifie_les_informations_de_base_du_3efdc91f"),
      target: "Navigateur client",
      severity: "pending",
      statusText: i18nT("en_attente_5231158f"),
    },
    {
      id: "local-storage",
      title: i18nT("stockage_local_92a84589"),
      description: i18nT("verifie_que_le_navigateur_peut_conserver_b7490e42"),
      target: "localStorage",
      severity: "pending",
      statusText: i18nT("en_attente_5231158f"),
    },
    {
      id: "session-storage",
      title: i18nT("stockage_de_session_d8bac644"),
      description: i18nT("verifie_que_le_stockage_temporaire_du_3806ed7b"),
      target: "sessionStorage",
      severity: "pending",
      statusText: i18nT("en_attente_5231158f"),
    },
    {
      id: "cookies",
      title: i18nT("cookies_navigateur_90ae4f4f"),
      description: i18nT("verifie_que_les_cookies_du_domaine_8831b8fd"),
      target: "Cookies iNrCy",
      severity: "pending",
      statusText: i18nT("en_attente_5231158f"),
    },
    {
      id: "api-ping",
      title: i18nT("api_inrcy_0d898269"),
      description: i18nT("verifie_que_le_pc_peut_appeler_018d793c"),
      target: "/api/diagnostic/ping",
      severity: "pending",
      statusText: i18nT("en_attente_5231158f"),
    },
    {
      id: "asset-logo",
      title: i18nT("ressources_inrcy_9408aa56"),
      description: i18nT("verifie_que_les_ressources_publiques_de_a62797ad"),
      target: "/logo-inrcy.png",
      severity: "pending",
      statusText: i18nT("en_attente_5231158f"),
    },
  ];
}

function makeCheck(id: string, patch: Partial<DiagnosticCheck>, i18nT: Translator): DiagnosticCheck {
  const base = buildInitialChecks(i18nT).find((check) => check.id === id);
  return {
    id,
    title: base?.title || id,
    description: base?.description || "",
    target: base?.target || "",
    severity: patch.severity || "pending",
    statusText: patch.statusText || i18nT("en_attente_5231158f"),
    detail: patch.detail,
    durationMs: patch.durationMs,
    httpStatus: patch.httpStatus,
  };
}

function checkFromHttp(id: string, response: Response, durationMs: number, i18nT: Translator): DiagnosticCheck {
  if (response.ok) {
    return makeCheck(id, {
      severity: "ok",
      statusText: "OK",
      detail: `Réponse HTTP ${response.status} reçue en ${durationMs} ms.`,
      durationMs,
      httpStatus: response.status,
    }, i18nT);
  }

  return makeCheck(id, {
    severity: response.status >= 500 ? "error" : "warn",
    statusText: response.status >= 500 ? i18nT("bloque_70f90b1a") : i18nT("a_verifier_8f5f7255"),
    detail: `Réponse HTTP ${response.status} reçue en ${durationMs} ms.`,
    durationMs,
    httpStatus: response.status,
  }, i18nT);
}

function checkFromError(id: string, error: unknown, i18nT: Translator): DiagnosticCheck {
  return makeCheck(id, {
    severity: "error",
    statusText: i18nT("bloque_inaccessible_7ad36249"),
    detail: getErrorMessage(error, i18nT),
  }, i18nT);
}

function storageCheck(kind: "localStorage" | "sessionStorage", i18nT: Translator): DiagnosticCheck {
  const id = kind === "localStorage" ? "local-storage" : "session-storage";
  const key = `inrcy_diag_${Date.now()}`;

  try {
    const storage = kind === "localStorage" ? window.localStorage : window.sessionStorage;
    storage.setItem(key, "ok");
    const value = storage.getItem(key);
    storage.removeItem(key);

    if (value === "ok") {
      return makeCheck(id, {
        severity: "ok",
        statusText: "OK",
        detail: `${kind} fonctionne correctement.`,
      }, i18nT);
    }

    return makeCheck(id, {
      severity: "warn",
      statusText: i18nT("a_verifier_8f5f7255"),
      detail: `${kind} a répondu, mais la valeur relue est inattendue.`,
    }, i18nT);
  } catch (error) {
    return makeCheck(id, {
      severity: "error",
      statusText: i18nT("bloque_70f90b1a"),
      detail: getErrorMessage(error, i18nT),
    }, i18nT);
  }
}

function cookieCheck(i18nT: Translator): DiagnosticCheck {
  const name = `inrcy_diag_${Date.now()}`;

  try {
    document.cookie = `${name}=ok; path=/; max-age=60; SameSite=Lax`;
    const found = document.cookie.split(";").some((part) => part.trim() === `${name}=ok`);
    document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;

    if (found) {
      return makeCheck("cookies", {
        severity: "ok",
        statusText: "OK",
        detail: "Les cookies du domaine iNrCy peuvent être écrits et relus.",
      }, i18nT);
    }

    return makeCheck("cookies", {
      severity: "error",
      statusText: i18nT("bloque_70f90b1a"),
      detail: i18nT("une_verification_n_a_pas_pu_f122debc"),
    }, i18nT);
  } catch (error) {
    return makeCheck("cookies", {
      severity: "error",
      statusText: i18nT("bloque_70f90b1a"),
      detail: getErrorMessage(error, i18nT),
    }, i18nT);
  }
}

export default function DiagnosticClient() {
  const i18nT = useTranslations("public");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "direct";
  const reason = searchParams.get("reason") || "manual";
  const auto = searchParams.get("auto") === "1";

  const [checks, setChecks] = useState<DiagnosticCheck[]>(() => buildInitialChecks(i18nT));
  const [running, setRunning] = useState(false);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendMessage, setSendMessage] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const autoSendStartedRef = useRef(false);

  const summary = useMemo(() => {
    const errors = checks.filter((check) => check.severity === "error").length;
    const warnings = checks.filter((check) => check.severity === "warn").length;
    const pending = checks.filter((check) => check.severity === "pending" || check.severity === "running").length;

    if (pending > 0 || running) return i18nT("diagnostic_en_cours_a29978be");
    if (errors > 0) return `${errors} point${errors > 1 ? "s" : ""} bloqué${errors > 1 ? "s" : ""}`;
    if (warnings > 0) return `${warnings} point${warnings > 1 ? "s" : ""} à vérifier`;
    return i18nT("tous_les_tests_principaux_sont_ok_2a8d0c6a");
  }, [checks, running, i18nT]);

  const report = useMemo(() => {
    const lines = [
      "Diagnostic connexion iNrCy",
      `Date navigateur : ${nowLabel(locale)}`,
      `Origine : ${from}`,
      `Raison : ${reason}`,
      `URL : ${typeof window !== "undefined" ? window.location.href : "-"}`,
      `Navigateur : ${typeof navigator !== "undefined" ? navigator.userAgent : "-"}`,
      `En ligne : ${typeof navigator !== "undefined" ? String(navigator.onLine) : "-"}`,
      `Résumé : ${summary}`,
      "",
      "--- Tests ---",
      ...checks.map((check) => {
        const duration = typeof check.durationMs === "number" ? ` · ${check.durationMs} ms` : "";
        const status = typeof check.httpStatus === "number" ? ` · HTTP ${check.httpStatus}` : "";
        return [
          `[${statusLabel(check.severity, i18nT)}] ${check.title}`,
          `Cible : ${check.target}`,
          `Statut : ${check.statusText}${status}${duration}`,
          check.detail ? `Détail : ${check.detail}` : null,
        ]
          .filter(Boolean)
          .join("\n");
      }),
    ];

    return lines.join("\n\n");
  }, [checks, from, reason, summary, locale, i18nT]);

  const runDiagnostic = useCallback(async () => {
    setRunning(true);
    setCopied(false);
    setSendState("idle");
    setSendMessage(null);
    autoSendStartedRef.current = false;
    setFinishedAt(null);
    setChecks(buildInitialChecks(i18nT).map((check) => ({ ...check, severity: "running", statusText: i18nT("test_en_cours_061a65d2") })));

    const next: DiagnosticCheck[] = [];

    next.push(
      makeCheck("browser", {
        severity: navigator.onLine ? "ok" : "warn",
        statusText: navigator.onLine ? "OK" : "Hors ligne déclaré",
        detail: `Navigateur : ${navigator.userAgent}. Langue : ${navigator.language}. En ligne : ${String(navigator.onLine)}.`,
      }, i18nT),
    );
    setChecks((previous) => previous.map((check) => (check.id === "browser" ? next[next.length - 1] : check)));

    const local = storageCheck("localStorage", i18nT);
    next.push(local);
    setChecks((previous) => previous.map((check) => (check.id === local.id ? local : check)));

    const session = storageCheck("sessionStorage", i18nT);
    next.push(session);
    setChecks((previous) => previous.map((check) => (check.id === session.id ? session : check)));

    const cookies = cookieCheck(i18nT);
    next.push(cookies);
    setChecks((previous) => previous.map((check) => (check.id === cookies.id ? cookies : check)));

    try {
      const { response, durationMs } = await fetchWithTimeout("/api/diagnostic/ping");
      const api = checkFromHttp("api-ping", response, durationMs, i18nT);
      next.push(api);
      setChecks((previous) => previous.map((check) => (check.id === api.id ? api : check)));
    } catch (error) {
      const api = checkFromError("api-ping", error, i18nT);
      next.push(api);
      setChecks((previous) => previous.map((check) => (check.id === api.id ? api : check)));
    }

    try {
      const { response, durationMs } = await fetchWithTimeout(`/logo-inrcy.png?t=${Date.now()}`);
      const asset = checkFromHttp("asset-logo", response, durationMs, i18nT);
      next.push(asset);
      setChecks((previous) => previous.map((check) => (check.id === asset.id ? asset : check)));
    } catch (error) {
      const asset = checkFromError("asset-logo", error, i18nT);
      next.push(asset);
      setChecks((previous) => previous.map((check) => (check.id === asset.id ? asset : check)));
    }

    setRunning(false);
    setFinishedAt(nowLabel(locale));
  }, [i18nT, locale]);

  const sendReport = useCallback(
    async (automatic = false) => {
      setSendState("sending");
      setSendMessage(automatic ? "Envoi automatique du rapport à iNrCy…" : "Envoi du rapport à iNrCy…");

      try {
        const response = await fetch("/api/diagnostic/send-report", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            report,
            summary,
            clientName,
            company,
            phone,
            message,
            url: window.location.href,
            userAgent: navigator.userAgent,
            source: from,
            reason,
            automatic,
          }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        setSendState("sent");
        setSendMessage(automatic ? "Rapport envoyé automatiquement à iNrCy." : "Rapport envoyé à iNrCy.");
      } catch (error) {
        setSendState("error");
        setSendMessage(i18nT("envoi_impossible_pour_le_moment_vous_0bedda6a", { value0: getErrorMessage(error, i18nT) }));
      }
    },
    [clientName, company, from, i18nT, message, phone, reason, report, summary],
  );

  const copyReport = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, [report]);

  useEffect(() => {
    void runDiagnostic();
  }, [runDiagnostic]);

  useEffect(() => {
    if (!auto || !finishedAt || running || autoSendStartedRef.current) return;
    autoSendStartedRef.current = true;
    void sendReport(true);
  }, [auto, finishedAt, running, sendReport]);

  const pageSubtitle = from === "login" ? "Diagnostic lancé depuis la page de connexion" : "Diagnostic technique iNrCy";

  return (
    <main className={styles.pageShell}>
      <div className={styles.orbOne} />
      <div className={styles.orbTwo} />
      <section className={styles.heroCard}>
        <div className={styles.topPill}>{i18nT("inrcy_assistance_connexion_6a1ab48a")}</div>
        <div className={styles.heroGrid}>
          <div>
            <h1>{i18nT("diagnostic_de_connexion_6c1c6a10")}</h1>
            <p>{i18nT("value_la_page_teste_uniquement_le_0f230004", { value0: pageSubtitle })}</p>
          </div>
          <div className={styles.summaryCard} data-severity={summary.includes("bloqué") ? "error" : summary.includes("vérifier") ? "warn" : "ok"}>
            <span>{i18nT("resume_9fb58963")}</span>
            <strong>{summary}</strong>
            {finishedAt ? <small>{i18nT("termine_a_value_0136e0ce", { value0: finishedAt })}</small> : <small>{i18nT("analyse_en_cours_46645652")}</small>}
          </div>
        </div>

        <div className={styles.actionsRow}>
          <button type="button" className={styles.primaryButton} onClick={() => void runDiagnostic()} disabled={running}>
            {running ? i18nT("diagnostic_en_cours_a29978be") : i18nT("relancer_le_diagnostic_b550f62c")}
          </button>
          <button type="button" className={styles.secondaryButton} onClick={copyReport}>
            {copied ? i18nT("rapport_copie_b957e410") : i18nT("copier_le_rapport_8620a0bd")}
          </button>
        </div>
      </section>

      <section className={styles.checkGrid}>
        {checks.map((check) => (
          <article key={check.id} className={styles.checkCard} data-severity={check.severity}>
            <div className={styles.checkHeader}>
              <div>
                <h2>{check.title}</h2>
                <p>{check.description}</p>
              </div>
              <span>{statusLabel(check.severity, i18nT)}</span>
            </div>
            <div className={styles.checkMeta}>{check.target}</div>
            {check.detail ? <div className={styles.checkDetail}>{check.detail}</div> : null}
          </article>
        ))}
      </section>

      <section className={styles.sendCard}>
        <div>
          <div className={styles.sectionPill}>{i18nT("envoi_a_inrcy_a79cb8ba")}</div>
          <h2>{i18nT("le_bilan_est_transmis_a_contact_ffe5829f")}</h2>
          <p>
            {i18nT("depuis_la_page_de_connexion_l_5b2d8800")}{" "}</p>
        </div>

        <div className={styles.formGrid}>
          <input value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder={i18nT("nom_du_client_8626bd1c")} />
          <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder={i18nT("societe_2c3fdad8")} />
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={i18nT("telephone_d3b023ea")} />
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={i18nT("message_rapide_ou_contexte_du_blocage_0f195f4e")} rows={3} />
        </div>

        <div className={styles.actionsRow}>
          <button type="button" className={styles.primaryButton} onClick={() => void sendReport(false)} disabled={sendState === "sending" || running}>
            {sendState === "sending" ? i18nT("envoi_en_cours_2de80069") : i18nT("envoyer_a_inrcy_3188b6db")}
          </button>
          <a className={styles.backLink} href="/login">{i18nT("retour_connexion_a1ee2d62")}</a>
        </div>

        {sendMessage ? <div className={styles.sendStatus} data-state={sendState}>{sendMessage}</div> : null}
      </section>
    </main>
  );
}
