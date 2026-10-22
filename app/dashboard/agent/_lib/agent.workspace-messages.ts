import type { AbstractIntlMessages } from "next-intl";

// Only UI catalog values change. Storage keys, generated content and historical reports stay intact.
export function rebrandAgentMessages(messages: AbstractIntlMessages, label: string): AbstractIntlMessages {
  return Object.fromEntries(Object.entries(messages).map(([key, value]) => [key,
    typeof value === "string"
      ? value.replace(/d[’']iNr[’'‘\s-]*Agent/giu, `de l’${label}`).replace(/iNr[’'‘\s-]*Agent/giu, label)
      : rebrandAgentMessages(value, label),
  ]));
}
