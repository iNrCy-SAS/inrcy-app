import type { ActivitySectorCategory } from '../activitySectors.ts';
import type { JobTemplateDefinition } from '../templates/sectors/shared.ts';

/** One reviewed profession drives its catalogue, aliases and message models. */
export type ActivityProfessionComplement = JobTemplateDefinition & {
  services: readonly string[];
  aliases: readonly string[];
};

export type ActivityAliasComplement = {
  sector: ActivitySectorCategory;
  professionKey: string;
  aliases: readonly string[];
};
