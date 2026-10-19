"use client";

import { useTranslations } from "next-intl";
import { AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES } from "@/lib/aiMediaCharacterVoices";
import MediaLibraryPickerModal from "./MediaLibraryPickerModal";

/** Use the Studio's full library selector without navigating away from the current character. */
export default function MediaCharacterVoiceLibraryPicker({ onClose, onSelect }: {
  onClose: () => void; onSelect: (id: string) => void;
}) {
  const t = useTranslations("media");
  return <MediaLibraryPickerModal
    open
    accept="audio"
    title={t("mediatheque_inrcy_a885e19e")}
    subtitle={t("ai_generator_character_voice_library_subtitle")}
    audioFilterLabel={t("ai_generator_character_voice_library_filter")}
    multiple={false}
    maxSelection={1}
    closeOnConfirm={false}
    confirmLabel={t("ai_generator_character_voice_library_confirm")}
    getItemDisabledReason={(item) => {
      const duration = Number(item.duration_seconds);
      const size = Number(item.size_bytes);
      return item.media_type !== "audio" || !Number.isFinite(duration) || duration < 1 || duration > 10 ||
        !Number.isSafeInteger(size) || size <= 0 || size > AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES
        ? t("ai_generator_character_voice_library_duration_error") : undefined;
    }}
    onClose={onClose}
    onConfirm={(items) => { if (items[0]) onSelect(items[0].id); }}
  />;
}
