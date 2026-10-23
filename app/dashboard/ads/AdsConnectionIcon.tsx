type IconName = "disconnect" | "refresh" | "save" | "unlink" | "view" | "instagram" | "info";

export default function AdsConnectionIcon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "disconnect" ? <path d="m7 7 10 10M17 7 7 17" />
      : name === "refresh" ? <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 6.1A8 8 0 0 1 19.7 10M4.3 14A8 8 0 0 0 17.9 17.9" /></>
      : name === "save" ? <><path d="M5 3h12l4 4v14H3V3h2Z" /><path d="M7 3v6h10V3M7 21v-8h10v8" /></>
      : name === "unlink" ? <><path d="m3 3 18 18M10 7l2-2a5 5 0 0 1 7 7l-1 1M14 17l-2 2a5 5 0 0 1-7-7l1-1" /><path d="m9 15 6-6" /></>
      : name === "instagram" ? <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.5 6.5h.01" /></>
      : name === "info" ? <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>
      : <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}
  </svg>;
}
