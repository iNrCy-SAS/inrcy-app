import { Suspense } from "react";

import FinishEmailLinkClient from "@/app/auth/_components/FinishEmailLinkClient";

type Props = {
  params: Promise<{ language: string }>;
};

export default async function LocalizedFinishResetPage({ params }: Props) {
  const { language } = await params;

  return (
    <Suspense fallback={null}>
      <FinishEmailLinkClient mode="reset" initialLanguage={language} />
    </Suspense>
  );
}
