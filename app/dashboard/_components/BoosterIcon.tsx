export default function BoosterIcon({ gradientId }: { gradientId?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke={gradientId ? `url(#${gradientId})` : "currentColor"} strokeWidth={gradientId ? 2.6 : 2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {gradientId ? <defs>
        <linearGradient id={gradientId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop stopColor="#ff9d00" />
          <stop offset=".34" stopColor="#ff3b92" />
          <stop offset=".64" stopColor="#aa31ef" />
          <stop offset="1" stopColor="#00b9ef" />
        </linearGradient>
      </defs> : null}
      <path d="M37 9c8.8-2.8 16.9-2 18-1-1 11-3.4 19.1-12 27.7l-6.9 6.9-13.7-13.7 6.9-6.9C31.9 15.7 34.4 11.9 37 9Z" />
      <path d="m24.2 27.7-9.8 1.4-7.1 7.1 13.5 1.3M36.3 39.8l-1.4 9.8-7.1 7.1-1.3-13.5" />
      <circle cx="42.5" cy="21.5" r="5.2" />
      <path d="M18 44c-5.8 1.1-8.8 4.1-10 10 5.9-1.2 8.9-4.2 10-10Z" />
    </svg>
  );
}
