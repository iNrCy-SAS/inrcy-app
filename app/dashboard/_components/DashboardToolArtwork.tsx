'use client';

import { useId, type ComponentType } from 'react';

type ArtworkKind = 'rocket' | 'studio' | 'reputation' | 'ads' | 'mail' | 'send' | 'calendar' | 'contacts';

type DashboardToolArtworkProps = {
  kind: ArtworkKind;
  className?: string;
};

type IllustrationProps = { id: string };

function RocketArtwork({ id }: IllustrationProps) {
  return (
    <>
      <path
        d="M33 229C99 223 139 197 182 142"
        fill="none"
        stroke={`url(#${id}-trail)`}
        strokeWidth="18"
        strokeLinecap="round"
        opacity=".1"
      />
      <path
        d="M38 231C105 218 148 183 185 139"
        fill="none"
        stroke={`url(#${id}-trail)`}
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".5"
      />

      <g transform="translate(224 108) rotate(41)">
        <path
          d="M-14 43C-24 65-15 95 0 122C15 95 24 65 14 43Z"
          fill={`url(#${id}-flame)`}
          opacity=".85"
        />
        <path d="M-7 43C-12 60-8 78 0 94C8 78 12 60 7 43Z" fill="#c9faff" opacity=".92" />

        <path
          d="M-26-4C-42 6-52 26-54 47L-34 41L-19 23Z"
          fill={`url(#${id}-fin)`}
          stroke="#81a8ff"
          strokeWidth="1.2"
        />
        <path
          d="M26-4C42 6 52 26 54 47L34 41L19 23Z"
          fill={`url(#${id}-fin)`}
          stroke="#96a0ff"
          strokeWidth="1.2"
        />
        <path
          d="M0-91C32-67 37-7 23 43H-23C-37-7-32-67 0-91Z"
          fill={`url(#${id}-metal)`}
          stroke="#c0d9ff"
          strokeWidth="1.4"
        />
        <path d="M0-91C-22-66-25-19-19 13" fill="none" stroke="#f1fbff" strokeWidth="2" opacity=".72" />
        <path d="M0-91C26-62 29-13 19 24" fill="none" stroke="#5265dd" strokeWidth="3" opacity=".32" />
        <path d="M-18-64Q0-72 18-64" fill="none" stroke="#b8d7ff" strokeWidth="1" opacity=".62" />

        <circle cy="-26" r="20" fill="#263785" stroke="#a6beff" strokeWidth="2" />
        <circle cy="-26" r="15.5" fill={`url(#${id}-glass)`} stroke="#63dcff" strokeWidth="1.4" />
        <path d="M-10-32A12 12 0 0 1 5-37" fill="none" stroke="#e6ffff" strokeWidth="2.2" strokeLinecap="round" opacity=".88" />
        <path d="M8-15A13 13 0 0 0 12-31" fill="none" stroke="#2574c9" strokeWidth="2" strokeLinecap="round" opacity=".65" />

        <path d="M-25 27Q0 35 25 27L23 43H-23Z" fill={`url(#${id}-fin)`} stroke="#7fa6f5" strokeWidth="1" />
        <path d="M-13 43H13L10 51H-10Z" fill="#253e87" stroke="#79baff" strokeWidth="1" />
        <path d="M0 7C-8 18-9 38 0 57C9 38 8 18 0 7Z" fill={`url(#${id}-keel)`} stroke="#a9c6ff" strokeWidth="1" />
        <path d="M0 13V47" fill="none" stroke="#e0e8ff" strokeWidth="1" opacity=".68" />
      </g>

      <g fill="#a2edff">
        <path d="M136 57L138 65L146 67L138 69L136 77L134 69L126 67L134 65Z" opacity=".65" />
        <path d="M307 111L308.5 116.5L314 118L308.5 119.5L307 125L305.5 119.5L300 118L305.5 116.5Z" opacity=".85" />
        <circle cx="289" cy="36" r="1.8" opacity=".8" />
        <circle cx="103" cy="122" r="1.6" opacity=".5" />
        <circle cx="266" cy="190" r="1.5" opacity=".6" />
      </g>
      <path d="M190 17L191.4 22.6L197 24L191.4 25.4L190 31L188.6 25.4L183 24L188.6 22.6Z" fill="#d5abff" opacity=".78" />
    </>
  );
}

function StudioArtwork({ id }: IllustrationProps) {
  return (
    <>
      <g transform="translate(18 23) rotate(-12 37 28)">
        <rect width="73" height="58" rx="9" fill={`url(#${id}-panel)`} stroke="#569ce4" strokeWidth="1.1" />
        <rect x="6" y="6" width="61" height="46" rx="5" fill="#112d60" />
        <circle cx="50" cy="18" r="6" fill="#8bdfff" opacity=".8" />
        <path d="M6 45L26 22L45 44L54 33L67 48V52H6Z" fill="#3674c1" />
        <path d="M6 48L26 28L40 45L48 39L65 52H6Z" fill="#63c2e5" opacity=".67" />
        <path d="M20 29L26 22L32 29L26 27Z" fill="#d2efff" opacity=".8" />
      </g>
      <g transform="translate(72 14) rotate(9 35 33)">
        <rect width="70" height="67" rx="9" fill={`url(#${id}-panel)`} stroke="#a58cff" strokeWidth="1.1" />
        <rect x="6" y="6" width="58" height="55" rx="5" fill="#282459" />
        <path d="M6 45C21 20 38 59 64 25V61H6Z" fill={`url(#${id}-creative)`} />
        <path d="M6 33C21 9 43 47 64 16" fill="none" stroke="#a8c5ff" strokeWidth="2" opacity=".7" />
        <circle cx="45" cy="22" r="10" fill="#e1b6ff" opacity=".8" />
        <path d="M6 48C28 25 41 63 64 38V61H6Z" fill="#4a49a4" opacity=".85" />
      </g>
      <g transform="translate(128 49) rotate(-10 19 18)">
        <rect width="38" height="35" rx="7" fill={`url(#${id}-panel)`} stroke="#74b9f5" strokeWidth="1.1" />
        <path d="M12 10L26 17.5L12 25Z" fill="#8ee7ff" />
      </g>
      <path d="M151 13L152.3 18.7L158 20L152.3 21.3L151 27L149.7 21.3L144 20L149.7 18.7Z" fill="#b6d8ff" opacity=".8" />
      <circle cx="35" cy="86" r="2" fill="#65d8f4" opacity=".65" />
    </>
  );
}

function ReputationArtwork({ id }: IllustrationProps) {
  return (
    <>
      <g transform="translate(37 17) rotate(7 61 34)">
        <rect x="8" y="-4" width="118" height="67" rx="10" fill="#4a2a69" stroke="#a46ca9" strokeWidth="1" opacity=".38" />
        <rect width="123" height="68" rx="10" fill={`url(#${id}-review)`} stroke="#b897da" strokeWidth="1.1" />
        <rect x="12" y="12" width="21" height="21" rx="7" fill="#b599d9" opacity=".22" />
        <circle cx="22.5" cy="19" r="3.2" fill="#d8c2ec" opacity=".8" />
        <path d="M16.5 29C16.5 22.5 28.5 22.5 28.5 29" fill="#d8c2ec" opacity=".65" />
        <path d="M43 17H91M43 24H74" fill="none" stroke="#e1d1ef" strokeWidth="3" strokeLinecap="round" opacity=".45" />
        {[20, 40, 60, 80, 100].map((x) => (
          <use key={x} href={`#${id}-star`} transform={`translate(${x} 48) scale(1.12)`} fill={`url(#${id}-gold)`} />
        ))}
      </g>
      <g transform="translate(24 58) rotate(-14)">
        <circle r="17" fill={`url(#${id}-review)`} stroke="#a490cd" strokeWidth="1.2" />
        <use href={`#${id}-star`} transform="scale(1.55)" fill={`url(#${id}-gold)`} />
      </g>
      <path d="M146 7L147.2 12.8L153 14L147.2 15.2L146 21L144.8 15.2L139 14L144.8 12.8Z" fill="#e1b9ff" opacity=".8" />
    </>
  );
}

function AdsArtwork({ id }: IllustrationProps) {
  return (
    <>
      <g transform="translate(131 43) rotate(12)">
        <circle r="26" fill="#402469" stroke="#a582dc" strokeWidth="1.1" opacity=".8" />
        <circle r="17" fill="none" stroke="#b990e8" strokeWidth="1" opacity=".65" />
        <circle r="8" fill="#b281d8" opacity=".45" />
        <path d="M-3 4L23-20M15-21L23-20L24-12" fill="none" stroke="#c8b4ff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g transform="translate(23 35) rotate(-14 37 22)">
        <path d="M26 29L40 31L39 57C34 62 27 57 28 52Z" fill={`url(#${id}-fin)`} stroke="#bb9ce8" strokeWidth="1.1" />
        <path d="M12 11H30L68-4V48L30 33H12C6 33 6 11 12 11Z" fill={`url(#${id}-creative)`} stroke="#cdabf5" strokeWidth="1.2" />
        <path d="M12 12H29V32H12C8 30 8 15 12 12Z" fill="#42347d" stroke="#a98bdf" strokeWidth="1" />
        <ellipse cx="68" cy="22" rx="7" ry="26" fill="#35235b" stroke="#c8a3ef" strokeWidth="1.2" />
        <ellipse cx="68" cy="22" rx="3.5" ry="18" fill="#9b6fc4" opacity=".7" />
        <path d="M34 12L59 3" fill="none" stroke="#e1c7ff" strokeWidth="1.5" strokeLinecap="round" opacity=".6" />
      </g>
      <path d="M101 41Q109 49 103 58M111 34Q126 49 114 67" fill="none" stroke="#cb9af5" strokeWidth="1.7" strokeLinecap="round" opacity=".65" />
      <circle cx="148" cy="84" r="1.8" fill="#b59bff" opacity=".7" />
      <path d="M33 10V18M29 14H37" stroke="#d0b8ff" strokeWidth="1.4" strokeLinecap="round" opacity=".7" />
    </>
  );
}

function MailArtwork({ id }: IllustrationProps) {
  return (
    <>
      <path d="M15 72C29 80 41 73 46 65M19 82C32 87 47 81 53 74" fill="none" stroke="#dba9bd" strokeWidth="1.4" strokeLinecap="round" opacity=".35" />
      <g transform="translate(37 48) rotate(-16 31 19)">
        <rect width="62" height="39" rx="6" fill={`url(#${id}-envelope)`} stroke="#dcb3c8" strokeWidth="1.1" />
        <path d="M2 36L24 18M60 36L38 18" fill="none" stroke="#f2bfce" strokeWidth="1" opacity=".6" />
        <path d="M2 4L27 23Q31 26 35 23L60 4" fill="#f1b3b3" fillOpacity=".15" stroke="#efd1dc" strokeWidth="1.2" />
      </g>
      <g transform="translate(82 23) rotate(12 37 23)">
        <rect width="74" height="47" rx="7" fill={`url(#${id}-envelope)`} stroke="#e0b8dc" strokeWidth="1.1" />
        <path d="M2 44L29 20M72 44L45 20" fill="none" stroke="#dca7d5" strokeWidth="1.1" opacity=".7" />
        <path d="M2 4L32 28Q37 32 42 28L72 4" fill="#dec1f7" fillOpacity=".16" stroke="#f0d0ea" strokeWidth="1.2" />
        <use href={`#${id}-star`} transform="translate(37 25) scale(1.05)" fill={`url(#${id}-gold)`} />
      </g>
      <g transform="translate(129 4) rotate(-13 17 11)" opacity=".65">
        <rect width="34" height="22" rx="4" fill={`url(#${id}-envelope)`} stroke="#d6b3df" strokeWidth="1" />
        <path d="M2 3L17 14L32 3" fill="none" stroke="#ebcbe8" strokeWidth="1" />
      </g>
      <circle cx="79" cy="12" r="1.8" fill="#edb5dd" opacity=".65" />
      <path d="M167 75V82M163.5 78.5H170.5" stroke="#efc2dc" strokeWidth="1.4" strokeLinecap="round" opacity=".7" />
    </>
  );
}

function SendArtwork({ id }: IllustrationProps) {
  return (
    <>
      <path d="M16 77C43 90 60 70 49 61C35 50 24 73 48 77C76 81 87 61 105 47" fill="none" stroke="#7dd7f2" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="3 6" opacity=".55" />
      <g transform="translate(95 44) rotate(-12)">
        <path d="M-42-10 49-34 22 34 3 7-42-10Z" fill={`url(#${id}-panel)`} stroke="#98dcff" strokeWidth="2" strokeLinejoin="round" />
        <path d="M49-34 3 7 0 28 12 18" fill="#5389b9" fillOpacity=".6" stroke="#a7ddff" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="m3 7 46-41-32 47" stroke="#e0f6ff" strokeWidth="1.5" strokeLinecap="round" opacity=".75" />
      </g>
      <path d="M149 66v8m-4-4h8" stroke="#94caff" strokeWidth="1.8" strokeLinecap="round" opacity=".6" />
    </>
  );
}

function CalendarArtwork({ id }: IllustrationProps) {
  return (
    <>
      <g transform="translate(54 13) rotate(8 42 35)">
        <rect width="85" height="73" rx="11" fill={`url(#${id}-panel)`} stroke="#c4b6ef" strokeWidth="1.8" />
        <path d="M1 23h83" stroke="#c6b2e5" strokeWidth="1.8" opacity=".8" />
        <path d="M22-4v15M63-4v15" stroke="#eed9b8" strokeWidth="5" strokeLinecap="round" />
        <g fill="#d9c3ed" opacity=".65">
          <rect x="16" y="36" width="8" height="7" rx="2" /><rect x="38" y="36" width="8" height="7" rx="2" />
          <rect x="60" y="36" width="8" height="7" rx="2" /><rect x="16" y="53" width="8" height="7" rx="2" />
          <rect x="38" y="53" width="8" height="7" rx="2" />
        </g>
      </g>
      <circle cx="132" cy="70" r="18" fill="#775737" stroke="#ebce92" strokeWidth="1.8" />
      <path d="m124 70 6 6 10-12" fill="none" stroke="#fff0c7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 35v8m-4-4h8" stroke="#d0b4e4" strokeWidth="1.8" strokeLinecap="round" opacity=".6" />
    </>
  );
}

function ContactsArtwork({ id }: IllustrationProps) {
  return (
    <>
      <g transform="translate(22 22) rotate(-9 31 31)" opacity=".65">
        <rect width="62" height="61" rx="11" fill={`url(#${id}-panel)`} stroke="#70c8dc" strokeWidth="1.7" />
        <circle cx="31" cy="21" r="9" fill="#85cbd6" />
        <path d="M14 49v-3a17 17 0 0 1 34 0v3" fill="#62a8c5" />
      </g>
      <g transform="translate(76 13) rotate(8 34 34)">
        <rect width="69" height="69" rx="12" fill={`url(#${id}-panel)`} stroke="#9cdbeb" strokeWidth="1.8" />
        <circle cx="34.5" cy="23" r="10" fill="#b1e5e8" />
        <path d="M15 55v-3a19.5 19.5 0 0 1 39 0v3" fill="#75bfce" />
      </g>
      <circle cx="143" cy="75" r="13" fill="#296667" stroke="#8cddd2" strokeWidth="1.7" />
      <path d="M143 69v12m-6-6h12" stroke="#d8fff1" strokeWidth="2" strokeLinecap="round" />
    </>
  );
}

const illustrations = {
  rocket: RocketArtwork,
  studio: StudioArtwork,
  reputation: ReputationArtwork,
  ads: AdsArtwork,
  mail: MailArtwork,
  send: SendArtwork,
  calendar: CalendarArtwork,
  contacts: ContactsArtwork,
} satisfies Record<ArtworkKind, ComponentType<IllustrationProps>>;

export default function DashboardToolArtwork({ kind, className }: DashboardToolArtworkProps) {
  const id = `dashboard-art-${useId().replace(/:/g, '')}`;
  const Illustration = illustrations[kind];

  return (
    <svg
      className={className}
      viewBox={kind === 'rocket' ? '0 0 360 260' : '0 0 180 100'}
      width="100%"
      height="100%"
      fill="none"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={`${id}-metal`} x1="-33" y1="-14" x2="33" y2="-1" gradientUnits="userSpaceOnUse">
          <stop stopColor="#758ff1" />
          <stop offset=".24" stopColor="#b2d6ff" />
          <stop offset=".48" stopColor="#e1f3ff" />
          <stop offset=".72" stopColor="#91b7fc" />
          <stop offset="1" stopColor="#776ad5" />
        </linearGradient>
        <linearGradient id={`${id}-fin`} x1="-35" y1="-6" x2="33" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#719af3" />
          <stop offset=".55" stopColor="#3e59bf" />
          <stop offset="1" stopColor="#865ac9" />
        </linearGradient>
        <linearGradient id={`${id}-keel`} x1="-8" y1="20" x2="9" y2="39" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d0dfff" />
          <stop offset=".45" stopColor="#7fa8f4" />
          <stop offset="1" stopColor="#575cc3" />
        </linearGradient>
        <radialGradient id={`${id}-glass`} cx="0" cy="0" r="1" gradientTransform="translate(-6 -34) rotate(58) scale(25)">
          <stop stopColor="#bbfaff" />
          <stop offset=".25" stopColor="#51d6fb" />
          <stop offset=".68" stopColor="#2e8cdb" />
          <stop offset="1" stopColor="#334a9e" />
        </radialGradient>
        <linearGradient id={`${id}-flame`} x1="0" y1="43" x2="0" y2="122" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e0faff" />
          <stop offset=".25" stopColor="#7de8ff" />
          <stop offset=".6" stopColor="#8e88f3" stopOpacity=".7" />
          <stop offset="1" stopColor="#d695ed" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-trail`} x1="35" y1="229" x2="185" y2="142" gradientUnits="userSpaceOnUse">
          <stop stopColor="#39c7f1" stopOpacity="0" />
          <stop offset=".5" stopColor="#65c7f0" />
          <stop offset="1" stopColor="#d1a8ff" />
        </linearGradient>
        <linearGradient id={`${id}-panel`} x1="0" y1="0" x2="85" y2="80" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3475ac" stopOpacity=".9" />
          <stop offset=".5" stopColor="#283d74" />
          <stop offset="1" stopColor="#5b3c8a" />
        </linearGradient>
        <linearGradient id={`${id}-creative`} x1="8" y1="8" x2="69" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#68b4ee" />
          <stop offset=".5" stopColor="#9272d8" />
          <stop offset="1" stopColor="#b65eb4" />
        </linearGradient>
        <linearGradient id={`${id}-review`} x1="8" y1="0" x2="125" y2="74" gradientUnits="userSpaceOnUse">
          <stop stopColor="#72507e" />
          <stop offset=".5" stopColor="#493560" />
          <stop offset="1" stopColor="#392a54" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="-5" y1="-6" x2="5" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffe6ab" />
          <stop offset=".48" stopColor="#e7bd6d" />
          <stop offset="1" stopColor="#c7924f" />
        </linearGradient>
        <linearGradient id={`${id}-envelope`} x1="0" y1="0" x2="75" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#bd849d" />
          <stop offset=".45" stopColor="#9b5888" />
          <stop offset="1" stopColor="#663f80" />
        </linearGradient>
        <path id={`${id}-star`} d="M0-6L1.8-1.9L6.3-1.4L3 1.5L4 5.9L0 3.6L-4 5.9L-3 1.5L-6.3-1.4L-1.8-1.9Z" />
      </defs>
      <Illustration id={id} />
    </svg>
  );
}
