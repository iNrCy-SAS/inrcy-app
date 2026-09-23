import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const client = read("app/dashboard/agent/AgentClient.tsx");
const styles = read("app/dashboard/agent/agent.module.css");

test("AgentClient délègue modification et retouche image à iNrStudio", () => {
  const imageStart = client.indexOf("async function openPublishImageInStudio(");
  const imageEnd = client.indexOf("function getCurrentVideoSettings()", imageStart);
  assert.ok(imageStart >= 0 && imageEnd > imageStart);
  const imageHandoff = client.slice(imageStart, imageEnd);

  assert.match(client, /from "@\/lib\/inrStudioNavigation"/);
  assert.match(
    client,
    /import \{ useInrStudioSession \} from "\.\.\/_hooks\/useInrStudioSession"/,
  );
  assert.match(
    client,
    /openPublishImageInStudio\(tab: "modify" \| "retouch"\)/
  );
  assert.match(
    client,
    /createInrStudioHandoff\(\{[\s\S]*?tab,[\s\S]*?origin: "inr-agent"/
  );
  assert.match(client, /source: \{[\s\S]*?url: publishMediaPreview\.url/);
  assert.match(
    client,
    /context: \{[\s\S]*?actionId:[\s\S]*?channel:[\s\S]*?mediaIndex:/
  );
  assert.match(imageHandoff, /channel: activePreviewChannel/);
  assert.doesNotMatch(imageHandoff, /channel: publishBoosterChannel/);
  assert.match(imageHandoff, /mediaType: "image"/);
  assert.match(
    client,
    /const \{ openStudio, studio, completeReturn \} = useInrStudioSession\(\{/,
  );
  assert.match(
    client,
    /onReturned: \(result\) => \{[\s\S]*?applyInrStudioReturn\(result\)/,
  );
  assert.match(client, /consumeInrStudioReturn\(returnKey\)/);
  assert.match(
    client,
    /historicalStudioReturnHandledRef[\s\S]*?applyInrStudioReturn\(result\)/,
  );
  assert.match(
    client,
    /result\.action === "retouch" \|\| result\.action === "modify"/
  );
  assert.match(client, /result\.context\.mediaIndex/);
  assert.match(client, /savePublishMediaPatch\([\s\S]*?"replace"/);
  assert.match(client, /openPublishImageInStudio\("modify"\)/);
  assert.match(client, /openPublishImageInStudio\("retouch"\)/);
  assert.match(client, /className=\{styles\.publishMediaModifyButton\}/);
  assert.match(client, /className=\{styles\.publishMediaRetouchButton\}/);
  assert.match(
    styles,
    /\.publishMediaImageActions[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/
  );
  assert.match(
    styles,
    /\.publishMediaModifyButton[\s\S]*?rgba\(124, 58, 237, 0\.92\)[\s\S]*?rgba\(219, 39, 119, 0\.9\)/
  );
  assert.match(
    styles,
    /\.publishMediaRetouchButton[\s\S]*?rgba\(5, 150, 105, 0\.92\)[\s\S]*?rgba\(13, 148, 136, 0\.9\)/
  );
  assert.match(imageHandoff, /openStudio\(href\)/);
  assert.doesNotMatch(imageHandoff, /router\.push\(href\)/);
  assert.match(client, /\{studio\}/);
  assert.doesNotMatch(client, /ChannelImageAdapterModal/);
  assert.doesNotMatch(client, /from "\.\/_lib\/agent\.media-adapter"/);
  assert.equal(
    existsSync(
      resolve(ROOT, "app/dashboard/agent/_lib/agent.media-adapter.ts")
    ),
    false
  );
});

test("AgentClient délègue la retouche vidéo à iNrStudio sans adaptateur local", () => {
  const start = client.indexOf("async function openPublishVideoInStudio()");
  const end = client.indexOf(
    "function openPublishMediaRetouchPreview()",
    start
  );
  assert.ok(start >= 0 && end > start);
  const videoHandoff = client.slice(start, end);

  assert.match(videoHandoff, /createInrStudioHandoff\(\{/);
  assert.match(videoHandoff, /openStudio\(href\)/);
  assert.doesNotMatch(videoHandoff, /router\.push\(href\)/);
  assert.match(videoHandoff, /tab: "retouch"/);
  assert.match(videoHandoff, /mediaType: "video"/);
  assert.match(videoHandoff, /videoChannel: publishBoosterChannel/);
  assert.match(videoHandoff, /videoFormat: settings\.format/);
  assert.match(videoHandoff, /videoAdaptationMode: settings\.adaptationMode/);
  assert.match(videoHandoff, /videoTransformedVariants: transformedVariants/);
  assert.match(videoHandoff, /videoMediaRecord/);
  assert.match(client, /styles\.publishMediaVideoRetouchButton/);
  assert.match(client, /onClick=\{openPublishMediaRetouchPreview\}/);
  assert.match(
    client,
    /function openPublishMediaRetouchPreview\(\)[\s\S]*?publishMediaPreview\.kind === "video"[\s\S]*?openPublishVideoInStudio\(\)/
  );
  assert.match(
    styles,
    /\.publishMediaVideoRetouchButton[\s\S]*?rgba\(244, 63, 94, 0\.94\)[\s\S]*?rgba\(249, 115, 22, 0\.94\)/,
  );
  assert.match(client, /returnedRecord\.studio_video_retouch === true/);
  assert.match(client, /returnedRecord\.source_media_record/);
  assert.match(client, /returnedRecord\.transformed_variants/);
  assert.match(client, /showNotice\(i18nT\("publish_video_updated"\)\)/);
  assert.doesNotMatch(client, /BoosterVideoFormatManager/);
  assert.doesNotMatch(client, /requestBoosterVideoTransforms/);
  assert.doesNotMatch(client, /publishVideoAdapterOpen/);
  assert.doesNotMatch(client, /savePublishVideoAdapter/);
  assert.doesNotMatch(styles, /publishVideoAdapterModal/);
});

test("iNrAgent accuse le retour iNrStudio seulement après l'application du média", () => {
  const start = client.indexOf("async function applyInrStudioReturn(");
  const end = client.indexOf("function openPublishMediaEditor()", start);
  assert.ok(start >= 0 && end > start);
  const returnHandler = client.slice(start, end);

  assert.match(returnHandler, /result: InrStudioReturnedMedia/);
  assert.match(returnHandler, /await savePublishMediaPatch\(videoMediaPatch/);
  assert.match(
    returnHandler,
    /await savePublishMediaPatch\([\s\S]*?mediaPatchFromLibraryItem/,
  );
  assert.match(returnHandler, /requireExactTarget: true/);
  assert.match(
    returnHandler,
    /actions\.find\(\(action\) => action\.id === returnedActionId\)/,
  );
  assert.match(
    returnHandler,
    /getPublishMediaRecord\([\s\S]*?returnedTargetAction[\s\S]*?returnedChannel/,
  );
  assert.doesNotMatch(returnHandler, /currentPublishMediaRecord/);
  assert.doesNotMatch(returnHandler, /await selectPublishMediaFromLibrary\(/);
  assert.match(
    returnHandler,
    /finally \{[\s\S]*?completeReturn\(\);[\s\S]*?\}\s*\}/,
  );
});

test("iNrAgent verrouille chaque retour Studio sur l'action et le canal du handoff", () => {
  const saveStart = client.indexOf("async function savePublishMediaPatch(");
  const saveEnd = client.indexOf("async function savePublishPlacement(", saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  const saveHandler = client.slice(saveStart, saveEnd);

  assert.match(client, /scheduledEdit: Boolean\(scheduledEditSession\)/);
  assert.match(saveHandler, /requireExactTarget\?: boolean/);
  assert.match(
    saveHandler,
    /options\.requireExactTarget && \(!explicitActionId \|\| !options\.channel\)/,
  );
  assert.match(
    saveHandler,
    /targetActionId !== scheduledEditSession\.action\.id/,
  );
  assert.match(saveHandler, /payload\.action\.id !== targetActionId/);
  assert.doesNotMatch(
    saveHandler,
    /if \(!selectedPreparedAction \|\| !activePreviewChannel\) return/,
  );
});
