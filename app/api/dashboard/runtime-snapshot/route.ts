// Point d'entrée neutre utilisé par le dashboard. Certaines extensions de
// confidentialité bloquent les chemins contenant `onboarding` ou `setup`.
// La logique reste centralisée dans la route historique pour éviter toute
// divergence entre les lectures et les écritures.
export { GET, POST } from "../onboarding-state/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
