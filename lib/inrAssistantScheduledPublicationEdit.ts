import { BOOSTER_PUBLICATION_CHANNELS } from "./boosterPublicationPolicy.ts";
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
export type ScheduledPublicationEdit = { channel: string; operation: "text" | "media" | "cta"; post: { title?: string | null; content?: string | null; hashtags?: string[] | null; cta?: string | null; ctaMode?: string | null; ctaUrl?: string | null; ctaPhone?: string | null; ctaAction?: string | null } | null; mediaId: string | null; mediaOperation: "add" | "replace" | "remove" | null; mediaIndex: number | null };
export function parseScheduledPublicationEdit(value: unknown): ScheduledPublicationEdit {
  const input = row(value), keys = ["channel", "operation", "post", "mediaId", "mediaOperation", "mediaIndex"];
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key)) || !BOOSTER_PUBLICATION_CHANNELS.includes(input.channel as never) || !["text", "media", "cta"].includes(String(input.operation))) throw new Error("Modification invalide");
  if (input.operation === "text") {
    const post = row(input.post);
    if (Object.keys(post).length !== 3 || ["title", "content", "hashtags"].some(key => !Object.hasOwn(post, key))
      || post.title !== null && (typeof post.title !== "string" || post.title.length > 300)
      || post.content !== null && (typeof post.content !== "string" || !post.content.trim() || post.content.length > 10000)
      || post.hashtags !== null && (!Array.isArray(post.hashtags) || post.hashtags.length > 40 || post.hashtags.some(item => typeof item !== "string" || item.length > 100))
      || Object.values(post).every(value => value === null) || input.mediaId !== null || input.mediaOperation !== null || input.mediaIndex !== null) throw new Error("Texte invalide");
  } else if (input.operation === "cta") {
    const post = row(input.post), fields = ["cta", "ctaMode", "ctaUrl", "ctaPhone", "ctaAction"];
    if (Object.keys(post).length !== fields.length || fields.some(key => !Object.hasOwn(post, key)) || Object.values(post).every(value => value === null)
      || fields.some(key => post[key] !== null && (typeof post[key] !== "string" || String(post[key]).length > (key === "ctaUrl" ? 2000 : key === "cta" ? 300 : 80)))
      || post.ctaMode !== null && !["none", "website", "call", "message", "custom"].includes(String(post.ctaMode))
      || post.ctaAction !== null && !["", "BOOK", "ORDER", "SHOP", "SIGN_UP"].includes(String(post.ctaAction))
      || input.mediaId !== null || input.mediaOperation !== null || input.mediaIndex !== null) throw new Error("Appel à l’action invalide");
  } else if (input.post !== null || !["add", "replace", "remove"].includes(String(input.mediaOperation))
    || !Number.isInteger(input.mediaIndex) || Number(input.mediaIndex) < 0 || Number(input.mediaIndex) > 4
    || (input.mediaOperation === "remove" ? input.mediaId !== null : typeof input.mediaId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.mediaId))) throw new Error("Média invalide");
  return input as ScheduledPublicationEdit;
}
const aliases: Record<string, string[]> = { site_web: ["site_web", "siteWeb"], inr_search: ["inr_search", "inrSearch"], youtube_shorts: ["youtube_shorts", "youtube"] };
function valueFor(value: unknown, channel: string) { const source = row(value); return (aliases[channel] || [channel]).map(key => source[key]).find(value => value !== undefined); }
export function scheduledPublicationChannelContent(value: unknown, channel: string) {
  const payload = row(value), publish = row(payload.publishPayload);
  const post = row(valueFor(publish.postByChannel, channel) ?? valueFor(payload.postByChannel, channel) ?? publish.post);
  const images = valueFor(publish.imagesByChannel ?? payload.imagesByChannel, channel);
  const video = valueFor(publish.videoByChannel ?? payload.videoByChannel, channel);
  const mode = valueFor(publish.mediaModeByChannel ?? payload.mediaModeByChannel, channel);
  return { post, images: Array.isArray(images) ? images : Array.isArray(publish.images) ? publish.images : [], video: video === null ? null : row(video ?? publish.video), mode: mode || (video || publish.video ? "video" : "images") };
}
const assetKey = (value: unknown) => { const asset = row(value); return String(asset.mediaId || asset.id || asset.storagePath || asset.storage_path || ""); };
export function scheduledPublicationEditResult(value: unknown, edit: ScheduledPublicationEdit) {
  const state = scheduledPublicationChannelContent(value, edit.channel);
  if (edit.operation === "cta") return Object.fromEntries(["cta", "ctaMode", "ctaUrl", "ctaPhone", "ctaAction"].map(key => [key, state.post[key] ?? ""]));
  return edit.operation === "text" ? { title: state.post.title ?? "", content: state.post.content ?? state.post.text ?? "", hashtags: state.post.hashtags ?? [] }
    : { images: state.images.map(assetKey), video: state.video ? assetKey(state.video) : "", mode: state.mode };
}
/** Builds only the selected native channel fields; all source/idempotency keys stay intact. */
export function buildScheduledPublicationEdit(value: unknown, edit: ScheduledPublicationEdit, asset?: Row) {
  const payload = row(value), publish = row(payload.publishPayload), state = scheduledPublicationChannelContent(value, edit.channel);
  const posts = { ...row(payload.postByChannel), ...row(publish.postByChannel) }, post = { ...state.post };
  if (edit.operation === "cta") {
    for (const [key, value] of Object.entries(edit.post!)) if (value !== null) post[key] = typeof value === "string" ? value.trim() : value;
    posts[edit.channel] = post;
    return { ...payload, postByChannel: posts, publishPayload: { ...publish, postByChannel: posts } };
  }
  if (edit.operation === "text") {
    if (edit.post!.title !== null) post.title = edit.post!.title;
    if (edit.post!.content !== null) { post.content = edit.post!.content; post.text = edit.post!.content; }
    if (edit.post!.hashtags !== null) post.hashtags = edit.post!.hashtags;
    posts[edit.channel] = post;
    return { ...payload, postByChannel: posts, publishPayload: { ...publish, postByChannel: posts } };
  }
  const imageMap = { ...row(payload.imagesByChannel), ...row(publish.imagesByChannel) }, videoMap = { ...row(payload.videoByChannel), ...row(publish.videoByChannel) }, modeMap = { ...row(payload.mediaModeByChannel), ...row(publish.mediaModeByChannel) };
  const images = state.mode === "video" || state.mode === "none" ? [] : [...state.images];
  let nextImages = images, nextVideo: unknown = state.mode === "video" ? state.video : null;
  const index = edit.mediaIndex!;
  if (edit.mediaOperation === "remove") {
    if (state.mode === "video") nextVideo = null;
    else { if (index >= images.length) throw new Error("Image introuvable"); nextImages = images.filter((_, i) => i !== index); }
  } else if (asset?.kind === "video") { nextImages = []; nextVideo = asset; }
  else if (asset?.kind === "image") {
    nextVideo = null;
    if (edit.mediaOperation === "add") { if (images.length >= 5) throw new Error("Maximum cinq images"); nextImages = [...images, asset]; }
    else { if (images.length && index >= images.length) throw new Error("Image introuvable"); nextImages = [...images]; nextImages[images.length ? index : 0] = asset; }
  } else throw new Error("Média non vérifié");
  const mode = nextVideo ? "video" : nextImages.length ? "images" : "none", primary = nextVideo || nextImages[0] || null;
  imageMap[edit.channel] = nextImages; videoMap[edit.channel] = nextVideo; modeMap[edit.channel] = mode;
  posts[edit.channel] = { ...post, media: primary, mediaAsset: primary, imageAsset: nextVideo ? null : primary, image: nextVideo ? null : primary,
    videoAsset: nextVideo, video: nextVideo, mediaMode: mode, imageUrl: nextVideo ? "" : String(row(primary).publicUrl || row(primary).url || "") };
  const maps = { postByChannel: posts, imagesByChannel: imageMap, videoByChannel: videoMap, mediaModeByChannel: modeMap };
  const videoSettings: Row = {};
  for (const field of ["videoSettingsByChannel", "videoFormatByChannel", "videoAdaptationModeByChannel"]) {
    const settings = { ...row(payload[field]), ...row(publish[field]) };
    for (const key of aliases[edit.channel] || [edit.channel]) delete settings[key];
    videoSettings[field] = settings;
  }
  return { ...payload, ...maps, ...videoSettings, publishPayload: { ...publish, ...maps, ...videoSettings } };
}
