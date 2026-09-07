import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  new URL("../../app/dashboard/agent/agent.module.css", import.meta.url),
  "utf8",
);

test("le bandeau Publier garde des bulles et des logos uniformes à tous les zooms", () => {
  const railMarker =
    "/* iNrAgent Publier — rail de canaux uniforme et stable au zoom. */";
  const railStart = styles.indexOf(railMarker);
  assert.notEqual(railStart, -1);

  const railStyles = styles.slice(railStart);
  assert.match(
    railStyles,
    /\.previewMetaPublish \.channelScroller button \{[\s\S]*?box-sizing: border-box !important;[\s\S]*?overflow: hidden !important;[\s\S]*?border-radius: 50% !important;[\s\S]*?transform: none !important;/,
  );
  assert.match(
    railStyles,
    /button img \{[\s\S]*?position: absolute !important;[\s\S]*?inset: auto !important;[\s\S]*?top: 50% !important;[\s\S]*?left: 50% !important;[\s\S]*?object-fit: contain !important;[\s\S]*?clip-path: none !important;[\s\S]*?transform: translate\(-50%, -50%\) !important;/,
  );

  const desktopStyles = railStyles.slice(
    railStyles.indexOf("@media (min-width: 761px)"),
    railStyles.indexOf("@media (max-width: 760px)"),
  );
  assert.match(desktopStyles, /gap: 3px !important;/);
  assert.match(
    desktopStyles,
    /button \{[\s\S]*?width: 32px !important;[\s\S]*?height: 32px !important;[\s\S]*?flex: 0 0 32px !important;/,
  );
  assert.match(
    desktopStyles,
    /button img \{[\s\S]*?width: 24px !important;[\s\S]*?height: 24px !important;[\s\S]*?clip-path: none !important;/,
  );
  assert.match(desktopStyles, /button\[data-channel="gmb"\] img \{[\s\S]*?width: 24px !important;/);
  assert.match(desktopStyles, /button\[data-channel="linkedin"\][\s\S]*?width: 24px !important;/);

  const compactWideStyles = railStyles.slice(
    railStyles.indexOf("@media (min-width: 1251px) and (max-width: 1500px)"),
    railStyles.indexOf("@media (max-width: 760px)"),
  );
  assert.match(
    compactWideStyles,
    /button \{[\s\S]*?width: 30px !important;[\s\S]*?height: 30px !important;[\s\S]*?flex: 0 0 30px !important;/,
  );
  assert.match(
    compactWideStyles,
    /button img,[\s\S]*?img\.channelLogoLinkedin \{[\s\S]*?width: 22px !important;[\s\S]*?height: 22px !important;/,
  );

  const zoomedDesktopStyles = railStyles.slice(
    railStyles.indexOf("@media (min-width: 761px) and (max-width: 1000px)"),
    railStyles.indexOf("@media (max-width: 760px)"),
  );
  assert.match(
    zoomedDesktopStyles,
    /button \{[\s\S]*?width: 24px !important;[\s\S]*?height: 24px !important;[\s\S]*?flex: 0 0 24px !important;/,
  );
  assert.match(
    zoomedDesktopStyles,
    /button img,[\s\S]*?img\.channelLogoLinkedin \{[\s\S]*?width: 20px !important;[\s\S]*?height: 20px !important;/,
  );

  const mobileStyles = railStyles.slice(
    railStyles.indexOf("@media (max-width: 760px)"),
  );
  assert.match(mobileStyles, /gap: 4px !important;/);
  assert.match(
    mobileStyles,
    /button \{[\s\S]*?width: 28px !important;[\s\S]*?height: 28px !important;[\s\S]*?flex: 0 0 28px !important;/,
  );
  assert.match(
    mobileStyles,
    /button img \{[\s\S]*?width: 22px !important;[\s\S]*?height: 22px !important;[\s\S]*?clip-path: none !important;/,
  );

  assert.match(railStyles, /button\.channelPillActive \{[\s\S]*?transform: none !important;/);
  assert.doesNotMatch(railStyles, /scale\(/);
});
