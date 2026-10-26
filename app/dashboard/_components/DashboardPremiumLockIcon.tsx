import { useId } from "react";

type DashboardPremiumLockIconProps = {
  className?: string;
  variant?: "default" | "luxury";
};

/**
 * Repère visuel commun des fonctions visibles mais réservées à Premium.
 * Il reste décoratif : le libellé adjacent porte toujours l'information
 * accessible (« Premium »).
 */
export function DashboardPremiumLockIcon({ className, variant = "default" }: DashboardPremiumLockIconProps) {
  const id = `premium-lock-${useId().replace(/:/g, "")}`;
  if (variant === "luxury") return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-metal`} x1="17" y1="6" x2="48" y2="37" gradientUnits="userSpaceOnUse"><stop stopColor="#fff7d8" /><stop offset=".25" stopColor="#fff0a9" /><stop offset=".55" stopColor="#b97820" /><stop offset=".78" stopColor="#ffe6a0" /><stop offset="1" stopColor="#a8621c" /></linearGradient>
        <linearGradient id={`${id}-gold`} x1="17" y1="28" x2="49" y2="58" gradientUnits="userSpaceOnUse"><stop stopColor="#fff5b8" /><stop offset=".28" stopColor="#f9d570" /><stop offset=".58" stopColor="#dc9b33" /><stop offset=".8" stopColor="#f2c665" /><stop offset="1" stopColor="#a66722" /></linearGradient>
        <linearGradient id={`${id}-bevel`} x1="15" y1="27" x2="45" y2="55" gradientUnits="userSpaceOnUse"><stop stopColor="#fffde6" /><stop offset=".48" stopColor="#ffe59a" /><stop offset="1" stopColor="#b27329" /></linearGradient>
        <linearGradient id={`${id}-gem`} x1="27" y1="35" x2="37" y2="49" gradientUnits="userSpaceOnUse"><stop stopColor="#a38bd9" /><stop offset=".45" stopColor="#3b285b" /><stop offset="1" stopColor="#201632" /></linearGradient>
      </defs>
      <ellipse cx="33" cy="58" rx="20" ry="3" fill="#080d23" fillOpacity=".45" />
      <path d="M22 29V20a10 10 0 0 1 20 0v9" stroke="#75431b" strokeWidth="9" strokeLinecap="round" transform="translate(1 2)" />
      <path d="M22 29V20a10 10 0 0 1 20 0v9" stroke={`url(#${id}-metal)`} strokeWidth="7" strokeLinecap="round" />
      <path d="M20.5 23v-3a11.5 11.5 0 0 1 15-10.9" stroke="#fffbe0" strokeOpacity=".85" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="15" y="28" width="37" height="28" rx="8" fill="#875122" />
      <rect x="12" y="25" width="37" height="29" rx="8" fill={`url(#${id}-gold)`} stroke={`url(#${id}-bevel)`} strokeWidth="1.6" />
      <path d="M17 31a4 4 0 0 1 4-3h18" stroke="#fff9d8" strokeWidth="2" strokeLinecap="round" strokeOpacity=".85" />
      <path d="M15 44v2a5 5 0 0 0 5 5h22" stroke="#b07725" strokeWidth="1.2" strokeLinecap="round" strokeOpacity=".6" />
      <path d="m31 32 8 9-8 10-8-10 8-9Z" fill={`url(#${id}-gem)`} stroke="#ffe5a0" strokeWidth="1" />
      <path d="m26 40 5-6 3 3" stroke="#d9c9ff" strokeOpacity=".65" strokeLinecap="round" />
      <circle cx="31" cy="39" r="2.5" fill="#ffe8a9" /><path d="m29.5 41-1 4h5l-1-4" fill="#ffe8a9" />
      <path d="m51 12 1.6 4.9L57 19l-4.4 1.6L51 25l-1.5-4.4L45 19l4.5-2.1L51 12Z" fill="#fff2be" />
      <circle cx="12" cy="19" r="1.5" fill="#ffe6a0" />
    </svg>
  );
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
