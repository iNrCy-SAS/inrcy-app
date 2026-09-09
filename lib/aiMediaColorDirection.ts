/**
 * Scene generators need color direction, not a printable brand specification.
 * Keep exact hex values in the brand kit/compositor; never echo them here.
 */
function describeHexColor(value: string): string | null {
  const input = value.trim();
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(input)) return null;
  const hex = input.length === 4
    ? input.slice(1).split("").map((digit) => digit + digit).join("")
    : input.slice(1);
  const [red, green, blue] = [0, 2, 4].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const chroma = high - low;
  const lightness = (high + low) / 2;
  if (lightness >= 0.97) return "white";
  if (lightness <= 0.04) return "black";
  if (chroma < 0.07) {
    return lightness >= 0.7 ? "light gray" : lightness <= 0.3 ? "charcoal" : "gray";
  }
  const saturation = chroma / (1 - Math.abs(2 * lightness - 1));
  const sector = high === red
    ? (green - blue) / chroma
    : high === green
      ? (blue - red) / chroma + 2
      : (red - green) / chroma + 4;
  const hue = (sector * 60 + 360) % 360;
  const family = hue < 15 || hue >= 350 ? "red"
    : hue < 45 ? "orange"
    : hue < 65 ? "yellow"
    : hue < 90 ? "lime green"
    : hue < 155 ? "green"
    : hue < 180 ? "teal"
    : hue < 195 ? "cyan"
    : hue < 215 ? "sky blue"
    : hue < 255 ? "blue"
    : hue < 290 ? "violet"
    : hue < 320 ? "magenta"
    : "pink";
  const tone = lightness >= 0.8 ? "pale"
    : lightness >= 0.65 ? "light"
    : lightness <= 0.28 ? "deep"
    : lightness <= 0.4 ? "dark"
    : saturation < 0.35 ? "muted"
    : "vivid";
  return `${tone} ${family}`;
}

export function describeAiMediaBrandColors(
  colors: readonly string[],
  maxColors = 3,
): string[] {
  const limit = Number.isFinite(maxColors) ? Math.max(0, Math.floor(maxColors)) : 3;
  if (!limit) return [];
  const descriptions = new Set<string>();
  for (const color of colors) {
    const description = describeHexColor(color);
    if (description) descriptions.add(description);
    if (descriptions.size >= limit) break;
  }
  return [...descriptions];
}
