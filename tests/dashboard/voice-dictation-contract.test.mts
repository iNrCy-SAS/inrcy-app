import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function jsxElements(source: string, component: string) {
  return Array.from(
    source.matchAll(new RegExp(`<${component}\\b[\\s\\S]*?\\/>`, "g")),
    (match) => match[0],
  );
}

function elementWithValue(elements: string[], valueExpression: string) {
  const element = elements.find((candidate) =>
    candidate.includes(`value={${valueExpression}}`),
  );
  assert.ok(element, `un micro doit cibler ${valueExpression}`);
  return element;
}

const sharedVoiceButton = read(
  "app/dashboard/_components/MediaSubjectVoiceButton.tsx",
);
const mediaGenerator = read(
  "app/dashboard/_components/MediaGenerator.tsx",
);
const contentEditor = read(
  "app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx",
);
const publishIntentPanel = read(
  "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
);
const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
const publishFooter = read(
  "app/dashboard/booster/publier/components/PublishFooterActions.tsx",
);
const transcriptionRoute = read("app/api/booster/transcribe/route.ts");
const businessDnaPage = read("app/dashboard/adn-entreprise/page.tsx");
const aiMemoryContent = read(
  "app/dashboard/settings/_components/AiMemoryContent.tsx",
);
const aiConfigurationContent = read(
  "app/dashboard/settings/_components/AiConfigurationContent.tsx",
);
const businessDnaRichTextEditor = read(
  "app/dashboard/settings/_components/BusinessDnaRichTextEditor.tsx",
);
const businessScheduleEditor = read(
  "app/dashboard/settings/_components/BusinessScheduleEditor.tsx",
);
const editableTags = read(
  "app/dashboard/settings/_components/EditableTags.tsx",
);

test("la saisie vocale partagée centralise transcription et correction automatique", () => {
  assert.match(sharedVoiceButton, /fetch\("\/api\/booster\/transcribe"/);
  assert.match(sharedVoiceButton, /formData\.append\("text", liveTranscript\)/);
  assert.match(sharedVoiceButton, /formData\.append\(\s*"audio",/);
  assert.doesNotMatch(mediaGenerator, /fetch\("\/api\/booster\/transcribe"/);
  assert.doesNotMatch(contentEditor, /fetch\("\/api\/booster\/transcribe"/);

  assert.match(
    transcriptionRoute,
    /const correctedText = await correctTranscript\(liveText, preferredEngine, activeUserId\)/,
  );
  assert.match(
    transcriptionRoute,
    /const correctedText = await correctTranscript\(transcript, preferredEngine, activeUserId\)/,
  );
  assert.match(
    transcriptionRoute,
    /Corrige uniquement les fautes d'orthographe, la ponctuation, les accords et les majuscules/,
  );
  assert.match(transcriptionRoute, /Ne change pas le sens, n'invente rien/);
  assert.match(
    transcriptionRoute,
    /name: "booster_transcribe",[\s\S]{0,160}?limit: 40,[\s\S]{0,80}?window: "10 m"/,
  );
});

test("le composant partagé borne les champs et interdit deux sessions vocales concurrentes", () => {
  assert.match(sharedVoiceButton, /maxLength\?: number/);
  assert.match(
    sharedVoiceButton,
    /mergeMode\?: "paragraph" \| "space" \| "replace"/,
  );
  assert.match(
    sharedVoiceButton,
    /typeof maxLength !== "number"[\s\S]*?merged\.length <= maxLength/,
  );
  assert.match(sharedVoiceButton, /function clipVoiceTextAtBoundary/);
  assert.match(
    sharedVoiceButton,
    /const safeNext = clipVoiceTextAtBoundary\(cleanNext, available\)/,
  );
  assert.match(
    sharedVoiceButton,
    /if \(\/\\s\/\.test\(character\)\)[\s\S]*?return "";/,
  );
  assert.match(sharedVoiceButton, /type VoiceTextMerge = \{[\s\S]*?truncated: boolean/);
  assert.match(
    sharedVoiceButton,
    /setError\(merged\.truncated \? t\("voice_text_truncated"\) : ""\)/,
  );

  assert.match(sharedVoiceButton, /let activeVoiceSession: ActiveVoiceSession \| null = null/);
  assert.match(
    sharedVoiceButton,
    /const currentSessionIdRef = useRef<symbol \| null>\(null\)/,
  );
  assert.match(
    sharedVoiceButton,
    /const sessionId = Symbol\("inrcy-voice-dictation-session"\)/,
  );
  assert.match(
    sharedVoiceButton,
    /const ownsVoiceSession = \(sessionId: symbol \| null\) =>[\s\S]*?currentSessionIdRef\.current === sessionId[\s\S]*?activeVoiceSession\?\.id === sessionId/,
  );
  assert.match(
    sharedVoiceButton,
    /const finish = \(sessionId:[^)]*\) => \{\s*if \(!ownsVoiceSession\(sessionId\)\) return;/,
  );
  assert.match(
    sharedVoiceButton,
    /const cancelSession = \(sessionId:[^)]*\) => \{\s*if \(!ownsVoiceSession\(sessionId\)\) return;/,
  );
  assert.match(
    sharedVoiceButton,
    /const isCurrentVoiceSession = \(sessionId: symbol \| null\) =>\s*mountedRef\.current && ownsVoiceSession\(sessionId\)/,
  );
  assert.match(
    sharedVoiceButton,
    /const sessionId = claimVoiceSession\(\);\s*setVoiceState\("requesting"\)/,
  );
  assert.ok(
    (sharedVoiceButton.match(/if \(!isCurrentVoiceSession\(sessionId\)\) return;/g) || [])
      .length >= 8,
    "les reprises asynchrones et callbacks doivent vérifier le propriétaire de la session",
  );
  assert.ok(
    (
      sharedVoiceButton.match(
        /const payload = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\);\s*if \(!isCurrentVoiceSession\(sessionId\)\) return;/g,
      ) || []
    ).length >= 2,
    "chaque réponse réseau doit être ignorée si une autre dictée possède désormais la session",
  );
  assert.match(
    sharedVoiceButton,
    /disabled=\{disabled \|\| state === "requesting" \|\| state === "transcribing"\}/,
  );
  assert.match(sharedVoiceButton, /transcriptionAbortRef\.current\?\.abort\(\)/);
  assert.match(sharedVoiceButton, /recorder\.onstop = null/);
  assert.match(
    sharedVoiceButton,
    /const restoreLiveDraft = \(\) => \{[\s\S]*?hasLiveDraftRef\.current[\s\S]*?onChange\(baseTextRef\.current\)/,
  );
  assert.match(
    sharedVoiceButton,
    /const cancelSession =[\s\S]*?restoreLiveDraft\(\);\s*resetLiveDraft\(\);[\s\S]*?const claimVoiceSession/,
  );
  assert.match(
    sharedVoiceButton,
    /if \(recorder && recorder\.state !== "inactive"\) \{\s*setVoiceState\("transcribing"\);\s*recorder\.stop\(\);/,
  );
});

test("Configuration IA équipe ses exemples et ses consignes avec le micro corrigé partagé", () => {
  assert.match(
    aiConfigurationContent,
    /import MediaSubjectVoiceButton from "\.\.\/\.\.\/_components\/MediaSubjectVoiceButton"/,
  );

  const voiceButtons = jsxElements(aiConfigurationContent, "MediaSubjectVoiceButton");
  assert.equal(voiceButtons.length, 3);

  const expected = [
    { value: "form.likedExample", target: "likedExample", purpose: "content", maxLength: 1200 },
    { value: "form.likedExample2", target: "likedExample2", purpose: "content", maxLength: 1200 },
    { value: "form.forbiddenStyle", target: "forbiddenStyle", purpose: "instruction", maxLength: 700 },
  ] as const;

  for (const field of expected) {
    const button = elementWithValue(voiceButtons, field.value);
    assert.match(button, new RegExp(`disabled=\\{voiceDisabledFor\\("${field.target}"\\)\\}`));
    assert.match(
      button,
      new RegExp(`onBusyChange=\\{\\(busy\\) => handleVoiceBusyChange\\("${field.target}", busy\\)\\}`),
    );
    assert.match(button, new RegExp(`purpose="${field.purpose}"`));
    assert.match(button, /placement="inline"/);
    assert.match(button, /mergeMode="paragraph"/);
    assert.match(button, new RegExp(`maxLength=\\{${field.maxLength}\\}`));
  }

  assert.match(aiConfigurationContent, /const \[voiceTarget, setVoiceTarget\] = useState/);
  assert.match(aiConfigurationContent, /const voiceDisabledFor = \(target: AiConfigurationVoiceTarget\)/);
  assert.match(aiConfigurationContent, /readOnly=\{voiceBusy\}/);
  assert.match(aiConfigurationContent, /disabled=\{saving \|\| voiceBusy \|\| !loadSucceededRef\.current\}/);
});

test("iNrADN équipe tous ses champs libres avec le micro corrigé partagé", () => {
  assert.match(
    aiMemoryContent,
    /import MediaSubjectVoiceButton from "\.\.\/\.\.\/_components\/MediaSubjectVoiceButton"/,
  );
  assert.match(
    businessDnaRichTextEditor,
    /import MediaSubjectVoiceButton from "\.\.\/\.\.\/_components\/MediaSubjectVoiceButton"/,
  );
  assert.match(
    businessScheduleEditor,
    /import MediaSubjectVoiceButton from "\.\.\/\.\.\/_components\/MediaSubjectVoiceButton"/,
  );

  const richVoiceButtons = jsxElements(
    businessDnaRichTextEditor,
    "MediaSubjectVoiceButton",
  );
  assert.equal(
    richVoiceButtons.length,
    1,
    "l'éditeur riche commun doit fournir le micro à la présentation et aux trois champs Premium enrichis",
  );
  const richVoiceButton = elementWithValue(richVoiceButtons, "value");
  assert.match(richVoiceButton, /disabled=\{disabled\}/);
  assert.match(richVoiceButton, /contextLabel=\{label \|\| placeholder\}/);
  assert.match(richVoiceButton, /onChange=\{applyVoiceChange\}/);
  assert.match(richVoiceButton, /onBusyChange=\{handleVoiceBusyChange\}/);
  assert.match(richVoiceButton, /purpose="content"/);
  assert.match(richVoiceButton, /placement="inline"/);
  assert.match(richVoiceButton, /mergeMode="paragraph"/);
  assert.match(richVoiceButton, /maxLength=\{maxLength\}/);

  assert.match(
    businessDnaRichTextEditor,
    /const applyVoiceChange = \(nextValue: string\) => \{[\s\S]*?sanitizeBusinessDnaRichHtml\([\s\S]*?businessDnaTextToHtml\(appendedText\)[\s\S]*?const synchronizedText = businessDnaHtmlToPlainText\(nextHtml\)\.slice\(0, maxLength\)[\s\S]*?onChange\(\{ text: synchronizedText, html: nextHtml \}\)/,
  );
  assert.match(
    businessDnaRichTextEditor,
    /const editorLocked = disabled \|\| voiceBusy/,
  );
  assert.match(
    businessDnaRichTextEditor,
    /if \(busy && !voiceActiveRef\.current\)[\s\S]*?voiceActiveRef\.current = busy/,
  );
  assert.match(
    businessDnaRichTextEditor,
    /contentEditable=\{!editorLocked\}/,
  );

  const richEditors = jsxElements(aiMemoryContent, "BusinessDnaRichTextEditor");
  assert.equal(
    richEditors.length,
    2,
    "la présentation directe et le renderer Premium doivent rester branchés sur l'éditeur riche commun",
  );
  const detailedDescription = elementWithValue(
    richEditors,
    "businessKnowledge.description",
  );
  assert.match(detailedDescription, /maxLength=\{5000\}/);
  assert.match(
    detailedDescription,
    /disabled=\{voiceDisabledFor\("detailedDescription"\)\}/,
  );
  assert.match(
    detailedDescription,
    /onVoiceBusyChange=\{\(busy\) => handleVoiceBusyChange\("detailedDescription", busy\)\}/,
  );
  assert.match(detailedDescription, /onChange=\{setRichDescription\}/);

  const premiumRenderer = elementWithValue(richEditors, "value");
  assert.match(premiumRenderer, /disabled=\{disabled\}/);
  assert.match(premiumRenderer, /maxLength=\{5000\}/);
  assert.match(
    premiumRenderer,
    /onVoiceBusyChange=\{onVoiceBusyChange\}/,
  );

  const premiumFields = [
    "offersAndArguments",
    "proofsAndObjections",
    "editorialStrategy",
  ] as const;
  const premiumTextareas = jsxElements(aiMemoryContent, "PremiumTextarea");
  assert.equal(premiumTextareas.length, premiumFields.length);
  for (const field of premiumFields) {
    const textarea = elementWithValue(premiumTextareas, `memory.${field}`);
    assert.match(textarea, new RegExp(`html=\\{memory\\.richText\\.${field}\\}`));
    assert.match(
      textarea,
      new RegExp(
        `disabled=\\{!premiumEnabled \\|\\| voiceDisabledFor\\("${field}"\\)\\}`,
      ),
    );
    assert.match(
      textarea,
      new RegExp(
        `onVoiceBusyChange=\\{\\(busy\\) => handleVoiceBusyChange\\("${field}", busy\\)\\}`,
      ),
    );
    assert.match(
      textarea,
      new RegExp(`setPremiumRichField\\("${field}", next\\)`),
    );
  }

  const plainTextareas = jsxElements(aiMemoryContent, "MemoryVoiceTextarea");
  assert.equal(
    plainTextareas.length,
    4,
    "le renderer vocal commun doit servir les actualités et les trois nouveaux leviers Premium",
  );
  for (const field of ["keyArguments", "objectionResponses", "campaignCalendar"] as const) {
    const textarea = elementWithValue(plainTextareas, `memory.${field}`);
    assert.match(
      textarea,
      new RegExp(
        `disabled=\{!premiumEnabled \|\| voiceDisabledFor\("${field}"\)\}`,
      ),
    );
    assert.match(textarea, /maxLength=\{3000\}/);
  }
  const newsTextarea = elementWithValue(
    plainTextareas,
    'memory.recentNewsItems[index] || ""',
  );
  assert.match(newsTextarea, /label=\{t\("newsItemLabel", \{ number: index \+ 1 \}\)\}/);
  assert.match(newsTextarea, /maxLength=\{2000\}/);

  const aiMemoryVoiceButtons = jsxElements(
    aiMemoryContent,
    "MediaSubjectVoiceButton",
  );
  assert.equal(
    aiMemoryVoiceButtons.length,
    2,
    "la mission et le renderer des zones de texte utilisent directement le micro partagé",
  );
  const missionButton = elementWithValue(aiMemoryVoiceButtons, "memory.mission");
  assert.match(missionButton, /disabled=\{voiceDisabledFor\("mission"\)\}/);
  assert.match(missionButton, /contextLabel=\{t\("missionLabel"\)\}/);
  assert.match(missionButton, /purpose="content"/);
  assert.match(missionButton, /placement="inline"/);
  assert.match(missionButton, /mergeMode="paragraph"/);
  assert.match(missionButton, /maxLength=\{800\}/);
  assert.match(
    missionButton,
    /onChange=\{\(next\) => setField\("mission", next\.slice\(0, 800\)\)\}/,
  );
  assert.match(
    missionButton,
    /onBusyChange=\{\(busy\) => handleVoiceBusyChange\("mission", busy\)\}/,
  );
  const reusableTextButton = elementWithValue(aiMemoryVoiceButtons, "value");
  assert.match(reusableTextButton, /contextLabel=\{label\}/);
  assert.match(reusableTextButton, /purpose="content"/);
  assert.match(reusableTextButton, /placement="inline"/);
  assert.match(reusableTextButton, /mergeMode="paragraph"/);
  assert.match(reusableTextButton, /maxLength=\{maxLength\}/);
  const missionTextarea = elementWithValue(
    jsxElements(aiMemoryContent, "textarea"),
    "memory.mission",
  );
  assert.match(missionTextarea, /maxLength=\{800\}/);
  assert.match(
    missionTextarea,
    /readOnly=\{voiceOperationsLocked \|\| voiceBusy\}/,
  );

  const scheduleVoiceButtons = jsxElements(
    businessScheduleEditor,
    "MediaSubjectVoiceButton",
  );
  assert.equal(scheduleVoiceButtons.length, 1);
  const scheduleNotesButton = elementWithValue(
    scheduleVoiceButtons,
    "schedule.notes",
  );
  assert.match(scheduleNotesButton, /disabled=\{disabled\}/);
  assert.match(scheduleNotesButton, /contextLabel=\{t\("scheduleNotes"\)\}/);
  assert.match(scheduleNotesButton, /purpose="content"/);
  assert.match(scheduleNotesButton, /placement="inline"/);
  assert.match(scheduleNotesButton, /mergeMode="paragraph"/);
  assert.match(scheduleNotesButton, /maxLength=\{500\}/);
  assert.match(
    scheduleNotesButton,
    /onChange=\{\(notes\) => emit\(\{ \.\.\.cloneSchedule\(schedule\), notes \}\)\}/,
  );
  assert.match(
    scheduleNotesButton,
    /setVoiceBusy\(busy\);[\s\S]*?onVoiceBusyChange\?\.\(busy\)/,
  );
  const scheduleNotesTextarea = elementWithValue(
    jsxElements(businessScheduleEditor, "textarea"),
    "schedule.notes",
  );
  assert.match(scheduleNotesTextarea, /maxLength=\{500\}/);
  assert.match(scheduleNotesTextarea, /readOnly=\{controlsLocked\}/);
});

test("iNrADN verrouille la page pendant la dictée et délègue toute capture au composant partagé", () => {
  for (const source of [
    aiMemoryContent,
    businessDnaRichTextEditor,
    businessScheduleEditor,
  ]) {
    assert.doesNotMatch(source, /\bMediaRecorder\b/);
    assert.doesNotMatch(source, /\bgetUserMedia\b/);
    assert.doesNotMatch(source, /fetch\([\s\S]*?\/api\/booster\/transcribe/);
  }

  for (const target of [
    "detailedDescription",
    "mission",
    "scheduleNotes",
    "offersAndArguments",
    "keyArguments",
    "proofsAndObjections",
    "objectionResponses",
    "editorialStrategy",
    "campaignCalendar",
    "recentNewsItem0",
    "recentNewsItem1",
    "recentNewsItem2",
    "recentNewsItem3",
  ]) {
    assert.match(aiMemoryContent, new RegExp(`\\| "${target}"|= "${target}"`));
  }
  assert.match(aiMemoryContent, /const voiceBusy = voiceTarget !== null/);
  assert.match(
    aiMemoryContent,
    /const voiceDisabledFor = \(target: VoiceTarget\) =>\s*voiceOperationsLocked \|\| \(voiceTarget !== null && voiceTarget !== target\)/,
  );
  assert.match(
    aiMemoryContent,
    /const handleVoiceBusyChange = \(target: VoiceTarget, busy: boolean\) => \{[\s\S]*?voiceTargetRef\.current = next;[\s\S]*?setVoiceTarget\(next\);[\s\S]*?onVoiceBusyChange\?\.\(next !== null\)/,
  );
  assert.match(aiMemoryContent, /if \(voiceTargetRef\.current\) return;/);
  assert.match(aiMemoryContent, /disabled=\{voiceBusy\}/);
  assert.match(editableTags, /disabled\?: boolean/);
  assert.match(editableTags, /const commit = \(\) => \{\s*if \(disabled\) return;/);
  assert.ok(
    (aiMemoryContent.match(/disabled=\{voiceBusy\}/g) || []).length >= 5,
    "les onglets et les listes structurées doivent être verrouillés pendant la dictée",
  );
  assert.ok(
    (aiMemoryContent.match(/disabled=\{saving \|\| voiceBusy/g) || []).length >= 3,
    "réinitialiser, annuler et enregistrer doivent être verrouillés pendant la dictée",
  );

  assert.match(
    businessDnaPage,
    /const \[voiceBusy, setVoiceBusy\] = useState\(false\)/,
  );
  assert.match(
    businessDnaPage,
    /shouldBlock: hasUnsavedChanges \|\| voiceBusy/,
  );
  assert.match(
    businessDnaPage,
    /data-disable-pull-refresh=\{voiceBusy \? "true" : undefined\}/,
  );
  assert.equal(
    (businessDnaPage.match(/disabled: voiceBusy/g) || []).length,
    3,
    "les trois raccourcis du header iNrADN doivent être verrouillés",
  );
  assert.match(
    businessDnaPage,
    /onVoiceBusyChange=\{setVoiceBusy\}/,
  );
});

test("iNr Studio propose le même micro corrigé au sujet et à la consigne", () => {
  const voiceButtons = jsxElements(mediaGenerator, "MediaSubjectVoiceButton");
  assert.equal(voiceButtons.length, 2);

  const subjectButton = elementWithValue(voiceButtons, "customIdea");
  assert.match(subjectButton, /maxLength=\{1_600\}/);
  assert.match(subjectButton, /onBusyChange=\{setVoiceBusy\}/);

  const instructionButton = elementWithValue(voiceButtons, "aiInstruction");
  assert.match(instructionButton, /purpose="instruction"/);
  assert.match(instructionButton, /maxLength=\{600\}/);
  assert.match(instructionButton, /onBusyChange=\{setVoiceBusy\}/);

  assert.match(
    mediaGenerator,
    /const operationLocked = busy \|\| finishing \|\| voiceBusy \|\| inspirationBusy/,
  );
  assert.ok(
    (mediaGenerator.match(/maxLength=\{600\}/g) || []).length >= 2,
    "la textarea et son micro doivent partager la limite de la consigne",
  );
});

test("Booster Générer expose exactement deux champs vocaux via le composant partagé", () => {
  assert.match(
    publishIntentPanel,
    /import MediaSubjectVoiceButton from "\.\.\/\.\.\/\.\.\/_components\/MediaSubjectVoiceButton"/,
  );
  assert.match(publishIntentPanel, /type VoiceTarget = "idea" \| "instruction"/);

  const sharedButtonRenderers = jsxElements(
    publishIntentPanel,
    "MediaSubjectVoiceButton",
  );
  assert.equal(
    sharedButtonRenderers.length,
    1,
    "le renderer commun doit produire le micro de chacun des deux champs",
  );
  assert.match(
    sharedButtonRenderers[0],
    /purpose=\{args\.target === "idea" \? "subject" : "instruction"\}/,
  );
  assert.equal(
    (publishIntentPanel.match(/target: "idea"/g) || []).length,
    1,
  );
  assert.equal(
    (publishIntentPanel.match(/target: "instruction"/g) || []).length,
    2,
    "les deux branches responsive représentent un seul champ consigne à l'écran",
  );
  assert.match(
    publishIntentPanel,
    /\{isMobile \? \([\s\S]*?target: "instruction"[\s\S]*?\) : \([\s\S]*?target: "instruction"/,
  );

  assert.doesNotMatch(publishIntentPanel, /\bMediaRecorder\b/);
  assert.doesNotMatch(publishIntentPanel, /\bgetUserMedia\b/);
  assert.doesNotMatch(publishIntentPanel, /fetch\([\s\S]*?\/api\/booster\/transcribe/);
});

test("Booster manuel équipe les champs longs sans dupliquer le micro sur le CTA", () => {
  assert.match(
    contentEditor,
    /import MediaSubjectVoiceButton from "@\/app\/dashboard\/_components\/MediaSubjectVoiceButton"/,
  );
  const voiceButtons = jsxElements(contentEditor, "MediaSubjectVoiceButton");
  assert.equal(voiceButtons.length, 3);

  const titleButton = elementWithValue(voiceButtons, "activePost.title");
  assert.match(titleButton, /purpose="title"/);
  assert.match(titleButton, /placement="inline"/);
  assert.match(titleButton, /mergeMode="space"/);
  assert.match(titleButton, /maxLength=\{titleVoiceMaxLength\}/);
  assert.match(titleButton, /handleVoiceBusyChange\(activeCard, "title", busy\)/);
  assert.match(
    titleButton,
    /updatePost\(activeCard, \{ title \}, \{ sanitize: false \}\)/,
  );

  const contentButton = elementWithValue(voiceButtons, "activePost.content");
  assert.match(contentButton, /purpose="content"/);
  assert.match(contentButton, /placement="inline"/);
  assert.match(contentButton, /mergeMode="paragraph"/);
  assert.match(contentButton, /maxLength=\{contentVoiceMaxLength\}/);
  assert.match(contentButton, /handleVoiceBusyChange\(activeCard, "content", busy\)/);
  assert.match(contentButton, /isSiteDisplayKey\(activeCard\)/);

  assert.doesNotMatch(contentEditor, /manual-voice:[^\n]*:cta/);
  assert.doesNotMatch(contentEditor, /purpose="cta"/);
  assert.doesNotMatch(contentEditor, /ctaVoice(?:Control|MaxLength)/);

  const hashtagsButton = elementWithValue(
    voiceButtons,
    "instagramHashtagsInput",
  );
  assert.match(hashtagsButton, /purpose="hashtags"/);
  assert.match(hashtagsButton, /placement="inline"/);
  assert.match(hashtagsButton, /mergeMode="space"/);
  assert.match(hashtagsButton, /INSTAGRAM_HASHTAGS_INPUT_MAX_LENGTH/);
  assert.match(hashtagsButton, /setInstagramHashtagsInput\(nextInput\)/);
  assert.match(
    hashtagsButton,
    /hashtags: parseInstagramHashtagsInput\(nextInput\)/,
  );

  assert.match(
    contentEditor,
    /const INSTAGRAM_HASHTAGS_INPUT_MAX_LENGTH = 20 \* \(40 \+ 2\)/,
  );
  assert.match(
    contentEditor,
    /activeTextGuidelines\.content \+ contentFormattingLength/,
  );
});

test("Booster verrouille le canal et les actions tant qu'un champ vocal est actif", () => {
  assert.match(
    contentEditor,
    /useState<ManualVoiceTarget \| null>\(null\)/,
  );
  assert.match(contentEditor, /const voiceBusy = activeVoiceTarget !== null/);
  assert.match(
    contentEditor,
    /activeVoiceTarget\.channel !== channel \|\| activeVoiceTarget\.field !== field/,
  );
  assert.match(contentEditor, /disabled=\{voiceBusy\}/);
  assert.ok(
    (contentEditor.match(/readOnly=\{voiceBusy\}/g) || []).length >= 4,
    "les champs éditables doivent être figés pendant la dictée",
  );
  assert.match(contentEditor, /onVoiceBusyChange\?\.\(voiceBusy\)/);
  assert.match(contentEditor, /onVoiceBusyChange\?\.\(false\)/);

  assert.match(publishModal, /const \[contentVoiceBusy, setContentVoiceBusy\] = useState\(false\)/);
  assert.match(publishModal, /const \[intentVoiceBusy, setIntentVoiceBusy\] = useState\(false\)/);
  assert.match(
    publishModal,
    /const voiceInputBusy = contentVoiceBusy \|\| intentVoiceBusy/,
  );
  assert.match(
    publishModal,
    /onVoiceBusyChange=\{setContentVoiceBusy\}/,
  );
  assert.match(
    publishModal,
    /onVoiceBusyChange=\{setIntentVoiceBusy\}/,
  );
  assert.match(publishModal, /voiceBusy=\{voiceInputBusy\}/);
  assert.ok(
    (publishModal.match(/saving \|\| draftSaving \|\| scheduleSaving \|\| voiceInputBusy/g) || [])
      .length >= 2,
    "publier et planifier doivent refuser une transcription en cours",
  );
  assert.match(publishFooter, /voiceBusy\?: boolean/);
  assert.match(publishFooter, /disabled=\{draftSaving \|\| voiceBusy\}/);
});

test("les libellés des nouveaux usages vocaux existent dans toutes les langues", () => {
  for (const purpose of ["title", "content", "cta", "hashtags"] as const) {
    assert.match(
      sharedVoiceButton,
      new RegExp(`purpose === "${purpose}"[\\s\\S]*?voice_${purpose}_title`),
    );
  }

  for (const locale of [
    "fr-FR",
    "en-GB",
    "es-ES",
    "it-IT",
    "de-DE",
    "nl-NL",
    "pt-PT",
    "th-TH",
    "zh-CN",
  ]) {
    const messages = JSON.parse(read(`messages/${locale}/booster.json`)) as Record<
      string,
      unknown
    >;
    for (const key of [
      "voice_title_title",
      "voice_content_title",
      "voice_cta_title",
      "voice_hashtags_title",
      "voice_text_truncated",
    ]) {
      assert.equal(typeof messages[key], "string", `${locale}: ${key}`);
      assert.ok(String(messages[key]).trim(), `${locale}: ${key} ne doit pas être vide`);
    }
  }
  assert.match(sharedVoiceButton, /t\("voice_text_truncated"\)/);
});
