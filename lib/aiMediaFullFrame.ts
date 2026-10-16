export type AiMediaFrameCrop = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type Raster = {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
};

type Matte = "white" | "black";

function isMatte(data: Uint8Array, offset: number, matte: Matte) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return matte === "white"
    ? Math.min(red, green, blue) >= 240
    : Math.max(red, green, blue) <= 20;
}

/**
 * Recognize paired, neutral, flat bars with a sharp photographic boundary.
 * A white product background, a dark scene or ordinary composition space is
 * not a bar: at least 70% of the full inner edge must change abruptly.
 * Work on a small decoded sample, never on user uploads in the media library.
 */
export function detectAiMediaUniformBorderCrop(raster: Raster): AiMediaFrameCrop | null {
  const { data, width, height, channels } = raster;
  if (width < 32 || height < 32 || channels < 3 || data.length < width * height * channels) return null;
  const coverage = (axis: "x" | "y", coordinate: number, matte: Matte) => {
    const length = axis === "x" ? height : width;
    let matching = 0;
    for (let index = 0; index < length; index += 1) {
      const x = axis === "x" ? coordinate : index;
      const y = axis === "y" ? coordinate : index;
      if (isMatte(data, (y * width + x) * channels, matte)) matching += 1;
    }
    return matching / length;
  };
  const pairedBars = (axis: "x" | "y") => {
    const length = axis === "x" ? width : height;
    const maximum = Math.floor(length * 0.2);
    for (const matte of ["white", "black"] as const) {
      let start = 0;
      let end = 0;
      while (start <= maximum && coverage(axis, start, matte) >= 0.985) start += 1;
      while (end <= maximum && coverage(axis, length - end - 1, matte) >= 0.985) end += 1;
      if (start < 2 || end < 2 || start > maximum || end > maximum) continue;
      if (Math.abs(start - end) > Math.max(2, Math.max(start, end) * 0.12)) continue;
      // Looking a few sample pixels inside tolerates JPEG/scale ringing while
      // rejecting a gradual white studio backdrop or a subject on white.
      if (coverage(axis, start + 2, matte) > 0.3 || coverage(axis, length - end - 3, matte) > 0.3) continue;
      return [start, end] as const;
    }
    return [0, 0] as const;
  };
  const [left, right] = pairedBars("x");
  const [top, bottom] = pairedBars("y");
  if (!left && !top) return null;
  const crop = { left, top, width: width - left - right, height: height - top - bottom };
  // A detector must never turn a mostly blank graphic into a destructive zoom.
  return crop.width * crop.height >= width * height * 0.65 ? crop : null;
}

/** Map a sample crop conservatively to the oriented source pixels. */
export function scaleAiMediaFrameCrop(
  crop: AiMediaFrameCrop,
  sample: { width: number; height: number },
  source: { width: number; height: number },
): AiMediaFrameCrop {
  const left = Math.ceil(crop.left * source.width / sample.width);
  const top = Math.ceil(crop.top * source.height / sample.height);
  const right = Math.floor((crop.left + crop.width) * source.width / sample.width);
  const bottom = Math.floor((crop.top + crop.height) * source.height / sample.height);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** Moving scenes must agree across every sample before a fixed crop is used. */
export function agreeAiMediaFrameCrops(crops: readonly (AiMediaFrameCrop | null)[]): AiMediaFrameCrop | null {
  if (crops.length < 3 || crops.some(crop => !crop)) return null;
  const first = crops[0]!;
  if (crops.some(crop => Math.abs(crop!.left - first.left) > 1 || Math.abs(crop!.top - first.top) > 1 ||
    Math.abs(crop!.width - first.width) > 2 || Math.abs(crop!.height - first.height) > 2)) return null;
  const left = Math.max(...crops.map(crop => crop!.left));
  const top = Math.max(...crops.map(crop => crop!.top));
  const right = Math.min(...crops.map(crop => crop!.left + crop!.width));
  const bottom = Math.min(...crops.map(crop => crop!.top + crop!.height));
  return { left, top, width: right - left, height: bottom - top };
}
