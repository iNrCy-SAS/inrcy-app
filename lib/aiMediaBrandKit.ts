import "server-only";

import sharp from "sharp";

import {
  extractLogoPathFromUrl,
  getProfileLogoVersion,
  LOGO_BUCKET,
} from "@/lib/profileLogo";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type JsonRecord = Record<string, unknown>;

export type AiMediaBrandKit = {
  /** PNG sûr pour l'IA et les habillages, issu uniquement du logo du profil. */
  logo: Buffer | null;
  logoPath: string | null;
  logoVersion: string | null;
  colors: [string, string, string];
};

const FALLBACK_COLORS: [string, string, string] = [
  "#24b8ec",
  "#8b5cf6",
  "#f05a9d",
];
const MAX_ASSET_BYTES = 24 * 1024 * 1024;

function clean(value: unknown, max = 800) {
  return String(value ?? "").trim().slice(0, max);
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function toHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function colorDistance(a: [number, number, number], b: [number, number, number]) {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
  );
}

function saturation(color: [number, number, number]) {
  return Math.max(...color) - Math.min(...color);
}

async function extractPalette(buffer: Buffer): Promise<[string, string, string]> {
  try {
    const sample = await sharp(buffer, { failOn: "none", pages: 1 })
      .rotate()
      .resize(48, 48, { fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const bins = new Map<string, { count: number; sum: [number, number, number] }>();
    const channels = sample.info.channels;
    for (let index = 0; index < sample.data.length; index += channels) {
      const alpha = channels >= 4 ? sample.data[index + 3] : 255;
      if (alpha < 96) continue;
      const color: [number, number, number] = [
        sample.data[index],
        sample.data[index + 1],
        sample.data[index + 2],
      ];
      const brightness = (color[0] + color[1] + color[2]) / 3;
      if (brightness > 245 || brightness < 18) continue;
      const key = color.map((value) => Math.floor(value / 24)).join(":");
      const current = bins.get(key) || { count: 0, sum: [0, 0, 0] };
      current.count += 1;
      current.sum[0] += color[0];
      current.sum[1] += color[1];
      current.sum[2] += color[2];
      bins.set(key, current);
    }
    const ranked = [...bins.values()]
      .map((entry) => ({
        count: entry.count,
        color: entry.sum.map((sum) => sum / entry.count) as [number, number, number],
      }))
      .sort((a, b) =>
        b.count * (1 + saturation(b.color) / 180) -
        a.count * (1 + saturation(a.color) / 180),
      );
    const selected: Array<[number, number, number]> = [];
    for (const candidate of ranked) {
      if (selected.every((color) => colorDistance(color, candidate.color) > 58)) {
        selected.push(candidate.color);
      }
      if (selected.length === 3) break;
    }
    if (!selected.length) return FALLBACK_COLORS;
    while (selected.length < 3) {
      const base = selected[0];
      const factor = selected.length === 1 ? 0.72 : 1.2;
      selected.push(base.map((value) => Math.min(255, value * factor)) as [number, number, number]);
    }
    return selected.map((color) => toHex(...color)) as [string, string, string];
  } catch {
    return FALLBACK_COLORS;
  }
}

async function downloadStorageAsset(
  bucket: string,
  storagePath: string,
  logoVersion: string,
) {
  if (!bucket || !storagePath) return null;
  // Logos are intentionally replaceable. Supabase Smart CDN keys replaced
  // objects by path, so the profile version is also sent as cacheNonce and
  // the server fetch explicitly bypasses its own HTTP cache. This guarantees
  // that a generation started just after a profile save uses the new bytes.
  const signed = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(storagePath, 90);
  if (!signed.error && signed.data?.signedUrl) {
    try {
      const signedUrl = new URL(signed.data.signedUrl);
      signedUrl.searchParams.set(
        "cacheNonce",
        logoVersion || `fresh-${Date.now().toString(36)}`,
      );
      const response = await fetch(signedUrl, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (!response.ok || declaredSize > MAX_ASSET_BYTES) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.byteLength || buffer.byteLength > MAX_ASSET_BYTES) return null;
      return buffer;
    } catch {
      // The authenticated SDK read below remains a resilient fallback when a
      // serverless network layer refuses an otherwise valid signed URL.
    }
  }

  const result = await supabaseAdmin.storage.from(bucket).download(storagePath);
  if (result.error || !result.data || result.data.size > MAX_ASSET_BYTES) return null;
  const buffer = Buffer.from(await result.data.arrayBuffer());
  return buffer.byteLength ? buffer : null;
}

async function loadCurrentLogoProfile(
  accountId: string,
  fallbackProfile: JsonRecord | null,
) {
  try {
    const result = await supabaseAdmin
      .from("profiles")
      .select("logo_path,logo_url")
      .eq("user_id", accountId)
      .maybeSingle();
    if (!result.error) return asRecord(result.data);
  } catch {
    // The cached generation context keeps generation available during a
    // transient database read failure, but is never preferred over live data.
  }
  return fallbackProfile;
}

async function loadOwnedLogo(accountId: string, profile: JsonRecord | null) {
  const logoPath =
    extractLogoPathFromUrl(clean(profile?.logo_path)) ||
    extractLogoPathFromUrl(clean(profile?.logo_url));
  if (!logoPath || !logoPath.startsWith(`${accountId}/`)) {
    return { logo: null, logoPath: null, logoVersion: null };
  }
  const logoVersion = getProfileLogoVersion(clean(profile?.logo_url));
  const logo = await downloadStorageAsset(
    LOGO_BUCKET,
    logoPath,
    logoVersion,
  ).catch(() => null);
  if (!logo) return { logo: null, logoPath: null, logoVersion: null };
  try {
    const normalized = await sharp(logo, {
      failOn: "error",
      pages: 1,
      density: 240,
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize({
        width: 1_024,
        height: 1_024,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    return { logo: normalized, logoPath, logoVersion: logoVersion || null };
  } catch {
    return { logo: null, logoPath: null, logoVersion: null };
  }
}

export async function loadAiMediaBrandKit(args: {
  accountId: string;
  profile: JsonRecord | null;
}): Promise<AiMediaBrandKit> {
  const currentProfile = await loadCurrentLogoProfile(
    args.accountId,
    args.profile,
  );
  const ownedLogo = await loadOwnedLogo(args.accountId, currentProfile);
  const colors = ownedLogo.logo
    ? await extractPalette(ownedLogo.logo)
    : FALLBACK_COLORS;
  return {
    logo: ownedLogo.logo,
    logoPath: ownedLogo.logoPath,
    logoVersion: ownedLogo.logoVersion,
    colors,
  };
}
