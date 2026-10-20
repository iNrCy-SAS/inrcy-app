/** Split transport intervals without rewriting or losing any of the supplied text. */
export function splitAiMediaSpokenScript(script: string, durations: readonly number[]): string[] {
  if (!durations.length || durations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
    throw new Error("ai_video_spoken_script_segment_durations_invalid");
  }
  const segments = Array.from(new Intl.Segmenter(undefined, { granularity: "word" }).segment(script));
  const spoken = segments.filter((part) => part.isWordLike || /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(part.segment));
  const words = spoken.length ? spoken : segments.filter((part) => /\S/u.test(part.segment));
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
  let elapsed = 0;
  let previousWord = 0;
  let previousOffset = 0;
  return durations.map((duration, index) => {
    if (index === durations.length - 1) return script.slice(previousOffset);
    elapsed += duration;
    const remainingWords = words.length - previousWord;
    const remainingSegments = durations.length - index - 1;
    const minimum = previousWord + (remainingWords > 0 ? 1 : 0);
    const maximum = words.length - Math.min(remainingSegments, Math.max(0, remainingWords - 1));
    const nextWord = Math.min(maximum, Math.max(minimum, Math.round(words.length * elapsed / totalDuration)));
    const nextOffset = nextWord < words.length ? words[nextWord].index : script.length;
    const line = script.slice(previousOffset, nextOffset);
    previousWord = nextWord;
    previousOffset = nextOffset;
    return line;
  });
}
