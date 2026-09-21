import { redirect } from "next/navigation";

type ProfileWorkspaceRedirectPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProfileWorkspaceRedirectPage({
  searchParams,
}: ProfileWorkspaceRedirectPageProps) {
  const resolved = searchParams ? await searchParams : {};
  const tab = firstParam(resolved.section) === "activity" ? "activity" : "profile";
  redirect(`/dashboard/adn-entreprise?tab=${tab}`);
}
