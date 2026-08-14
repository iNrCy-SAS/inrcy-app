import SwitchAccountClient from './SwitchAccountClient';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function pickFirst(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function SwitchAccountPage({ searchParams }: PageProps) {
  const resolved: Record<string, string | string[] | undefined> = searchParams
    ? await searchParams
    : {};

  return (
    <SwitchAccountClient
      currentEmail={pickFirst(resolved.current_email)}
      expectedEmail={pickFirst(resolved.expected_email)}
      continuePath={pickFirst(resolved.continue)}
    />
  );
}
