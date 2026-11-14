import { formation_enseignementTemplates } from './common';
import { createJobTemplates } from '../shared';
import { auto_ecoleJobTemplates } from './auto_ecole';
import { moto_ecoleJobTemplates } from './moto_ecole';
import { bateau_ecoleJobTemplates } from './bateau_ecole';
import { formation_poids_lourd_transportJobTemplates } from './formation_poids_lourd_transport';
import { recuperation_pointsJobTemplates } from './recuperation_points';
import { formation_code_routeJobTemplates } from './formation_code_route';
import { formateurJobTemplates } from './formateur';

export { formation_enseignementTemplates };

export function buildFormationEnseignementJobTemplates() {
  return [
    auto_ecoleJobTemplates,
    moto_ecoleJobTemplates,
    bateau_ecoleJobTemplates,
    formation_poids_lourd_transportJobTemplates,
    recuperation_pointsJobTemplates,
    formation_code_routeJobTemplates,
    formateurJobTemplates,
  ].flatMap((definition) => createJobTemplates(definition));
}
