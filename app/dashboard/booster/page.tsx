import { redirect } from "next/navigation";

type BoosterRedirectPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BoosterRedirectPage({ searchParams }: BoosterRedirectPageProps) {
  const resolved: Record<string, string | string[] | undefined> = searchParams
    ? await searchParams
    : {};
  const params = new URLSearchParams();

  const action = firstParam(resolved.action);
  const draftId = firstParam(resolved.draftId);
  const stats = firstParam(resolved.stats);

  if (action === "publish") params.set("action", "publish");
  if (draftId) params.set("draftId", draftId);
  if (stats === "1") params.set("stats", "1");

  const query = params.toString();
  redirect(query ? `/dashboard?${query}` : "/dashboard");
}
