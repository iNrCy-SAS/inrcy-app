"use client";

import { useId } from "react";
import styles from "./DashboardNavigationIcon.module.css";

export type DashboardNavigationIconKind = "bell" | "gps" | "contact" | "shop" | "cash" | "admin" | "account" | "logout" | "help" | "refresh" | "building";

const PALETTES: Record<DashboardNavigationIconKind, readonly [string, string, string, string]> = {
  bell: ["#ffda54", "#f2b323", "#cf8610", "#885015"],
  gps: ["#53d7ef", "#2bb7d4", "#1883a9", "#165773"],
  contact: ["#ff9b9b", "#f56a8c", "#d94377", "#932e5c"],
  shop: ["#ed83df", "#cb50c5", "#9938b5", "#602b85"],
  cash: ["#6ce6bc", "#2dbe9c", "#12947f", "#0c625d"],
  admin: ["#b5c8eb", "#829ec8", "#5c77a7", "#394e7a"],
  account: ["#81c9ff", "#4c9be5", "#3275be", "#28558b"],
  logout: ["#90bcea", "#5f8ac4", "#4668a4", "#2f4977"],
  help: ["#d3a0ff", "#ae6be9", "#7b43bc", "#502a83"],
  refresh: ["#81d6ff", "#3eb4f3", "#238bcb", "#1c5d91"],
  building: ["#89bbf2", "#568fce", "#3e68a8", "#2e4979"],
};

export default function DashboardNavigationIcon({ kind, className }: { kind: DashboardNavigationIconKind; className?: string }) {
  const id = `dashboard-nav-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const palette = PALETTES[kind];
  const body = `url(#${id}-body)`;
  const edge = `url(#${id}-edge)`;
  const glass = `url(#${id}-glass)`;
  const gear = "m18 5 1.5 3a10 10 0 0 1 3 .5l2.5-2 4 4-2 2.5a10 10 0 0 1 .5 3L31 18v5l-3.5 1.5a10 10 0 0 1-.5 3l2 2.5-4 4-2.5-2a10 10 0 0 1-3 .5L18 36h-5l-1.5-3.5a10 10 0 0 1-3-.5L6 34l-4-4 2-2.5a10 10 0 0 1-.5-3L0 23v-5l3.5-1.5a10 10 0 0 1 .5-3L2 11l4-4 2.5 2a10 10 0 0 1 3-.5L13 5h5Z";

  return (
    <svg className={`${styles.icon} ${className ?? ""}`.trim()} viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false" data-dashboard-navigation-icon={kind}>
      <defs>
        <linearGradient id={`${id}-body`} x1="8" y1="7" x2="31" y2="33" gradientUnits="userSpaceOnUse">
          <stop stopColor={palette[0]} /><stop offset=".42" stopColor={palette[1]} /><stop offset="1" stopColor={palette[2]} />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1="18" y1="8" x2="35" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor={palette[2]} /><stop offset="1" stopColor={palette[3]} />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="12" y1="10" x2="27" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor={palette[0]} /><stop offset="1" stopColor={palette[1]} stopOpacity=".8" />
        </linearGradient>
      </defs>
      <ellipse cx="21" cy="35" rx="12" ry="2" fill="#061126" opacity=".3" />

      {kind === "bell" ? <>
        <path d="M12 28c3-3 2-7 3-11a8 8 0 0 1 16 0c1 4 0 8 3 11v3H12v-3Z" fill={edge} />
        <circle cx="19" cy="6.5" r="2.5" fill="#c48516" stroke="#f5cc46" strokeWidth=".8" />
        <path d="M7 27c3-3 3-6 3-11a9 9 0 0 1 18 0c0 5 0 8 3 11v2H7v-2Z" fill={body} stroke="#e6ad2f" strokeWidth="1" strokeLinejoin="round" />
        <path d="M9 26h20l2 3H7l2-3Z" fill="#efae1b" />
        <path d="M7 29h24" stroke="#ffe276" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M16 32a3.5 3.5 0 0 0 7 0" fill="#d48c16" stroke="#f7c23d" strokeWidth="1" strokeLinecap="round" />
        <path d="M13 17c0-4 1.2-6 4-7" stroke="#fff0ad" strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
        <path d="M26 16c0 4 0 7 2 9" stroke="#b87210" strokeWidth="1.5" strokeLinecap="round" opacity=".6" />
      </> : null}

      {kind === "gps" ? <>
        <circle cx="22" cy="22" r="13.5" fill={edge} />
        <circle cx="19" cy="19" r="13.5" fill={body} stroke="#62d2e5" strokeWidth="1" />
        <circle cx="19" cy="19" r="10.5" fill="#173c59" stroke="#86deec" strokeOpacity=".7" strokeWidth=".8" />
        <path d="M19 9v2m0 16v2M9 19h2m16 0h2" stroke="#9bdfea" strokeWidth="1.2" strokeLinecap="round" />
        <path d="m24 10-3 11-7 7 3-11 7-7Z" fill="#d3eff2" stroke="#d9f7fa" strokeWidth=".5" />
        <path d="m24 10-3 11-4-4 7-7Z" fill="#f76068" />
        <path d="m21 21-7 7 3-11 4 4Z" fill="#eefcff" />
        <path d="m23 12-3 7" stroke="#ffb2af" strokeWidth=".8" strokeLinecap="round" opacity=".7" />
        <circle cx="19" cy="19" r="1.8" fill="#e7faff" stroke="#548eaa" strokeWidth=".8" />
        <path d="M10 10a12 12 0 0 1 12-2" stroke="#aaf0f5" strokeWidth="1" strokeLinecap="round" opacity=".5" />
      </> : null}

      {kind === "contact" ? <>
        <path d="m7 14 4-3h25v19l-4 3H7V14Z" fill={edge} stroke="#a23e68" strokeWidth=".8" strokeLinejoin="round" />
        <rect x="10" y="6" width="18" height="18" rx="2.2" fill="#ffd6c9" stroke="#efb2b3" strokeWidth=".8" />
        <path d="M14 11h10m-10 4h7" stroke="#dd8291" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M6 14h26v19H6V14Z" fill={body} stroke="#f48ba3" strokeWidth="1" strokeLinejoin="round" />
        <path d="m6 15 13 9 13-9v17H6V15Z" fill="#e45483" />
        <path d="m6 33 10-11 3 2 3-2 10 11H6Z" fill={body} />
        <path d="m6 15 13 9 13-9M7 32l8-9m8 0 8 9" stroke="#ffb4bb" strokeWidth=".9" strokeLinejoin="round" opacity=".75" />
        <path d="M8 33h22" stroke="#b83769" strokeWidth="1" strokeLinecap="round" />
      </> : null}

      {kind === "shop" ? <>
        <path d="m27 12 6 4 2 17-5 2-3-23Z" fill={edge} stroke="#8f3d9e" strokeWidth=".8" strokeLinejoin="round" />
        <path d="m10 14 17-2 3 23-21 1 1-22Z" fill={body} stroke="#e973d4" strokeWidth="1" strokeLinejoin="round" />
        <path d="M14 15v-4a5.5 5.5 0 0 1 11 0v3" stroke="#9f6619" strokeWidth="3" strokeLinecap="round" />
        <path d="M14 14v-3a5.5 5.5 0 0 1 11 0v3" stroke="#ffd061" strokeWidth="2" strokeLinecap="round" />
        <path d="M15 10a4.5 4.5 0 0 1 6-3" stroke="#ffe6a2" strokeWidth=".7" strokeLinecap="round" opacity=".7" />
        <path d="m12 18-1 15 15-1" stroke="#f6a3e8" strokeWidth=".9" strokeLinecap="round" opacity=".5" />
        <path d="m19 20 1.5 3 3.3.5-2.4 2.3.6 3.2-3-1.5-2.9 1.5.5-3.2-2.3-2.3 3.2-.5 1.5-3Z" fill="#ffcf66" stroke="#b27726" strokeWidth=".55" strokeLinejoin="round" />
        <path d="M29 17l2 15" stroke="#6d278c" strokeWidth="1" strokeLinecap="round" />
      </> : null}

      {kind === "cash" ? <>
        <g transform="rotate(-12 15 15)">
          <rect x="4" y="8" width="22" height="14" rx="3" fill="#1d7790" stroke="#3e9dac" strokeWidth=".9" />
          <path d="M5 12h20" stroke="#11465c" strokeWidth="2.6" />
          <rect x="8" y="17" width="4" height="2.5" rx=".6" fill="#e6bc59" />
        </g>
        <path d="m28 11 5 4 2 17-3 3-4-24Z" fill={edge} stroke="#10766b" strokeWidth=".8" strokeLinejoin="round" />
        <rect x="13" y="11" width="18" height="24" rx="3.5" fill={body} stroke="#45c9a9" strokeWidth="1" />
        <rect x="16" y="15" width="12" height="7" rx="1.5" fill="#164b57" stroke="#8ce2c9" strokeWidth=".7" />
        <path d="m19 18 1.8 1.6 3.2-2.5" stroke="#a5ffe2" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17 27h2m4 0h2m-8 4h2m4 0h2" stroke="#096b63" strokeWidth="2" strokeLinecap="round" />
        <path d="M15 14v15" stroke="#b3ffe3" strokeWidth=".8" strokeLinecap="round" opacity=".45" />
      </> : null}

      {kind === "admin" ? <>
        <g transform="translate(6 1) scale(.83)"><path d={gear} transform="translate(3 2)" fill={edge} /><path d={gear} fill={body} stroke="#e3d7ff" strokeWidth="1.1" strokeLinejoin="round" /><circle cx="15.5" cy="20.5" r="6" fill={edge} stroke="#c6b6f4" strokeWidth="1.1" /><circle cx="15.5" cy="20.5" r="3.5" fill={glass} opacity=".75" /></g>
      </> : null}

      {kind === "account" ? <>
        <path d="M9 32v-3a11 11 0 0 1 22 0v3l-3 3H11l-2-3Z" fill={edge} />
        <path d="M6 31v-3a11 11 0 0 1 22 0v3H6Z" fill={body} stroke="#d9edff" strokeWidth="1" />
        <circle cx="20" cy="12" r="6.5" fill={edge} />
        <circle cx="17" cy="10" r="6.5" fill={body} stroke="#e4f3ff" strokeWidth="1" />
        <path d="M11 24c2-2 5-3 8-2M13 7a4 4 0 0 1 5-1" stroke="#f5fbff" strokeWidth="1" strokeLinecap="round" opacity=".8" />
      </> : null}

      {kind === "logout" ? <>
        <path d="m9 6 14-2 4 3v27l-4 2-14-3V6Z" fill={edge} stroke={palette[1]} strokeWidth=".8" strokeLinejoin="round" />
        <path d="m7 7 15-3v29l-15-2V7Z" fill={body} stroke="#e0efff" strokeWidth="1" strokeLinejoin="round" />
        <path d="M12 9v20M15 19h20m-6-6 6 6-6 6" stroke="#e4fffb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17 19h15m-3-6 6 6" stroke="#a6dfe9" strokeWidth=".7" strokeLinecap="round" />
      </> : null}

      {kind === "help" ? <>
        <path d="M14 13c0-8 13-8 13-1 0 5-7 5-7 10" transform="translate(2 2)" stroke={edge} strokeWidth="5.1" strokeLinecap="round" />
        <path d="M14 13c0-8 13-8 13-1 0 5-7 5-7 10" stroke={body} strokeWidth="4.5" strokeLinecap="round" />
        <path d="M15 11c1-3 4-4 7-3" stroke="#e3baff" strokeWidth=".9" strokeLinecap="round" opacity=".55" />
        <circle cx="22" cy="31" r="2.7" fill={edge} /><circle cx="20" cy="29" r="2.7" fill="#b77aea" />
        <path d="M19 28h1" stroke="#dfb4ff" strokeWidth=".8" strokeLinecap="round" opacity=".6" />
      </> : null}

      {kind === "refresh" ? <>
        <path d="M30 18a11 11 0 1 0 1 8M30 9v9h-9" transform="translate(2 2)" stroke={edge} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M29 16a11 11 0 1 0 1 8M29 7v9h-9" stroke={body} strokeWidth="3.9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 20a10 10 0 0 1 12-10" stroke="#b6e9ff" strokeWidth=".9" strokeLinecap="round" opacity=".55" />
      </> : null}

      {kind === "building" ? <>
        <path d="m24 5 7 5v24h-7V5Z" fill={edge} stroke={palette[1]} strokeWidth=".8" /><path d="M8 6h16v28H8V6Z" fill={body} stroke="#deefff" strokeWidth="1" /><path d="M13 11h3m3 0h2m-8 6h3m3 0h2m-8 6h3m3 0h2M14 34v-6h5v6" stroke="#eef8ff" strokeWidth="1.5" strokeLinecap="round" /><path d="M5 35h28" stroke={palette[2]} strokeWidth="1.3" strokeLinecap="round" />
      </> : null}
    </svg>
  );
}
