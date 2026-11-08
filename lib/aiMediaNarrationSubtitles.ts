/** Local captions follow the measured voice duration; timings are proportional,
 * not a claim of word-level speech alignment. No words are rewritten.
 * Optional start offset must already be established by the caller, in rendered
 * seconds. This module neither detects speech nor changes any audio. */
export type AiMediaNarrationSubtitleCue = { startSeconds: number; endSeconds: number; text: string };

export function buildAiMediaNarrationSubtitleCues(script: string, durationSeconds: number, startOffsetSeconds = 0): AiMediaNarrationSubtitleCue[] {
  if (!script.trim() || script.length > 4_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(script) ||
      !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 30 ||
      !Number.isFinite(startOffsetSeconds) || startOffsetSeconds < 0 || startOffsetSeconds >= durationSeconds) {
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
  // The end stays fixed at the measured track end; the offset never extends captions.
  const captionWindowSeconds = durationSeconds - startOffsetSeconds;
  let elapsed = 0;
  return phrases.map((text, index) => {
    const startSeconds = startOffsetSeconds + elapsed / total * captionWindowSeconds;
    elapsed += weights[index];
    return { startSeconds, endSeconds: index === phrases.length - 1 ? durationSeconds : startOffsetSeconds + elapsed / total * captionWindowSeconds, text: text.trim() };
  });
}

function timestamp(seconds: number) {
  const centiseconds = Math.round(seconds * 100);
  return `${Math.floor(centiseconds / 360_000)}:${String(Math.floor(centiseconds / 6_000) % 60).padStart(2, "0")}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
}

export function buildAiMediaNarrationSubtitlesAss(args: { script: string; durationSeconds: number; width: number; height: number; startOffsetSeconds?: number }) {
  const cues = buildAiMediaNarrationSubtitleCues(args.script, args.durationSeconds, args.startOffsetSeconds);
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


/** Conservative energy onset only, not speech recognition or word alignment.
 * PCM is a bounded local mono16kHz signed16-bit analysis copy; audio is untouched.
 * Ambiguous earlier activity, a weak/absent onset, or a late onset keeps zero. */
export function estimateAiMediaNarrationSubtitleStartSeconds(pcm: Buffer): number {
  const samplesPerWindow = 320; // 20ms at16kHz.
  if (!Buffer.isBuffer(pcm) || pcm.length % 2 || pcm.length < 16_000 || pcm.length > 96_000) return 0;
  const windows = Math.floor(pcm.length / (2 * samplesPerWindow));
  const levels: number[] = [];
  for (let window = 0; window < windows; window += 1) {
    let sumSquares = 0;
    for (let sample = 0; sample < samplesPerWindow; sample += 1) {
      const value = pcm.readInt16LE((window * samplesPerWindow + sample) * 2) / 32_768;
      sumSquares += value * value;
    }
    const rms = Math.sqrt(sumSquares / samplesPerWindow);
    levels.push(rms > 0 ? 20 * Math.log10(rms) : -Infinity);
  }
  // Require at least100ms of clearly stronger energy across the next200ms.
  // An isolated click never establishes an onset; earlier uncertain activity
  // prevents us from moving captions past a possibly quiet spoken beginning.
  for (let index = 0; index + 10 <= levels.length; index += 1) {
    if (levels[index] < -35 || levels.slice(index, index + 10).filter(level => level >= -35).length < 5) continue;
    const onsetSeconds = index * 0.02;
    if (onsetSeconds < 0.4 || onsetSeconds > 2.5) return 0;
    const quietPrefix = levels.slice(0, Math.max(0, index - 5));
    if (quietPrefix.length < 15 || quietPrefix.some(level => level > -48)) return 0;
    //100ms transition allowance above is fully protected by150ms padding.
    return Math.max(0, onsetSeconds - 0.15);
  }
  return 0;
}
