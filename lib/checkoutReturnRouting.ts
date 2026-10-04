// This context only controls the waiting screen; it never grants subscription access.
export const CHECKOUT_RETURN_HEADER = "x-inrcy-checkout-return";

export function checkoutReturnQuery(params: Pick<URLSearchParams, "get">): string {
  if (params.get("checkout") !== "success") return "";
  const result = new URLSearchParams({ checkout: "success" });
  const cycle = params.get("billing");
  const plan = params.get("checkout_plan");
  if (cycle === "monthly" || cycle === "yearly") result.set("billing", cycle);
  if (plan === "Standard" || plan === "Premium") result.set("checkout_plan", plan);
  return result.toString();
}

export function blockedCheckoutReturnUrl(query: string): string {
  const safeQuery = checkoutReturnQuery(new URLSearchParams(query));
  return `/compte-bloque${safeQuery ? `?${safeQuery}` : ""}`;
}

export function dashboardCheckoutReturnUrl(query: string): string {
  const safeQuery = checkoutReturnQuery(new URLSearchParams(query));
  return safeQuery ? `/dashboard?panel=abonnement&${safeQuery}` : "/dashboard";
}
