"use client";

import { useId } from "react";

export default function DashboardPremiumCrown({ className }: { className?: string }) {
  const gradientId = `premium-crown-${useId().replace(/:/g, "")}`;

  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="5" y1="7" x2="28" y2="27">
          <stop stopColor="#fff3b0" />
          <stop offset=".5" stopColor="#ffc45b" />
          <stop offset="1" stopColor="#f36bc9" />
        </linearGradient>
      </defs>
      <path d="m4 10 6 5 6-10 6 10 6-5-3 14H7L4 10Z" fill={`url(#${gradientId})`} stroke="#ffe7a8" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9 28h14" stroke="#ffd575" strokeWidth="2.5" strokeLinecap="round" />
      <path d="m27 2 .7 2.3L30 5l-2.3.7L27 8l-.7-2.3L24 5l2.3-.7L27 2Z" fill="#fff0c4" />
      <circle cx="16" cy="19" r="2" fill="#8951c3" />
    </svg>
  );
}
