import "server-only";
import { prepareBoosterImagesByChannelOnServer, type BoosterServerImagePayload, type BoosterServerImagePreparationResult } from "@/lib/boosterImageServerPreparation";
import type { BoosterImageChannel } from "@/lib/boosterImageDecision";
import { readInrAgentPublicationSelection } from "@/lib/inrAgentPublicationPlacement";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};

/** Prepare the selected files separately; alternate formats are never a carousel. */
export async function prepareInrAgentPublicationImages(args: {
  accountId: string;
  channels: BoosterImageChannel[];
  payload: unknown;
  readImages: (channel: string, override?: unknown[]) => Promise<BoosterServerImagePayload[]>;
}): Promise<BoosterServerImagePreparationResult & { imagesByPlacement: Record<string, Record<string, BoosterServerImagePayload[]>> }> {
  const root = record(args.payload);
  const rawByPlacement = record(root.imagesByPlacement || record(root.publishPayload).imagesByPlacement);
  const output: BoosterServerImagePreparationResult & { imagesByPlacement: Record<string, Record<string, BoosterServerImagePayload[]>> } = {
    imagesByChannel: {}, imageSettingsByChannel: {}, imagesByPlacement: {}, warnings: [], failuresByChannel: {},
  };
  const attempts = await Promise.allSettled(args.channels.map(async (channel) => {
    const selection = channel === "facebook" || channel === "instagram" ? readInrAgentPublicationSelection(root, channel) : null;
    const primary = selection?.primaryPlacement || "classic";
    const prepare = async (placement: "classic" | "reel" | "story", override?: unknown[]) => prepareBoosterImagesByChannelOnServer({
      accountId: args.accountId, channels: [channel], images: await args.readImages(channel, override),
      automaticFit: "contain", preserveSourceComposition: true, placementsByChannel: { [channel]: placement },
    });
    const primaryImages = record(rawByPlacement[channel])[primary];
    const base = await prepare(primary, Array.isArray(primaryImages) ? primaryImages : undefined);
    Object.assign(output.imagesByChannel, base.imagesByChannel);
    Object.assign(output.imageSettingsByChannel, base.imageSettingsByChannel);
    Object.assign(output.failuresByChannel, base.failuresByChannel);
    output.warnings.push(...base.warnings);
    if (!selection) return;
    output.imagesByPlacement[channel] = { [primary]: base.imagesByChannel[channel] || [] };
    if (!selection.includeStory) return;
    const storyImages = record(rawByPlacement[channel]).story;
    if (!Array.isArray(storyImages) || !storyImages.length) {
      output.failuresByChannel[channel] = { code: "agent_image_format_requires_generation", retryable: false, imageKeys: [],
        error: "La version Story 9:16 n’est pas prête. Réactivez le format Story pour créer sa version verticale sans couper l’image classique." };
      return;
    }
    const story = await prepare("story", storyImages);
    output.imagesByPlacement[channel].story = story.imagesByChannel[channel] || [];
    Object.assign(output.failuresByChannel, story.failuresByChannel);
    output.warnings.push(...story.warnings);
  }));
  attempts.forEach((attempt, index) => {
    if (attempt.status !== "rejected") return;
    const channel = args.channels[index];
    delete output.imagesByChannel[channel];
    delete output.imageSettingsByChannel[channel];
    delete output.imagesByPlacement[channel];
    output.failuresByChannel[channel] = {
      code: "workspace_image_preparation_failed", retryable: true, imageKeys: [],
      error: "Les images de ce canal n’ont pas pu être préparées. Les autres canaux restent disponibles.",
    };
  });
  return output;
}
