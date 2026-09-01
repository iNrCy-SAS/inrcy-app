// Alias volontairement neutre : certaines extensions de confidentialité
// bloquent les URLs contenant "onboarding". L'ancien endpoint reste disponible
// pour compatibilité, mais le dashboard utilise désormais celui-ci.
export { GET, POST } from "../onboarding-state/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
