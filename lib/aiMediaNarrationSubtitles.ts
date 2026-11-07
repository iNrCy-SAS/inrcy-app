/** Local captions follow the measured voice duration; timings are proportional,
 * not a claim of word-level speech alignment. No words are rewritten. */
export type AiMediaNarrationSubtitleCue = { startSeconds: number; endSeconds: number; text: string };

export function buildAiMediaNarrationSubtitleCues(script: string, durationSeconds: number): AiMediaNarrationSubtitleCue[] {
  if (!script.trim() || script.length > 4_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(script) ||
      !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 30) {
    throw new Error("ai_media_narration_subtitles_invalid");
  }
  const tokens = Array.from(new Intl.Segmenter(undefined, { granularity: "word" }).segment(script));
  const phrases: string[] = [];
  let phrase = "";
  for (const token of tokens) {
    // Unicode word segmentation also bounds captions in languages without spaces.
    if (phrase.trim() && Array.from(phrase + token.segment).length > 38) {
      phrases.push(phrase); phrase = "";
    }
    phrase += token.segment;
  }
  if (phrase.trim()) phrases.push(phrase);
  // Avoid a final isolated word flashing for only a few tenths of a second.
  // Keep original separators; libass wraps this slightly longer final cue.
  if (phrases.length > 1 && Array.from(phrases.at(-1)!.replace(/\s/gu, "")).length < 12) {
    const tail = phrases.pop()!;
    phrases[phrases.length - 1] += tail;
  }
  const weights = phrases.map(text => Math.max(1, Array.from(text.replace(/\s/gu, "")).length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let elapsed = 0;
  return phrases.map((text, index) => {
    const startSeconds = elapsed / total * durationSeconds;
    elapsed += weights[index];
    return { startSeconds, endSeconds: elapsed / total * durationSeconds, text: text.trim() };
  });
}

function timestamp(seconds: number) {
  const centiseconds = Math.round(seconds * 100);
  return `${Math.floor(centiseconds / 360_000)}:${String(Math.floor(centiseconds / 6_000) % 60).padStart(2, "0")}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
}

export function buildAiMediaNarrationSubtitlesAss(args: { script: string; durationSeconds: number; width: number; height: number }) {
  const cues = buildAiMediaNarrationSubtitleCues(args.script, args.durationSeconds);
  const fontSize = Math.max(18, Math.round(Math.min(args.width, args.height) * 0.052));
  // User text never becomes an ASS override or an FFmpeg filter expression.
  const escapeText = (text: string) => text.replace(/\\/gu, "\\\\").replace(/\{/gu, "\\{").replace(/\}/gu, "\\}").replace(/\r?\n/gu, " ");
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${args.width}`, `PlayResY: ${args.height}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]", "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Geist,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(1.5, fontSize * 0.055).toFixed(2)},1,2,${Math.round(args.width * 0.08)},${Math.round(args.width * 0.08)},${Math.round(args.height * 0.14)},1`, "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...cues.map(cue => `Dialogue: 0,${timestamp(cue.startSeconds)},${timestamp(cue.endSeconds)},Default,,0,0,0,,${escapeText(cue.text)}`), "",
  ].join("\n");
}
