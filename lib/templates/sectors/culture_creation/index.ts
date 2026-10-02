import { createJobTemplates } from '../shared';
import { culture_creationTemplates, cultureCreationJobTemplates } from './common';

export { culture_creationTemplates };

export function buildCultureCreationJobTemplates() {
  return cultureCreationJobTemplates.flatMap((definition) => createJobTemplates(definition));
}
