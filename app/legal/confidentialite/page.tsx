import { useTranslations } from "next-intl";
import LegalPageShell from "../_components/LegalPageShell";
import ConfidentialiteContent from "../_components/ConfidentialiteContent";

export const metadata = {
  title: "iNrCy",
};

export default function ConfidentialitePage() {
  const i18nT = useTranslations("public");
  return (
    <LegalPageShell
      title={i18nT("politique_de_confidentialite_42b0e51e")}
      subtitle={i18nT("derniere_mise_a_jour_30_06_0c4ba073")}
    >
      {/* Le contenu complet est partagé avec l'app pour éviter les divergences. */}
      <ConfidentialiteContent />
    </LegalPageShell>
  );
}
