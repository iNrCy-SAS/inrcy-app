type IconName = "profile" | "activity" | "audience" | "local" | "identity" | "parameters" | "instructions" | "ctas" | "strategy" | "news";

const paths: Record<IconName, string[]> = {
  profile: ["M8 4h8a2 2 0 0 1 2 2v14H6V6a2 2 0 0 1 2-2Z", "M9 8h1m4 0h1M9 12h1m4 0h1M10 20v-4h4v4"],
  activity: ["M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M4 7h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z", "M3 11l9 4 9-4M10 13h4"],
  audience: ["M15 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2", "M6 7a3 3 0 1 0 6 0 3 3 0 0 0-6 0", "M17 4a3 3 0 0 1 0 6m0 4a4 4 0 0 1 4 4v2"],
  local: ["M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z", "M9.5 10a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0"],
  identity: ["M12 3l2.8 5.7L21 9.6l-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9L12 3Z"],
  parameters: ["M4 6h16M4 12h16M4 18h16", "M8 4v4m8 2v4M10 16v4"],
  instructions: ["M9 5h10v15H5V5h2", "M9 3h6v4H9V3ZM9 11h6m-6 4h6"],
  ctas: ["M14 3h7v7m0-7L10 14", "M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"],
  strategy: ["M4 20v-5h4v5M10 20v-9h4v9m2 0V6h4v14", "M4 10l5-5 4 2 6-5"],
  news: ["M13 2 4 14h7l-1 8 10-13h-7l1-7Z"],
};

export default function PersonalizationSectionIcon({ name }: { name: IconName }) {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {paths[name].map((d) => <path key={d} d={d} />)}
  </svg>;
}
