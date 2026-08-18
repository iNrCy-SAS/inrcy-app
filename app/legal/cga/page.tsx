import { useTranslations } from "next-intl";
import LegalPageShell from "../_components/LegalPageShell";
import CgaContent from "../_components/CgaContent";

export const metadata = {
  title: "iNrCy",
};

export default function CgaPage() {
  const i18nT = useTranslations("public");
  return (
    <LegalPageShell
      title={i18nT("cga_conditions_generales_d_abonnement_et_e3dfe37c")}
      subtitle={i18nT("version_du_08_08_2026_1465b7bb")}
    >
      <CgaContent />
    </LegalPageShell>
  );
}
