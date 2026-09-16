import { createInrBadgeIdentityColors, type InrBadgeThemeColors } from "@/lib/inrBadgeTheme";

type ColorBucket = {
  count: number;
  color: string;
  saturation: number;
  lightness: number;
};

function rgbToHex(r: number, g: number, b: number) {
  const channel = (value: number) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

function getSaturationAndLightness(r: number, g: number, b: number) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { saturation, lightness };
}

function rankLogoColors(data: Uint8ClampedArray) {
  const buckets = new Map<string, ColorBucket>();

  for (let index = 0; index < data.length; index += 16) {
    const alpha = data[index + 3];
    if (alpha < 120) continue;

    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const { saturation, lightness } = getSaturationAndLightness(r, g, b);
    if (lightness > 0.96) continue;

    const quantize = (value: number) => Math.min(255, Math.round(value / 24) * 24);
    const color = rgbToHex(quantize(r), quantize(g), quantize(b));
    const current = buckets.get(color);
    if (current) {
      current.count += 1;
    } else {
      buckets.set(color, { count: 1, color, saturation, lightness });
    }
  }

  return [...buckets.values()]
    .sort((left, right) => {
      const leftScore = left.count * (0.55 + left.saturation) * (left.lightness < 0.08 ? 0.45 : 1);
      const rightScore = right.count * (0.55 + right.saturation) * (right.lightness < 0.08 ? 0.45 : 1);
      return rightScore - leftScore;
    })
    .slice(0, 12)
    .map((bucket) => bucket.color);
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => reject(new Error("logo_timeout")), 10000);
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("logo_unreadable"));
    };
    image.src = url;
  });
}

export async function extractInrBadgeThemeColorsFromLogo(imageUrl: string): Promise<InrBadgeThemeColors> {
  const source = String(imageUrl || "").trim();
  if (!source) throw new Error("logo_missing");

  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = 72;
  canvas.height = 72;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas_unavailable");

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const candidates = rankLogoColors(pixels);
  if (!candidates.length) throw new Error("logo_colors_missing");
  return createInrBadgeIdentityColors(candidates);
}
