"use client";

import { useTranslations } from "next-intl";
import React, { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { type ComposeCrmRecipientHint } from "../_lib/mailboxPhase1";
import { normalizeEmails } from "../_lib/mailboxPhase25";
import {
  contactDepartment,
  sanitizeCrmDepartmentFilter,
} from "../_lib/mailboxComposeCampaign.foundations";

type Options = {
  composeOpen: boolean;
  to: string;
  setTo: React.Dispatch<React.SetStateAction<string>>;
  composeRecipientHints: ComposeCrmRecipientHint[];
};

/** Owns the lazy CRM picker and derives recipient selections without changing the compose draft. */
export function useMailboxCrmRecipients({
  composeOpen,
  to,
  setTo,
  composeRecipientHints,
}: Options) {
  const i18nT = useTranslations("mails");
  // CRM selection (compose)
  type CrmContact = {
    id: string;
    full_name: string | null;
    email: string | null;
    category: "particulier" | "professionnel" | "collectivite_publique" | null;
    contact_type:
      "client" | "prospect" | "fournisseur" | "partenaire" | "autre" | null;
    postal_code: string | null;
    city: string | null;
    important: boolean;
  };

  const [crmContacts, setCrmContacts] = useState<CrmContact[]>([]);

  const [crmLoading, setCrmLoading] = useState(false);

  const [crmFilter, setCrmFilter] = useState("");

  const [crmSearchOpen, setCrmSearchOpen] = useState(false);

  const crmSearchRef = useRef<HTMLInputElement | null>(null);

  const [crmError, setCrmError] = useState<string | null>(null);

  const [crmPickerOpen, setCrmPickerOpen] = useState(false);

  const [crmCategory, setCrmCategory] = useState<
    "all" | CrmContact["category"]
  >("all");

  const [crmContactType, setCrmContactType] = useState<
    "all" | CrmContact["contact_type"]
  >("all");

  const [crmDepartment, setCrmDepartment] = useState("");

  const [crmImportantOnly, setCrmImportantOnly] = useState(false);

  function toggleEmailInTo(email: string) {
    const list = normalizeEmails(to);
    const lower = email.toLowerCase();
    const exists = list.some((x) => x.toLowerCase() === lower);
    const next = exists
      ? list.filter((x) => x.toLowerCase() !== lower)
      : [...list, email];
    setTo(next.join(", "));
  }

  const filteredContacts = useMemo(() => {
    const q = crmFilter.trim().toLowerCase();
    const department = sanitizeCrmDepartmentFilter(crmDepartment);
    return crmContacts.filter((c) => {
      if (crmImportantOnly && !c.important) return false;
      if (crmCategory !== "all" && c.category !== crmCategory) return false;
      if (crmContactType !== "all" && c.contact_type !== crmContactType)
        return false;
      if (
        department &&
        !contactDepartment(c.postal_code).startsWith(department)
      )
        return false;
      if (!q) return true;
      const hay =
        `${c.full_name || ""} ${c.email || ""} ${c.postal_code || ""} ${c.city || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [
    crmContacts,
    crmFilter,
    crmImportantOnly,
    crmCategory,
    crmContactType,
    crmDepartment,
  ]);

  const selectedToSet = useMemo(() => {
    return new Set(normalizeEmails(to).map((e) => e.toLowerCase()));
  }, [to]);

  const selectedCrmCount = useMemo(() => {
    let n = 0;
    for (const c of crmContacts) {
      if (c.email && selectedToSet.has(String(c.email).toLowerCase())) n += 1;
    }
    return n;
  }, [crmContacts, selectedToSet]);

  const crmRecipientsByEmail = useMemo(() => {
    const map = new Map<string, ComposeCrmRecipientHint>();
    for (const contact of crmContacts) {
      const email = String(contact.email || "").trim();
      if (!email) continue;
      const lower = email.toLowerCase();
      if (map.has(lower)) continue;
      map.set(lower, {
        email,
        contact_id: contact.id,
        display_name: (contact.full_name || "").trim() || null,
      });
    }
    return map;
  }, [crmContacts]);

  const composeRecipientHintsByEmail = useMemo(() => {
    const map = new Map<string, ComposeCrmRecipientHint>();
    for (const hint of composeRecipientHints) {
      const email = String(hint.email || "").trim();
      if (!email) continue;
      map.set(email.toLowerCase(), {
        email,
        contact_id: hint.contact_id || null,
        display_name: hint.display_name || null,
      });
    }
    return map;
  }, [composeRecipientHints]);

  async function loadCrmContacts() {
    if (crmLoading) return;
    setCrmError(null);
    setCrmLoading(true);

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 12000);
    try {
      // We go through the API route so the same auth method is used as the CRM screens.
      const res = await fetch("/api/crm/contacts?all=1", {
        method: "GET",
        credentials: "include",
        signal: ac.signal,
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
      }

      const json = (await res.json().catch(() => ({}))) as any;
      const rows = Array.isArray(json?.contacts) ? json.contacts : [];
      const mapped = rows.map((c: any) => {
        const left = [c.first_name, c.last_name]
          .filter(Boolean)
          .join(" ")
          .trim();
        const company = (c.company_name || "").trim();
        const full =
          company && left ? `${company} — ${left}` : company || left || null;
        return {
          id: String(c.id),
          full_name: full,
          email: c.email || null,
          category: (c.category as any) ?? null,
          contact_type: (c.contact_type as any) ?? null,
          postal_code: c.postal_code || null,
          city: c.city || null,
          important: Boolean(c.important),
        };
      });
      setCrmContacts(mapped);
    } catch (e: any) {
      console.error("CRM load error", e);
      const msg =
        e?.name === "AbortError"
          ? i18nT("contacts_load_timeout")
          : i18nT("contacts_load_failed");
      setCrmError(msg);
    } finally {
      clearTimeout(timeout);
      setCrmLoading(false);
    }
  }

  // Opening compose is the load trigger; an empty result must not auto-retry.
  const onComposeOpened = useEffectEvent(() => {
    if (crmContacts.length > 0) return;
    void loadCrmContacts();
  });
  useEffect(() => {
    if (composeOpen) onComposeOpened();
  }, [composeOpen]);

  return {
    crmLoading,
    crmFilter,
    setCrmFilter,
    crmSearchOpen,
    setCrmSearchOpen,
    crmSearchRef,
    crmError,
    crmPickerOpen,
    setCrmPickerOpen,
    crmCategory,
    setCrmCategory,
    crmContactType,
    setCrmContactType,
    crmDepartment,
    setCrmDepartment,
    crmImportantOnly,
    setCrmImportantOnly,
    toggleEmailInTo,
    filteredContacts,
    selectedToSet,
    selectedCrmCount,
    crmRecipientsByEmail,
    composeRecipientHintsByEmail,
    loadCrmContacts
  };
}
