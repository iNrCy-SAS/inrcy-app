import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { useRouter, useSearchParams } from "next/navigation";
import stylesDash from "../../../dashboard.module.css";
import { getTemplates, type TemplateDef } from "@/lib/messageTemplates";
import { useBusinessTemplateContext } from "@/app/dashboard/_hooks/useBusinessTemplateContext";
import RichMailEditor from "@/app/dashboard/_components/RichMailEditor";
import AiContentReportButton from "@/app/dashboard/_components/AiContentReportButton";
import TemplateSubjectInlineEditor from "@/app/dashboard/_components/TemplateSubjectInlineEditor";
import { extractTemplatePlaceholders, textToRichMailHtml } from "@/lib/mailRichText";
import { confirmInrcy } from "@/lib/inrcyDialog";
import TemplateAttachmentPicker from "@/app/dashboard/_components/TemplateAttachmentPicker";
import TemplateAiEngineSelector from "@/app/dashboard/_components/TemplateAiEngineSelector";
import { useTemplateAiEngine } from "@/app/dashboard/_hooks/useTemplateAiEngine";
import type { ComposeAttachmentRef } from "@/app/dashboard/mails/_lib/mailboxPhase1";
import { storeWorkflowMailPrefillAttachments } from "@/app/dashboard/_lib/workflowMailPrefillAttachments";
import { readWorkflowCampaignState, saveWorkflowCampaignDraft, saveWorkflowCampaignState } from "@/app/dashboard/_lib/workflowCampaignState";

const WORKFLOW_KIND = "propulser" as const;
const WORKFLOW_ACTION = "reviews";
const WORKFLOW_FOLDER = "propulsions";
const WORKFLOW_TRACK_TYPE = "review_mail";
const WORKFLOW_ATTACHMENT_PREFIX = "propulser-recolter";

export default function RecolterModal({
  styles,
  onClose,
  onDone = onClose,
  saveDraftActionRef,
  onDraftStatusChange,
}: {
  styles: typeof stylesDash;
  onClose: () => void | Promise<void>;
  onDone?: () => void | Promise<void>;
  saveDraftActionRef?: MutableRefObject<(() => Promise<void>) | null>;
  onDraftStatusChange?: (message: string) => void;
}) {
  const i18nT = useTranslations("growth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const restoreKey = searchParams?.get("restore_key") || "";
  const restoredWorkflowKeyRef = useRef(restoreKey);
  const { sectorCategory, profession } = useBusinessTemplateContext();

  const templates = useMemo(() => getTemplates("avis", undefined, sectorCategory, profession), [sectorCategory, profession]);
  const categories = useMemo(() => {
    const map = new Map<string, TemplateDef>();
    for (const t of templates) {
      if (!map.has(t.category)) map.set(t.category, t);
    }
    return Array.from(map.values());
  }, [templates]);

  const [selectedKey, setSelectedKey] = useState<string>("");
  const selected = useMemo(
    () => templates.find((t) => t.key === selectedKey) ?? categories[0] ?? templates[0],
    [templates, categories, selectedKey]
  );

  const [subject, setSubject] = useState("");
  useEffect(() => {
    if (restoredWorkflowKeyRef.current) return;
    if (!categories.length) {
      setSelectedKey("");
      return;
    }
    setSelectedKey(categories[0]?.key ?? "");
  }, [categories]);

  const [body, setBody] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiContentGenerated, setAiContentGenerated] = useState(false);
  const { engine: aiEngine, setEngine: setAiEngine, defaultEngine: defaultAiEngine } = useTemplateAiEngine();
  const [attachments, setAttachments] = useState<ComposeAttachmentRef[]>([]);
  const [workflowDraftId, setWorkflowDraftId] = useState<string | null>(null);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!selected) return;
    if (restoredWorkflowKeyRef.current) return;
    setAiContentGenerated(false);
    const subj = selected.subject;
    const txt = selected.body;
    setSubject(subj);
    setBody(txt);
    setBodyHtml(textToRichMailHtml(txt));

    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/templates/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject_override: subj, body_override: txt }),
        });
        const j = await r.json().catch(() => ({}));
        if (cancelled || restoredWorkflowKeyRef.current) return;
        if (j?.subject) setSubject(String(j.subject));
        if (j?.body_text) {
          const renderedBody = String(j.body_text);
          setBody(renderedBody);
          setBodyHtml(textToRichMailHtml(renderedBody));
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.key]);



  useEffect(() => {
    if (!restoreKey) {
      restoredWorkflowKeyRef.current = "";
      return;
    }
    const restored = readWorkflowCampaignState(restoreKey);
    if (!restored || restored.kind !== WORKFLOW_KIND || restored.action !== WORKFLOW_ACTION) {
      restoredWorkflowKeyRef.current = "";
      return;
    }
    restoredWorkflowKeyRef.current = restoreKey;
    if (restored.templateKey) setSelectedKey(String(restored.templateKey));
    setSubject(restored.subject || "");
    setBody(restored.bodyText || "");
    setBodyHtml(restored.bodyHtml || textToRichMailHtml(restored.bodyText || ""));
    setAttachments(restored.attachments || []);
    setWorkflowDraftId(restored.draftId || null);
  }, [restoreKey]);

  const generateAiTemplateContent = async () => {
    if (!selected || aiGenerating) return;
    setAiError("");
    setAiGenerating(true);
    try {
      const r = await fetch("/api/templates/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module: "propulser",
          mission: "Récolter",
          template_key: selected.key,
          template_title: selected.title,
          template_category: selected.category,
          subject,
          body,
          attachments,
          engine: aiEngine,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j?.error || "La génération IA a échoué."));
      if (j?.subject) setSubject(String(j.subject));
      if (j?.body_text) {
        const nextBody = String(j.body_text);
        setBody(nextBody);
        setBodyHtml(textToRichMailHtml(nextBody));
      }
      if (j?.subject || j?.body_text) setAiContentGenerated(true);
    } catch (error) {
      setAiError(getClientUserFacingErrorMessage(error, "La génération IA a échoué."));
    } finally {
      setAiGenerating(false);
    }
  };

  const buildCurrentWorkflowState = useCallback((draftId: string | null = workflowDraftId) => ({
    kind: WORKFLOW_KIND,
    action: WORKFLOW_ACTION,
    folder: WORKFLOW_FOLDER,
    trackKind: WORKFLOW_KIND,
    trackType: WORKFLOW_TRACK_TYPE,
    templateKey: selected?.key || selectedKey || null,
    templateCategory: selected?.category || null,
    subject,
    bodyText: body,
    bodyHtml: bodyHtml || textToRichMailHtml(body),
    attachments,
    draftId,
  }), [attachments, body, bodyHtml, selected?.category, selected?.key, selectedKey, subject, workflowDraftId]);

  const saveCurrentWorkflowDraft = useCallback(async () => {
    try {
      const state = buildCurrentWorkflowState();
      const result = await saveWorkflowCampaignDraft({
        draftId: state.draftId || null,
        kind: state.kind,
        folder: state.folder,
        trackType: state.trackType,
        templateKey: state.templateKey,
        subject: state.subject,
        bodyText: state.bodyText,
        bodyHtml: state.bodyHtml,
        attachments: state.attachments,
      });
      const nextDraftId = result.draftId || state.draftId || null;
      setWorkflowDraftId(nextDraftId);
      saveWorkflowCampaignState(buildCurrentWorkflowState(nextDraftId), restoreKey || undefined);
      onDraftStatusChange?.("Brouillon enregistré ✅");
    } catch (error) {
      onDraftStatusChange?.(getClientUserFacingErrorMessage(error, "Impossible d’enregistrer le brouillon."));
    }
  }, [buildCurrentWorkflowState, onDraftStatusChange, restoreKey]);

  useEffect(() => {
    if (!saveDraftActionRef) return;
    saveDraftActionRef.current = saveCurrentWorkflowDraft;
    return () => {
      if (saveDraftActionRef.current === saveCurrentWorkflowDraft) saveDraftActionRef.current = null;
    };
  }, [saveDraftActionRef, saveCurrentWorkflowDraft]);

  const onNext = async () => {
    const placeholders = extractTemplatePlaceholders(`${subject}\n${body}`);
    if (placeholders.length > 0) {
      const preview = placeholders.slice(0, 6).join(", ");
      const more = placeholders.length > 6 ? ` et ${placeholders.length - 6} autre(s)` : "";
      const shouldContinue = await confirmInrcy({
        title: i18nT("elements_a_completer_c23b6061"),
        message: i18nT("votre_message_contient_encore_des_elements_a77d88bf", { value0: preview, value1: more }),
        confirmLabel: i18nT("continuer_quand_meme_3b026c8d"),
        cancelLabel: i18nT("corriger_le_message_6d7e26a8"),
        variant: "warning",
      });
      if (!shouldContinue) return;
    }
    const q = new URLSearchParams();
    q.set("folder", "propulsions");
    if (selected?.key) q.set("template_key", selected.key);
    q.set("prefill_subject", subject);
    q.set("prefill_text", body);
    q.set("prefill_html", bodyHtml || textToRichMailHtml(body));
    if (attachments.length > 0) {
      const attachmentStorageKey = storeWorkflowMailPrefillAttachments(attachments, WORKFLOW_ATTACHMENT_PREFIX);
      if (attachmentStorageKey) q.set("prefill_attachments_key", attachmentStorageKey);
      else q.set("prefill_attachments", JSON.stringify(attachments));
    }
    q.set("compose", "1");
    q.set("finalizer", "propulser");
    const workflowReturnKey = saveWorkflowCampaignState(buildCurrentWorkflowState(), restoreKey || undefined);
    q.set("workflow_kind", WORKFLOW_KIND);
    q.set("workflow_action", WORKFLOW_ACTION);
    q.set("workflow_return_key", workflowReturnKey);

    q.set("track_kind", "propulser");
    q.set("track_type", "review_mail");
    q.set(
      "track_payload",
      JSON.stringify({
        template_key: selected?.key ?? null,
        template_category: selected?.category ?? null,
      })
    );

    router.push(`/dashboard/mails?${q.toString()}`);
    void onDone();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0 }}>
      <div className={styles.blockCard} style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, maxWidth: "100%", boxSizing: "border-box", height: "100%" }}>
        <div className={styles.blockTitle} style={{ marginBottom: 10, fontSize: 20, display: isMobile ? "none" : "block", flex: "0 0 auto" }}>
          {i18nT("modele_d_email_recolter_9b0d8657")}{" "}</div>

        <div className={styles.subtitle} style={{ marginBottom: isMobile ? 0 : 10, display: isMobile ? "none" : "block" }}>
          {i18nT("choisissez_un_email_preconcu_modifiez_si_6736bfa1")}{" "}</div>

        <div style={{ marginBottom: isMobile ? 8 : 12 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 1fr) 280px auto",
              alignItems: "end",
              gap: 10,
              minWidth: 0,
            }}
          >
            <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", color: "rgba(255,255,255,0.64)", textTransform: "uppercase" }}>
                {i18nT("modele_dedie_c1a52e79")}{" "}</div>
              <select
              value={selectedKey}
              onChange={(e) => { restoredWorkflowKeyRef.current = ""; setSelectedKey(e.target.value); }}
              aria-label={i18nT("choisir_un_modele_426a410c")}
              style={{
                width: "100%",
                minHeight: 46,
                minWidth: 0,
                borderRadius: 16,
                padding: "14px 16px",
                background: "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.06) 100%)",
                color: "#ffffff",
                border: "1px solid rgba(255,255,255,0.16)",
                outline: "none",
                fontSize: 15,
                fontWeight: 700,
                boxShadow: "0 14px 28px rgba(0,0,0,0.18)",
                boxSizing: "border-box",
                display: "block",
              }}
            >
              {categories.map((tpl, index) => (
                <option key={tpl.category} value={tpl.key} style={{ color: "#111111" }}>
                  {index + 1}. {tpl.title}
                </option>
              ))}
            </select>
            </div>

            <TemplateAiEngineSelector
              value={aiEngine}
              defaultValue={defaultAiEngine}
              onChange={setAiEngine}
              disabled={aiGenerating}
              isMobile={isMobile}
            />

            <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
              <div aria-hidden="true" style={{ height: 14, display: isMobile ? "none" : "block" }} />
              <button
                type="button"
                className={`${styles.secondaryBtn} ${styles.aiGenerateBtn}`}
                onClick={generateAiTemplateContent}
                disabled={aiGenerating || !selected}
                style={{ minHeight: 46, height: 46, padding: "10px 16px", fontWeight: 900, borderRadius: 999, opacity: aiGenerating ? 0.7 : 1, whiteSpace: "nowrap", width: "100%" }}
              >
                {aiGenerating ? i18nT("generation_ce4e3498") : i18nT("generer_avec_inrcy_58900495")}
              </button>
            </div>
          </div>
          {aiError ? <div style={{ marginTop: 8, width: "100%", color: "#fecaca", fontSize: 13, fontWeight: 700 }}>{aiError}</div> : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0, overflow: "hidden" }}>
          <div style={isMobile ? mobileSubjectSectionStyle : sectionStyle}>
            {isMobile ? (
              <TemplateSubjectInlineEditor value={subject} onChange={setSubject} />
            ) : (
              <>
                <div style={sectionHeaderStyle}>{i18nT("objet_3de621c5")}</div>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={i18nT("objet_3de621c5")}
                  className={styles.input}
                  style={{ width: "100%", fontSize: 16, boxSizing: "border-box", display: "block", maxWidth: "100%" }}
                />
              </>
            )}
          </div>

          <div style={{ ...sectionStyle, ...messageSectionStyle }}>
            <RichMailEditor
              text={body}
              html={bodyHtml}
              onChange={({ text, html }) => {
                setBody(text);
                setBodyHtml(html);
              }}
              placeholder={i18nT("votre_message_ffe7b099")}
              toolbarTitle={<span style={{ ...sectionHeaderStyle, marginBottom: 0 }}>{i18nT("message_68f4145f")}</span>}
              compactToolbar
              mobileFullscreen={isMobile}
              minHeight={0}
              className={styles.textarea}
              editorStyle={{
                ...messageTextareaStyle,
                minHeight: 0,
                height: "100%",
                maxHeight: "100%",
              }}
            />
            {aiContentGenerated ? (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                <AiContentReportButton surface="propulser:recolter" content={`${subject}\n${body}`} />
              </div>
            ) : null}
          </div>

          <div style={{ ...footerStyle, ...(isMobile ? { alignItems: "stretch", flexDirection: "column" as const } : {}) }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5, minWidth: 0 }}>
              <TemplateAttachmentPicker
              styles={styles}
              attachments={attachments}
              setAttachments={setAttachments}
              isMobile={isMobile}
              inputIdPrefix="recolter-template-attachments"
              variant="footer"
              />
              <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 12, fontWeight: 650, lineHeight: 1.25 }}>
                {i18nT("le_media_est_pris_en_compte_4bf16f58")}{" "}</div>
            </div>
            <div style={{ ...footerActionsStyle, ...(isMobile ? { width: "100%", marginLeft: 0 } : {}) }}>
              <button type="button" onClick={() => void onClose()} className={styles.secondaryBtn}>
                {i18nT("annuler_49ba3292")}{" "}</button>
              <button type="button" onClick={onNext} className={styles.primaryBtn}>
                {i18nT("suivant_596d29a7")}{" "}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const sectionStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "linear-gradient(180deg, rgba(56,189,248,0.06) 0%, rgba(167,139,250,0.04) 60%, rgba(255,255,255,0.03) 100%)",
  borderRadius: 18,
  padding: 12,
};

const mobileSubjectSectionStyle: CSSProperties = {
  ...sectionStyle,
  padding: "10px 12px",
};


const sectionHeaderStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "0.02em",
  color: "rgba(255,255,255,0.78)",
  marginBottom: 8,
};


const messageSectionStyle: CSSProperties = {
  ...sectionStyle,
  flex: "1 1 0",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const messageTextareaStyle: CSSProperties = {
  width: "100%",
  flex: "1 1 auto",
  minHeight: "clamp(180px, 30vh, 260px)",
  height: "100%",
  maxHeight: "100%",
  resize: "none",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  overscrollBehavior: "contain",
  scrollbarGutter: "stable",
  fontSize: 16,
  boxSizing: "border-box",
  display: "block",
};

const aiHintStyle: CSSProperties = {
  color: "rgba(255,255,255,0.58)",
  fontSize: 11,
  fontWeight: 750,
  lineHeight: 1.25,
  maxWidth: 220,
};

const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  flexWrap: "nowrap",
  marginTop: "auto",
  paddingTop: 8,
  paddingBottom: "max(2px, env(safe-area-inset-bottom))",
  position: "sticky",
  bottom: 0,
  zIndex: 1,
  background: "transparent",
};

const footerActionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 10,
  marginLeft: "auto",
};
