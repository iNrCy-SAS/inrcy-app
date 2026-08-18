import { useLocale, useTranslations } from "next-intl";
import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import styles from "./agenda.module.css";
import DetailSequenceNavigation from "../_components/DetailSequenceNavigation";
import ResponsiveActionButton from "../_components/ResponsiveActionButton";
import SettingsDrawer from "../SettingsDrawer";
import HelpButton from "../_components/HelpButton";
import AgendaSettingsContent from "../settings/_components/AgendaSettingsContent";
import HelpModal from "../_components/HelpModal";
import { confirmInrcy } from "@/lib/inrcyDialog";
import {
  accentFor,
  formatDayLabel,
  formatMonthLabel,
  formatTime,
  getContactOptionLabel,
  getEventAccentClass,
  isDraftEvent,
  getEventWhenLabel,
  keyOf,
  type ContactCategory,
  type ContactType,
  type CrmContact,
  type DayEvent,
  type GuestContactForm,
  type RdvKind,
  type RdvMode,
} from "./agenda.shared";

type TimeDropdownProps = {
  value: string;
  options: string[];
  onChange: (value: string) => void;
};

export function TimeDropdown({ value, options, onChange }: TimeDropdownProps) {
  const i18nT = useTranslations("agenda");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const active = rootRef.current?.querySelector<HTMLElement>(`[data-time-option="${CSS.escape(value)}"]`);
    active?.scrollIntoView({ block: "center" });

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (rootRef.current && target instanceof Node && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, value]);

  return (
    <div className={styles.timeDropdown} ref={rootRef}>
      <button
        type="button"
        className={`${styles.input} ${styles.timeDropdownTrigger}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{value}</span>
        <span className={styles.timeDropdownChevron} aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className={styles.timeDropdownMenu} role="listbox" aria-label={i18nT("choisir_un_horaire_f19c6442")}>
          {options.map((option) => {
            const isActive = option === value;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`${styles.timeDropdownOption} ${isActive ? styles.timeDropdownOptionActive : ""}`}
                data-time-option={option}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
              >
                {option}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


function normalizeContactSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

type ContactSearchDropdownProps = {
  value: string;
  contacts: CrmContact[];
  loading: boolean;
  onChange: (value: string) => void;
};

function ContactSearchDropdown({ value, contacts, loading, onChange }: ContactSearchDropdownProps) {
  const i18nT = useTranslations("agenda");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedContact = contacts.find((contact) => String(contact.id) === String(value));
  const contactFallback = i18nT("contact_b37456c4");
  const selectedLabel = selectedContact ? getContactOptionLabel(selectedContact, contactFallback) : i18nT("aucun_67323ce2");
  const normalizedQuery = normalizeContactSearch(query);
  const filteredContacts = normalizedQuery
    ? contacts.filter((contact) => normalizeContactSearch([getContactOptionLabel(contact, contactFallback), contact.email, contact.phone, contact.address, contact.city, contact.postal_code].filter(Boolean).join(" ")).includes(normalizedQuery))
    : contacts;

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (rootRef.current && target instanceof Node && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.contactSearchDropdown} ref={rootRef}>
      <button
        type="button"
        className={`${styles.input} ${styles.contactSearchTrigger}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={styles.contactSearchSelected}>{loading ? i18nT("chargement_contacts_278732ee") : selectedLabel}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className={styles.contactSearchMenu} role="listbox" aria-label={i18nT("choisir_un_contact_crm_1dac3cf7")}>
          <input
            className={styles.contactSearchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={i18nT("rechercher_un_contact_email_telephone_8f861916")}
            autoFocus
          />
          <button
            type="button"
            className={`${styles.contactSearchOption} ${!value ? styles.contactSearchOptionActive : ""}`}
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(false);
            }}
          >
            {i18nT("aucun_67323ce2")}{" "}</button>
          {filteredContacts.length ? filteredContacts.map((contact) => {
            const label = getContactOptionLabel(contact, contactFallback);
            const isActive = String(contact.id) === String(value);
            return (
              <button
                key={contact.id}
                type="button"
                className={`${styles.contactSearchOption} ${isActive ? styles.contactSearchOptionActive : ""}`}
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onChange(String(contact.id));
                  setQuery("");
                  setOpen(false);
                }}
              >
                {label}
              </button>
            );
          }) : (
            <div className={styles.contactSearchEmpty}>{i18nT("aucun_contact_trouve_5f37a043")}</div>
          )}
        </div>
      )}
    </div>
  );
}

type AgendaHeaderProps = {
  helpOpen: boolean;
  setHelpOpen: React.Dispatch<React.SetStateAction<boolean>>;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  showMobileSearch: boolean;
  setShowMobileSearch: React.Dispatch<React.SetStateAction<boolean>>;
  appointmentRequestsCount: number;
  onOpenAppointmentRequests: () => void;
  onClose: () => void;
};

export function AgendaHeader({ helpOpen, setHelpOpen, settingsOpen, onOpenSettings, onCloseSettings, query, setQuery, showMobileSearch, setShowMobileSearch, appointmentRequestsCount, onOpenAppointmentRequests, onClose }: AgendaHeaderProps) {
  const i18nT = useTranslations("agenda");
  const hasRequests = appointmentRequestsCount > 0;
  return (
    <>
      <div className={styles.header}>
        <div className={styles.brand}>
          <div
            className={styles.brandLogoButton}
            aria-label={i18nT("inr_calendar_f5f54ab6")}
            title={i18nT("inr_calendar_f5f54ab6")}
          >
            <Image
              src="/inrcalendar-logo.png"
              alt={i18nT("interventions_inrcy_f3464527")}
              width={154}
              height={64}
              priority
              style={{ width: 154, height: 64 }}
            />
          </div>

          <div className={styles.brandText}>
            <div className={styles.brandRow}>
              <span className={styles.tagline}>{i18nT("plus_qu_un_agenda_pense_pour_3d5ee439")}</span>
            </div>
          </div>
        </div>

        <div className={styles.headerActions}>
          <div className={`${styles.headerSearch} ${styles.desktopOnly}`}>
            <HelpButton onClick={() => setHelpOpen(true)} title={i18nT("aide_inr_calendar_d2a0e2ca")} />

            <input
              className={styles.headerSearchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={i18nT("rechercher_un_evenement_f7855453")}
            />

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                className={`${styles.btnGhost} ${styles.iconOnlyBtn} ${styles.requestAgendaBtn}`}
                onClick={onOpenAppointmentRequests}
                disabled={!hasRequests}
                aria-label={hasRequests ? `${appointmentRequestsCount} demande(s) de rendez-vous à valider` : "Aucune demande de rendez-vous"}
                title={hasRequests ? `${appointmentRequestsCount} demande(s) de RDV à valider` : "Aucune demande"}
              >
                <span className={styles.requestAgendaIcon} aria-hidden>📅</span>
                {hasRequests ? <span className={styles.requestBellBadge}>{appointmentRequestsCount}</span> : null}
              </button>
              <ResponsiveActionButton
                desktopLabel={i18nT("reglages_00d63297")}
                mobileIcon="⚙️"
                onClick={onOpenSettings}
                title={i18nT("reglages_inr_calendar_cdc58ac4")}
              />
              <ResponsiveActionButton desktopLabel={i18nT("fermer_5ab4ec64")} mobileIcon="✕" onClick={onClose} />
            </div>
          </div>

          <div className={styles.mobileOnly}>
            <HelpButton onClick={() => setHelpOpen(true)} title={i18nT("aide_inr_calendar_d2a0e2ca")} />

            <button
              className={`${styles.btnGhost} ${styles.iconOnlyBtn}`}
              onClick={() => setShowMobileSearch((v) => !v)}
              aria-label={i18nT("rechercher_91f7d3e9")}
              title={i18nT("rechercher_91f7d3e9")}
              type="button"
            >
              <span aria-hidden>🔎</span>
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {hasRequests ? (
                <button
                  type="button"
                  className={`${styles.btnGhost} ${styles.iconOnlyBtn} ${styles.requestAgendaBtn} ${styles.requestAgendaBtnActive}`}
                  onClick={onOpenAppointmentRequests}
                  aria-label={i18nT("value_demande_s_de_rendez_vous_cd011605", { value0: appointmentRequestsCount })}
                  title={i18nT("value_demande_s_de_rdv_a_3211149a", { value0: appointmentRequestsCount })}
                >
                  <span className={styles.requestAgendaIcon} aria-hidden>📅</span>
                  <span className={styles.requestBellBadge}>{appointmentRequestsCount}</span>
                </button>
              ) : (
                <ResponsiveActionButton
                  desktopLabel={i18nT("reglages_00d63297")}
                  mobileIcon="⚙️"
                  onClick={onOpenSettings}
                  title={i18nT("reglages_inr_calendar_cdc58ac4")}
                />
              )}
              <ResponsiveActionButton desktopLabel={i18nT("fermer_5ab4ec64")} mobileIcon="✕" onClick={onClose} />
            </div>
          </div>
        </div>
      </div>

      <HelpModal open={helpOpen} title={i18nT("inr_calendar_d63e6301")} onClose={() => setHelpOpen(false)}>
        <p style={{ marginTop: 0 }}>
          {i18nT("inr_calendar_vous_permet_d_enregistrer_2965de4f")}{" "}</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>{i18nT("planifiez_vos_evenements_interventions_rdv_suivi_06d34b24")}</li>
          <li>{i18nT("retrouvez_rapidement_un_evenement_via_la_49bad53f")}</li>
          <li>{i18nT("gardez_une_vision_claire_de_votre_713c60a5")}</li>
        </ul>
      </HelpModal>

      <SettingsDrawer
        title={i18nT("reglages_inr_calendar_cdc58ac4")}
        isOpen={settingsOpen}
        onClose={onCloseSettings}
      >
        <AgendaSettingsContent />
      </SettingsDrawer>

      {showMobileSearch && (
        <div className={`${styles.mobileSearchBar} ${styles.mobileOnly}`}>
          <input
            className={styles.headerSearchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={i18nT("rechercher_un_evenement_f7855453")}
          />
        </div>
      )}
    </>
  );
}

type AgendaCalendarCardProps = {
  cursorMonth: Date;
  loading: boolean;
  error: string | null;
  success: string | null;
  days: Date[];
  isSixWeeks: boolean;
  selectedKey: string;
  todayKey: string;
  eventsByDay: Map<string, DayEvent[]>;
  onDaySelect: (date: Date) => void;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  onRefresh: () => void;
};

export function AgendaCalendarCard({
  cursorMonth,
  loading,
  error,
  success,
  days,
  isSixWeeks,
  selectedKey,
  todayKey,
  eventsByDay,
  onDaySelect,
  onPrev,
  onToday,
  onNext,
  onRefresh,
}: AgendaCalendarCardProps) {
  const i18nT = useTranslations("agenda");
  const locale = useLocale();
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.monthLabel} style={{ textTransform: "capitalize" }}>
          {formatMonthLabel(cursorMonth, locale)}
        </div>

        <div className={styles.rangeHint}>
          {i18nT("vue_mensuelle_cliquez_sur_un_jour_d2a2b7c4")}{" "}</div>

        <div className={styles.headerControls}>
          <button className={styles.btnIcon} onClick={onPrev} aria-label={i18nT("mois_precedent_535707c7")} title={i18nT("mois_precedent_535707c7")}>
            ‹
          </button>
          <button className={styles.btnIcon} onClick={onToday} aria-label={i18nT("aujourd_hui_ba0603b4")} title={i18nT("aujourd_hui_ba0603b4")}>
            ●
          </button>
          <button className={styles.btnIcon} onClick={onNext} aria-label={i18nT("mois_suivant_7b08eaec")} title={i18nT("mois_suivant_7b08eaec")}>
            ›
          </button>
          <button
            className={styles.btnIcon}
            onClick={onRefresh}
            disabled={loading}
            aria-label={i18nT("actualiser_9d3b2a7d")}
            title={i18nT("actualiser_9d3b2a7d")}
          >
            {loading ? "…" : "↻"}
          </button>
        </div>
      </div>

      <div className={styles.calendar}>
        {error && <div className={styles.empty}>{error}</div>}
        {success && <div style={{ color: "#22c55e", fontWeight: 800, marginBottom: 10 }}>{success}</div>}

        <div className={styles.dowRow}>
          {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
            <div key={d} className={styles.dow}>
              {d}
            </div>
          ))}
        </div>

        <div className={`${styles.grid} ${isSixWeeks ? styles.gridCompact : ""}`}>
          {days.map((d) => {
            const k = keyOf(d);
            const isOutside = d.getMonth() !== cursorMonth.getMonth();
            const isSelected = k === selectedKey;
            const isToday = k === todayKey;
            const list = eventsByDay.get(k) ?? [];
            const show = list.slice(0, 3);
            const more = list.length - show.length;

            return (
              <div
                key={k}
                className={`${styles.day} ${isSixWeeks ? styles.dayCompact : ""} ${isOutside ? styles.dayOutside : ""} ${isSelected ? styles.daySelected : ""}`}
                onClick={() => onDaySelect(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0))}
                role="button"
                tabIndex={0}
              >
                <div className={styles.dayNumWrap}>
                  <div className={styles.dayNumRow}>
                    <span className={styles.dayNumBubble}>{d.getDate()}</span>
                    {list.length > 0 ? <span className={styles.hasEventsDot} aria-hidden /> : null}
                  </div>
                  {isToday && <div className={styles.pillToday}>{i18nT("aujourd_hui_ba0603b4")}</div>}
                </div>

                <div className={styles.chips}>
                  {show.map((ev) => {
                    const draft = isDraftEvent(ev);
                    const accentClass = draft ? styles.accentDraft : getEventAccentClass(accentFor(ev.id), styles);
                    const time = !ev.allDay && ev.startDate ? formatTime(ev.startDate, locale) : "";
                    const baseLabel = ev.allDay ? ev.summary : `${time} — ${ev.summary}`;
                    const label = draft ? `Brouillon · ${baseLabel}` : baseLabel;

                    return (
                      <div
                        key={`${k}-${ev.id}`}
                        className={`${styles.chip} ${ev.allDay ? styles.chipAllDay : ""} ${draft ? styles.chipDraft : ""} ${accentClass}`}
                        title={label}
                      >
                        {label}
                      </div>
                    );
                  })}
                  {more > 0 && <div className={styles.chipMore}>+{more} autre{more > 1 ? "s" : ""}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type AgendaSidebarProps = {
  selectedDate: Date;
  selectedEvents: DayEvent[];
  loading?: boolean;
  query: string;
  globalMatches: DayEvent[];
  onCreateEvent: () => void;
  onOpenEvent: (event: DayEvent) => void;
  onDeleteEvent: (id: string) => void;
  onJumpToEvent: (event: DayEvent) => void;
};

function AgendaEventRow({
  event,
  meta,
  onClick,
  onDelete,
}: {
  event: DayEvent;
  meta: string;
  onClick: () => void;
  onDelete?: () => void;
}) {
  const i18nT = useTranslations("agenda");
  const draft = isDraftEvent(event);
  const accentClass = draft ? styles.accentDraft : getEventAccentClass(accentFor(event.id), styles);

  return (
    <div
      key={event.id}
      className={`${styles.eventRow} ${draft ? styles.eventRowDraft : ""} ${accentClass}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
    >
      <div className={styles.eventMain}>
        <div className={styles.eventTitle}>{draft ? i18nT("brouillon_891e4cb4") : ""}{event.summary || i18nT("sans_titre_679c6748")}</div>
        <div className={styles.eventMeta}>{meta}</div>
      </div>

      {onDelete ? (
        <button
          type="button"
          aria-label={i18nT("supprimer_l_evenement_37a15750")}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: "none",
            color: "inherit",
            opacity: 0.8,
            cursor: "pointer",
            padding: 6,
            borderRadius: 8,
          }}
          title={i18nT("supprimer_1acfc1c7")}
        >
          🗑️
        </button>
      ) : null}
    </div>
  );
}

export function AgendaSidebar({
  selectedDate,
  selectedEvents,
  loading = false,
  query,
  globalMatches,
  onCreateEvent,
  onOpenEvent,
  onDeleteEvent,
  onJumpToEvent,
}: AgendaSidebarProps) {
  const i18nT = useTranslations("agenda");
  const locale = useLocale();
  return (
    <div className={styles.card}>
      <div className={styles.sideHeaderCentered}>
        <div className={styles.sideDate}>{formatDayLabel(selectedDate, locale)}</div>
        <div className={styles.sideEventsCount}>
          {loading && selectedEvents.length === 0 ? i18nT("chargement_01cba1df") : i18nT("value_evenement_value_ea491d64", { value0: selectedEvents.length, value1: selectedEvents.length > 1 ? "s" : "" })}
        </div>
        <button className={`${styles.btnPrimaryWide} ${styles.btnBubble}`} onClick={onCreateEvent}>
          {i18nT("evenement_7f524604")}{" "}</button>
        <div className={styles.sideDivider} />
      </div>

      <div className={styles.sidebarBody}>
        <div className={styles.sideTitle}>{i18nT("details_du_jour_2ed84093")}</div>
        {query.trim() ? (
          <div className={styles.list}>
            {globalMatches.length === 0 && (loading ? <div className={styles.empty}>{i18nT("chargement_des_evenements_b328ea39")}</div> : <div className={styles.empty}>{i18nT("aucun_resultat_53a595bf")}</div>)}
            {globalMatches.map((ev) => {
              const when = getEventWhenLabel(ev, locale, i18nT("toute_la_journee_c51ef82d"));
              const dayLabel = ev.startDate ? formatDayLabel(ev.startDate, locale) : "";
              const meta = `${dayLabel}${when ? ` • ${when}` : ""}${ev.location ? ` • ${ev.location}` : ""}`;
              return (
                <React.Fragment key={ev.id}>
                  <AgendaEventRow
                    event={ev}
                    meta={meta}
                    onClick={() => onJumpToEvent(ev)}
                  />
                </React.Fragment>
              );
            })}
          </div>
        ) : (
          <div className={styles.list}>
            {selectedEvents.length === 0 && (loading ? <div className={styles.empty}>{i18nT("chargement_des_evenements_b328ea39")}</div> : <div className={styles.empty}>{i18nT("aucun_evenement_ce_jour_la_fd881b07")}</div>)}
            {selectedEvents.map((ev) => {
              const when = getEventWhenLabel(ev, locale, i18nT("toute_la_journee_c51ef82d"));
              const meta = `${when}${ev.location ? ` • ${ev.location}` : ""}`;
              return (
                <React.Fragment key={ev.id}>
                  <AgendaEventRow
                    event={ev}
                    meta={meta}
                    onClick={() => onOpenEvent(ev)}
                    onDelete={async () => {
                      const ok = await confirmInrcy({
                        title: i18nT("supprimer_l_evenement_a6ec62d8"),
                        message: i18nT("cette_action_supprimera_definitivement_cet_evene_866eadd0"),
                        confirmLabel: i18nT("supprimer_1acfc1c7"),
                        variant: "danger",
                      });
                      if (ok) onDeleteEvent(ev.id);
                    }}
                  />
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

type AgendaEventModalProps = {
  open: boolean;
  rdvMode: RdvMode;
  rdvIsDraft: boolean;
  rdvError: string | null;
  rdvSaving: boolean;
  rdvSummary: string;
  rdvDate: string;
  rdvStart: string;
  rdvEnd: string;
  rdvLocation: string;
  rdvNotes: string;
  rdvKind: RdvKind;
  intType: string;
  intStatus: string;
  intReference: string;
  rdvContactId: string;
  rdvNewContactName: string;
  rdvNewContactEmail: string;
  rdvNewContactPhone: string;
  rdvNewContactAddress: string;
  rdvNewContactCity: string;
  rdvNewContactPostal: string;
  rdvNewContactSiren: string;
  rdvNewContactCategory: ContactCategory;
  rdvNewContactType: ContactType;
  rdvNewContactImportant: boolean;
  rdvNewContactNotes: string;
  rdvGuests: GuestContactForm[];
  rdvRemindersEnabled: boolean;
  rdvRemindersAvailable: boolean;
  crmAddFeedback: string;
  contacts: CrmContact[];
  contactsLoading: boolean;
  startTimeOptions: string[];
  endTimeOptions: string[];
  onClose: () => void | Promise<void>;
  navigationLabel: string;
  canNavigatePrevious: boolean;
  canNavigateNext: boolean;
  onNavigatePrevious: () => void | Promise<void>;
  onNavigateNext: () => void | Promise<void>;
  onDelete: () => void;
  onSubmit: () => void;
  onSaveDraft: () => void;
  requestIndex: number;
  requestCount: number;
  onPreviousRequest: () => void;
  onNextRequest: () => void;
  onRejectRequest: () => void;
  onAddContactToCrm: () => void;
  onAddGuest: () => void;
  onRemoveGuest: (id: string) => void;
  onUpdateGuestContactId: (id: string, contactId: string) => void;
  onUpdateGuestField: (id: string, field: "name" | "email", value: string) => void;
  clearCrmAddFeedback: () => void;
  setRdvKind: (value: RdvKind) => void;
  setRdvSummary: (value: string) => void;
  setRdvDate: (value: string) => void;
  setRdvStart: (value: string) => void;
  setRdvEnd: (value: string) => void;
  setRdvLocation: (value: string) => void;
  setRdvNotes: (value: string) => void;
  setIntType: (value: string) => void;
  setIntStatus: (value: string) => void;
  setIntReference: (value: string) => void;
  setRdvContactId: (value: string) => void;
  setRdvNewContactName: (value: string) => void;
  setRdvNewContactEmail: (value: string) => void;
  setRdvNewContactPhone: (value: string) => void;
  setRdvNewContactAddress: (value: string) => void;
  setRdvNewContactCity: (value: string) => void;
  setRdvNewContactPostal: (value: string) => void;
  setRdvNewContactSiren: (value: string) => void;
  setRdvNewContactCategory: (value: ContactCategory) => void;
  setRdvNewContactType: (value: ContactType) => void;
  setRdvNewContactImportant: (value: boolean) => void;
  setRdvNewContactNotes: (value: string) => void;
  setRdvRemindersEnabled: (value: boolean) => void;
};

export function AgendaEventModal(props: AgendaEventModalProps) {
  const i18nT = useTranslations("agenda");
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 760px)");
    const sync = () => setIsMobileViewport(media.matches);
    sync();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    media.addListener(sync);
    return () => media.removeListener(sync);
  }, []);

  if (!props.open) return null;
  const isRequestMode = props.rdvMode === "request";
  const canSwitchRequest = isRequestMode && props.requestCount > 1;

  const updateAndClear = <T,>(setter: (value: T) => void, value: T) => {
    setter(value);
    props.clearCrmAddFeedback();
  };

  const openDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) return;

    input.focus();

    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
      } catch {
        // Certains navigateurs refusent showPicker hors interaction directe.
      }
    }
  };

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <div style={{ fontWeight: 950 }}>
            {isRequestMode ? (
              <div className={styles.requestModalTitleRow}>
                <button className={styles.requestSwitchButton} type="button" onClick={props.onPreviousRequest} disabled={!canSwitchRequest} aria-label={i18nT("demande_precedente_cef50f58")}>‹</button>
                <span>{i18nT("demande_8a42d9c5")}{" "}{props.requestIndex + 1}/{Math.max(1, props.requestCount)}</span>
                <button className={styles.requestSwitchButton} type="button" onClick={props.onNextRequest} disabled={!canSwitchRequest} aria-label={i18nT("demande_suivante_e28ba817")}>›</button>
              </div>
            ) : props.rdvMode === "create" ? i18nT("nouvel_evenement_251ad2d8") : props.rdvIsDraft ? i18nT("modifier_le_brouillon_54ce1005") : i18nT("modifier_l_evenement_880699be")}
            <p className="text-xs text-white/60 mt-1">{isRequestMode ? i18nT("validez_la_demande_pour_creer_le_b5898fd9") : props.rdvIsDraft ? i18nT("confirmez_le_brouillon_quand_le_rendez_48c93440") : i18nT("les_rappels_suivent_les_reglages_inr_e6301ebb")}</p>
          </div>
          <div className={styles.modalHeaderActions}>
            {!isRequestMode && props.rdvMode === "edit" && props.navigationLabel ? (
              <DetailSequenceNavigation
                label={props.navigationLabel}
                canPrevious={props.canNavigatePrevious}
                canNext={props.canNavigateNext}
                onPrevious={props.onNavigatePrevious}
                onNext={props.onNavigateNext}
                ariaLabel={i18nT("navigation_entre_les_evenements_d86dede1")}
              />
            ) : null}
            {!isRequestMode && (
              <button
                className={`${styles.btnGhost} ${styles.modalDraftButton}`}
                onClick={props.onSaveDraft}
                disabled={props.rdvSaving}
                aria-label={props.rdvSaving ? "Enregistrement en cours" : "Enregistrer en brouillon"}
                title={props.rdvSaving ? "Enregistrement en cours" : "Enregistrer en brouillon"}
                aria-busy={props.rdvSaving}
              >
                {props.rdvSaving ? "…" : "💾"}
              </button>
            )}
            <button className={styles.btnGhost} onClick={() => void props.onClose()} aria-label={i18nT("fermer_5ab4ec64")}>
              ✕
            </button>
          </div>
        </div>

        <div className={styles.modalBody}>
          {props.rdvError && <div className={styles.modalError}>{props.rdvError}</div>}

          <section className={styles.formSection}>
            <div className={styles.formSectionHeader}>
              <div className={styles.formSectionKicker}>
                <span className={styles.formSectionIcon} aria-hidden>📅</span>
                <div>
                  <div className={styles.formSectionTitle}>{i18nT("rendez_vous_59342b57")}</div>
                  <div className={styles.formSectionHint}>{i18nT("les_infos_essentielles_du_creneau_e6c9719d")}</div>
                </div>
              </div>
            </div>

            <div className={styles.eventMainGrid}>
              <div className={styles.field}>
                <div className={styles.label}>{i18nT("categorie_6b38300a")}</div>
                <select className={styles.input} value={props.rdvKind} onChange={(e) => props.setRdvKind(e.target.value as RdvKind)}>
                  <option value="agenda">{i18nT("rendez_vous_59342b57")}</option>
                  <option value="intervention">{i18nT("intervention_e9b90c40")}</option>
                </select>
              </div>

              <div className={styles.field}>
                <div className={styles.label}>{i18nT("titre_eb97899a")}</div>
                {isMobileViewport ? (
                  <textarea
                    className={`${styles.input} ${styles.inputMultiline}`}
                    value={props.rdvSummary}
                    onChange={(e) => props.setRdvSummary(e.target.value)}
                    placeholder={i18nT("ex_rendez_vous_client_e21b5878")}
                    rows={2}
                  />
                ) : (
                  <input className={styles.input} value={props.rdvSummary} onChange={(e) => props.setRdvSummary(e.target.value)} placeholder={i18nT("ex_rendez_vous_client_e21b5878")} />
                )}
              </div>
            </div>

            <div className={styles.eventTimeGrid}>
              <div className={styles.field}>
                <div className={styles.label}>{i18nT("statut_659499f3")}</div>
                <select className={styles.input} value={props.intStatus} onChange={(e) => props.setIntStatus(e.target.value)}>
                  <option value="devis">{i18nT("devis_f7622f90")}</option>
                  <option value="confirmé">{i18nT("confirme_5b629ae7")}</option>
                  <option value="en cours">{i18nT("en_cours_bc9b533a")}</option>
                  <option value="terminé">{i18nT("termine_3bc59720")}</option>
                  <option value="annulé">{i18nT("annule_34cd87cc")}</option>
                </select>
              </div>

              <div className={`${styles.field} ${styles.dateField}`}>
                <div className={styles.label}>{i18nT("date_eb9a4bc1")}</div>
                <div className={styles.dateInputWrap}>
                  <input
                    ref={dateInputRef}
                    className={`${styles.input} ${styles.dateInput}`}
                    type="date"
                    lang="fr-FR"
                    value={props.rdvDate}
                    onChange={(e) => props.setRdvDate(e.target.value)}
                    placeholder={i18nT("jj_mm_aaaa_75b59481")}
                  />
                  <button
                    type="button"
                    className={styles.dateInputIcon}
                    onClick={openDatePicker}
                    aria-label={i18nT("choisir_une_date_2550642b")}
                  >
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                      <path d="M7 3v3M17 3v3M4.5 9h15M6.5 5.5h13v15h-15v-15h2Z" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className={styles.field}>
                <div className={styles.label}>{i18nT("debut_f0955314")}</div>
                <TimeDropdown value={props.rdvStart} options={props.startTimeOptions} onChange={props.setRdvStart} />
              </div>

              <div className={styles.field}>
                <div className={styles.label}>{i18nT("fin_4251065f")}</div>
                <TimeDropdown value={props.rdvEnd} options={props.endTimeOptions} onChange={props.setRdvEnd} />
              </div>
            </div>
          </section>

          <section className={styles.formSection}>
            <div className={styles.formSectionHeader}>
              <div className={styles.formSectionKicker}>
                <span className={styles.formSectionIcon} aria-hidden>👤</span>
                <div>
                  <div className={styles.formSectionTitle}>{i18nT("contact_principal_6c9e5da4")}</div>
                  <div className={styles.formSectionHint}>{i18nT("base_crm_simple_identite_contact_et_b99a4049")}</div>
                </div>
              </div>
            </div>

            <div className={styles.contactPickerRow}>
              <div className={styles.field}>
                <div className={styles.label}>{i18nT("contact_crm_a0dbaf26")}</div>
                <ContactSearchDropdown
                  value={props.rdvContactId}
                  contacts={props.contacts}
                  loading={props.contactsLoading}
                  onChange={props.setRdvContactId}
                />
              </div>

              <button
                type="button"
                className={`${styles.btnPrimary} ${styles.sectionAction}`}
                onClick={props.onAddContactToCrm}
                title={i18nT("ajoute_le_contact_au_crm_une_9a98eadf")}
              >
                {i18nT("ajouter_au_crm_14073ef0")}{" "}</button>
            </div>

            {props.crmAddFeedback ? (
              <div className={styles.eventSub} style={{ marginTop: 8 }}>
                {props.crmAddFeedback}
              </div>
            ) : null}

            <div className={styles.formGrid2}>
              <input
                className={styles.input}
                value={props.rdvNewContactName}
                onChange={(e) => updateAndClear(props.setRdvNewContactName, e.target.value)}
                placeholder={i18nT("nom_prenom_raison_sociale_ca1f1a9b")}
              />
              <input className={styles.input} value={props.rdvNewContactPhone} onChange={(e) => updateAndClear(props.setRdvNewContactPhone, e.target.value)} placeholder={i18nT("telephone_d3b023ea")} />
              <input className={styles.input} value={props.rdvNewContactEmail} onChange={(e) => updateAndClear(props.setRdvNewContactEmail, e.target.value)} placeholder={i18nT("email_84add5b2")} />
              <input className={styles.input} value={props.rdvNewContactAddress} onChange={(e) => updateAndClear(props.setRdvNewContactAddress, e.target.value)} placeholder={i18nT("adresse_522e1466")} />
              <input className={styles.input} value={props.rdvNewContactCity} onChange={(e) => updateAndClear(props.setRdvNewContactCity, e.target.value)} placeholder={i18nT("ville_97217611")} />
              <input className={styles.input} value={props.rdvNewContactPostal} onChange={(e) => updateAndClear(props.setRdvNewContactPostal, e.target.value)} placeholder={i18nT("code_postal_74779109")} />
            </div>
          </section>

          <section className={styles.formSection}>
            <div className={styles.formSectionHeader}>
              <div className={styles.formSectionKicker}>
                <span className={styles.formSectionIcon} aria-hidden>👥</span>
                <div>
                  <div className={styles.formSectionTitle}>{i18nT("invites_642275f2")}</div>
                  <div className={styles.formSectionHint}>{i18nT("ils_recevront_aussi_les_confirmations_et_409219cc")}</div>
                </div>
              </div>

              <button type="button" className={styles.btnGhost} onClick={props.onAddGuest}>
                {i18nT("ajouter_un_invite_8923ee51")}{" "}</button>
            </div>

            {props.rdvGuests.length === 0 ? (
              <div className={styles.emptyHint}>{i18nT("aucun_invite_ajoute_cf09f539")}</div>
            ) : (
              <div className={styles.guestList}>
                {props.rdvGuests.map((guest, index) => (
                  <div key={guest.id} className={styles.guestCard}>
                    <div className={styles.guestHeader}>
                      <div className={styles.coordsTitle}>{i18nT("invite_d46814dc")}{" "}{index + 1}</div>
                      <button
                        type="button"
                        className={styles.btnGhost}
                        onClick={() => props.onRemoveGuest(guest.id)}
                        style={{ borderRadius: 10, padding: "8px 10px" }}
                      >
                        {i18nT("retirer_54ec24a1")}{" "}</button>
                    </div>

                    <div className={styles.field}>
                      <div className={styles.label}>{i18nT("contact_crm_a0dbaf26")}</div>
                      <ContactSearchDropdown
                        value={guest.contactId}
                        contacts={props.contacts}
                        loading={props.contactsLoading}
                        onChange={(value) => props.onUpdateGuestContactId(guest.id, value)}
                      />
                    </div>

                    <div className={styles.formGrid2}>
                      <input
                        className={styles.input}
                        value={guest.name}
                        onChange={(e) => props.onUpdateGuestField(guest.id, "name", e.target.value)}
                        placeholder={i18nT("nom_prenom_raison_sociale_ca1f1a9b")}
                      />
                      <input
                        className={styles.input}
                        value={guest.email}
                        onChange={(e) => props.onUpdateGuestField(guest.id, "email", e.target.value)}
                        placeholder={i18nT("email_84add5b2")}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={styles.formSection}>
            <div className={styles.formSectionHeader}>
              <div className={styles.formSectionKicker}>
                <span className={styles.formSectionIcon} aria-hidden>📍</span>
                <div>
                  <div className={styles.formSectionTitle}>{i18nT("lieu_notes_0ce09b72")}</div>
                  <div className={styles.formSectionHint}>{i18nT("le_lieu_peut_rester_vide_si_5847b34e")}</div>
                </div>
              </div>
            </div>

            <div className={styles.field}>
              <div className={styles.label}>{i18nT("lieu_du_rdv_optionnel_6829d3f3")}</div>
              <input
                className={styles.input}
                value={props.rdvLocation}
                onChange={(e) => props.setRdvLocation(e.target.value)}
                placeholder={i18nT("ex_zone_d_intervention_entree_batiment_7ce0890b")}
              />
              <div className={styles.eventSub} style={{ marginTop: 6 }}>
                {i18nT("si_ce_champ_est_vide_l_b4597417")}{" "}<b>{i18nT("contact_principal_c531ff67")}</b>.
              </div>
            </div>

            <div className={styles.field} style={{ marginTop: 12 }}>
              <div className={styles.label}>{i18nT("notes_70440046")}</div>
              <textarea className={styles.textarea} value={props.rdvNotes} onChange={(e) => props.setRdvNotes(e.target.value)} placeholder={i18nT("details_consignes_materiel_infos_importantes_fd523008")} />
            </div>
          </section>
        </div>

        <div className={styles.modalFooter}>
          <div className={styles.modalFooterInner}>
            <label className={`${styles.reminderToggle} ${!props.rdvRemindersAvailable ? styles.reminderToggleDisabled : ""}`} title={props.rdvRemindersAvailable ? "Désactiver les rappels uniquement pour ce RDV." : "Aucun créneau de rappel n’est activé dans les réglages."}>
              <input
                type="checkbox"
                checked={props.rdvRemindersAvailable && props.rdvRemindersEnabled}
                disabled={!props.rdvRemindersAvailable || props.rdvSaving}
                onChange={(event) => props.setRdvRemindersEnabled(event.target.checked)}
              />
              <span>{i18nT("rappels_actives_27d504d5")}</span>
            </label>

            <div className={styles.modalFooterActions}>
              {props.rdvMode === "edit" && (
                <button className={`${styles.btnDanger} ${styles.modalFooterBtn}`} onClick={props.onDelete} disabled={props.rdvSaving}>
                  {i18nT("supprimer_1acfc1c7")}{" "}</button>
              )}
              {isRequestMode && (
                <button className={`${styles.btnDanger} ${styles.modalFooterBtn}`} onClick={props.onRejectRequest} disabled={props.rdvSaving}>
                  {i18nT("refuser_62897154")}{" "}</button>
              )}
              <button className={`${styles.btnGhost} ${styles.modalFooterBtn}`} onClick={() => void props.onClose()} disabled={props.rdvSaving}>
                {i18nT("annuler_49ba3292")}{" "}</button>
              <button className={`${styles.btnPrimary} ${styles.modalFooterBtn}`} onClick={props.onSubmit} disabled={props.rdvSaving}>
                {props.rdvSaving ? i18nT("enregistrement_e7d5f232") : isRequestMode ? i18nT("valider_le_rdv_2fe6bc13") : props.rdvIsDraft ? i18nT("confirmer_80a664c8") : i18nT("enregistrer_f7c8bcd8")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
