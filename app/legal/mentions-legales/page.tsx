import { useTranslations } from "next-intl";
import LegalPageShell from "../_components/LegalPageShell";
import MentionsLegalesContent from "../_components/MentionsLegalesContent";

export const metadata = {
  title: "iNrCy",
};

export default function MentionsLegalesPage() {
  const i18nT = useTranslations("public");
  return (
    <LegalPageShell
      title={i18nT("mentions_legales_414291e0")}
      subtitle={i18nT("editeur_hebergement_responsabilite_propriete_intellectuelle_1bd1c693")}
    >
      <MentionsLegalesContent />
    </LegalPageShell>
  );
}
