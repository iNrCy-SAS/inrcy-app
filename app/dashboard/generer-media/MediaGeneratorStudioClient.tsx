"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import MediaGeneratorModal from "@/app/dashboard/_components/MediaGeneratorModal";

import styles from "./mediaGeneratorStudio.module.css";

export default function MediaGeneratorStudioClient() {
  const router = useRouter();

  const closeStudio = useCallback(() => {
    router.replace("/dashboard");
  }, [router]);

  const openGeneratedMediaLibrary = useCallback(() => {
    router.replace("/dashboard/mediatheque");
  }, [router]);

  return (
    <>
      <main className={styles.page} aria-hidden="true" />
      <MediaGeneratorModal
        open
        source="studio"
        origin="menu"
        acceptMode="library"
        onClose={closeStudio}
        onAccepted={openGeneratedMediaLibrary}
      />
    </>
  );
}
