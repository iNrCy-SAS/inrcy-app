import type { AiLanguageCode, AiPreferredCta } from "@/lib/aiGenerationProfile";
import type { AiMediaTypology } from "@/lib/aiMediaGenerationContracts";

type AiMediaLanguageCopy = {
  professionalFallback: string;
  sublineFallback: string;
  headlines: Record<AiMediaTypology, string>;
  ctas: Record<AiPreferredCta, string>;
  supportingEyebrow: string;
  supportingTitle: string;
  supportingBody: string;
  narration: string;
};

const AI_MEDIA_LANGUAGE_COPY: Record<AiLanguageCode, AiMediaLanguageCopy> = {
  fr: {
    professionalFallback: "Votre professionnel iNrCy",
    sublineFallback: "Une expertise professionnelle au service de votre projet",
    headlines: {
      company: "Découvrez notre savoir-faire",
      service: "Une expertise pensée pour vous",
      advice: "Le conseil de votre expert",
      showcase: "Notre savoir-faire en action",
      offer: "Une offre pensée pour vous",
      event: "Un rendez-vous à ne pas manquer",
      behind_scenes: "Dans les coulisses de notre métier",
      recruitment: "Rejoignez notre équipe",
    },
    ctas: {
      none: "Parlons de votre projet",
      site: "Découvrez notre univers",
      devis: "Demandez votre devis",
      appeler: "Appelez-nous",
      message: "Échangeons sur votre projet",
      custom: "Parlons de votre projet",
    },
    supportingEyebrow: "Notre expertise",
    supportingTitle: "Une réponse sur mesure",
    supportingBody: "Qualité, écoute et proximité",
    narration:
      "{company} donne vie à vos projets avec une approche professionnelle et attentive. Chaque besoin devient une solution claire, fiable et personnalisée. {locationSentence} Notre équipe reste à votre écoute. Parlons ensemble de votre projet.",
  },
  en: {
    professionalFallback: "Your iNrCy professional",
    sublineFallback: "Professional expertise dedicated to your project",
    headlines: {
      company: "Discover our expertise",
      service: "A service designed for you",
      advice: "Advice from your expert",
      showcase: "Our expertise in action",
      offer: "An offer designed for you",
      event: "An event not to be missed",
      behind_scenes: "Behind the scenes of our work",
      recruitment: "Join our team",
    },
    ctas: {
      none: "Let's discuss your project",
      site: "Explore our world",
      devis: "Request your quote",
      appeler: "Call us",
      message: "Let's discuss your project",
      custom: "Let's discuss your project",
    },
    supportingEyebrow: "Our expertise",
    supportingTitle: "A tailored solution",
    supportingBody: "Quality, care and local support",
    narration:
      "{company} brings your projects to life with a professional and attentive approach. Every need becomes a clear, reliable and tailored solution. {locationSentence} Our team is ready to listen. Let us discuss your project.",
  },
  es: {
    professionalFallback: "Su profesional iNrCy",
    sublineFallback: "Experiencia profesional al servicio de su proyecto",
    headlines: {
      company: "Descubra nuestra experiencia",
      service: "Un servicio pensado para usted",
      advice: "El consejo de su experto",
      showcase: "Nuestra experiencia en acción",
      offer: "Una oferta pensada para usted",
      event: "Una cita que no debe perderse",
      behind_scenes: "Entre bastidores de nuestro trabajo",
      recruitment: "Únase a nuestro equipo",
    },
    ctas: {
      none: "Hablemos de su proyecto",
      site: "Descubra nuestro universo",
      devis: "Solicite su presupuesto",
      appeler: "Llámenos",
      message: "Hablemos de su proyecto",
      custom: "Hablemos de su proyecto",
    },
    supportingEyebrow: "Nuestra experiencia",
    supportingTitle: "Una solución a medida",
    supportingBody: "Calidad, atención y cercanía",
    narration:
      "{company} da vida a sus proyectos con un enfoque profesional y atento. Cada necesidad se convierte en una solución clara, fiable y personalizada. {locationSentence} Nuestro equipo está a su disposición. Hablemos de su proyecto.",
  },
  it: {
    professionalFallback: "Il vostro professionista iNrCy",
    sublineFallback: "Esperienza professionale al servizio del vostro progetto",
    headlines: {
      company: "Scoprite la nostra esperienza",
      service: "Un servizio pensato per voi",
      advice: "Il consiglio del vostro esperto",
      showcase: "La nostra esperienza in azione",
      offer: "Un'offerta pensata per voi",
      event: "Un appuntamento da non perdere",
      behind_scenes: "Dietro le quinte del nostro lavoro",
      recruitment: "Unitevi al nostro team",
    },
    ctas: {
      none: "Parliamo del vostro progetto",
      site: "Scoprite il nostro mondo",
      devis: "Richiedete un preventivo",
      appeler: "Chiamateci",
      message: "Parliamo del vostro progetto",
      custom: "Parliamo del vostro progetto",
    },
    supportingEyebrow: "La nostra esperienza",
    supportingTitle: "Una soluzione su misura",
    supportingBody: "Qualità, ascolto e vicinanza",
    narration:
      "{company} dà vita ai vostri progetti con un approccio professionale e attento. Ogni esigenza diventa una soluzione chiara, affidabile e personalizzata. {locationSentence} Il nostro team è a vostra disposizione. Parliamo del vostro progetto.",
  },
  de: {
    professionalFallback: "Ihr iNrCy-Profi",
    sublineFallback: "Professionelle Kompetenz für Ihr Projekt",
    headlines: {
      company: "Entdecken Sie unsere Kompetenz",
      service: "Ein Service, der zu Ihnen passt",
      advice: "Der Tipp Ihres Experten",
      showcase: "Unsere Kompetenz im Einsatz",
      offer: "Ein Angebot für Sie",
      event: "Ein Termin, den Sie nicht verpassen sollten",
      behind_scenes: "Ein Blick hinter die Kulissen",
      recruitment: "Werden Sie Teil unseres Teams",
    },
    ctas: {
      none: "Sprechen wir über Ihr Projekt",
      site: "Entdecken Sie unsere Welt",
      devis: "Fordern Sie Ihr Angebot an",
      appeler: "Rufen Sie uns an",
      message: "Sprechen wir über Ihr Projekt",
      custom: "Sprechen wir über Ihr Projekt",
    },
    supportingEyebrow: "Unsere Kompetenz",
    supportingTitle: "Eine maßgeschneiderte Lösung",
    supportingBody: "Qualität, Aufmerksamkeit und Nähe",
    narration:
      "{company} bringt Ihre Projekte mit einem professionellen und aufmerksamen Ansatz zum Leben. Aus jedem Bedarf entsteht eine klare, zuverlässige und passende Lösung. {locationSentence} Unser Team hört Ihnen zu. Sprechen wir über Ihr Projekt.",
  },
  nl: {
    professionalFallback: "Uw iNrCy-professional",
    sublineFallback: "Professionele expertise voor uw project",
    headlines: {
      company: "Ontdek onze expertise",
      service: "Een service die bij u past",
      advice: "Advies van uw expert",
      showcase: "Onze expertise in beeld",
      offer: "Een aanbod voor u",
      event: "Een afspraak om niet te missen",
      behind_scenes: "Achter de schermen van ons werk",
      recruitment: "Kom bij ons team",
    },
    ctas: {
      none: "Laten we uw project bespreken",
      site: "Ontdek onze wereld",
      devis: "Vraag uw offerte aan",
      appeler: "Bel ons",
      message: "Laten we uw project bespreken",
      custom: "Laten we uw project bespreken",
    },
    supportingEyebrow: "Onze expertise",
    supportingTitle: "Een oplossing op maat",
    supportingBody: "Kwaliteit, aandacht en nabijheid",
    narration:
      "{company} brengt uw projecten tot leven met een professionele en betrokken aanpak. Elke behoefte wordt een duidelijke, betrouwbare en passende oplossing. {locationSentence} Ons team luistert graag naar u. Laten we uw project bespreken.",
  },
  pt: {
    professionalFallback: "O seu profissional iNrCy",
    sublineFallback: "Experiência profissional ao serviço do seu projeto",
    headlines: {
      company: "Descubra a nossa experiência",
      service: "Um serviço pensado para si",
      advice: "O conselho do seu especialista",
      showcase: "A nossa experiência em ação",
      offer: "Uma oferta pensada para si",
      event: "Um encontro a não perder",
      behind_scenes: "Nos bastidores do nosso trabalho",
      recruitment: "Junte-se à nossa equipa",
    },
    ctas: {
      none: "Vamos falar do seu projeto",
      site: "Descubra o nosso universo",
      devis: "Peça o seu orçamento",
      appeler: "Ligue-nos",
      message: "Vamos falar do seu projeto",
      custom: "Vamos falar do seu projeto",
    },
    supportingEyebrow: "A nossa experiência",
    supportingTitle: "Uma solução à medida",
    supportingBody: "Qualidade, atenção e proximidade",
    narration:
      "{company} dá vida aos seus projetos com uma abordagem profissional e atenta. Cada necessidade torna-se uma solução clara, fiável e personalizada. {locationSentence} A nossa equipa está disponível para o ouvir. Vamos falar do seu projeto.",
  },
  th: {
    professionalFallback: "ผู้เชี่ยวชาญ iNrCy ของคุณ",
    sublineFallback: "ความเชี่ยวชาญระดับมืออาชีพเพื่อโครงการของคุณ",
    headlines: {
      company: "ค้นพบความเชี่ยวชาญของเรา",
      service: "บริการที่ออกแบบมาเพื่อคุณ",
      advice: "คำแนะนำจากผู้เชี่ยวชาญ",
      showcase: "ผลงานจากความเชี่ยวชาญของเรา",
      offer: "ข้อเสนอที่เหมาะกับคุณ",
      event: "กิจกรรมที่ไม่ควรพลาด",
      behind_scenes: "เบื้องหลังการทำงานของเรา",
      recruitment: "ร่วมงานกับเรา",
    },
    ctas: {
      none: "มาคุยเรื่องโครงการของคุณกัน",
      site: "ค้นพบโลกของเรา",
      devis: "ขอใบเสนอราคา",
      appeler: "โทรหาเรา",
      message: "พูดคุยกับเราเกี่ยวกับโครงการของคุณ",
      custom: "มาคุยเรื่องโครงการของคุณกัน",
    },
    supportingEyebrow: "ความเชี่ยวชาญของเรา",
    supportingTitle: "โซลูชันที่เหมาะกับคุณ",
    supportingBody: "คุณภาพ ความใส่ใจ และความใกล้ชิด",
    narration:
      "{company} ช่วยทำให้โครงการของคุณเป็นจริงด้วยความเป็นมืออาชีพและความใส่ใจ ทุกความต้องการจะกลายเป็นโซลูชันที่ชัดเจน เชื่อถือได้ และเหมาะกับคุณ {locationSentence} ทีมงานของเราพร้อมรับฟัง มาพูดคุยเกี่ยวกับโครงการของคุณกัน",
  },
  zh: {
    professionalFallback: "您的 iNrCy 专业伙伴",
    sublineFallback: "以专业实力助力您的项目",
    headlines: {
      company: "探索我们的专业实力",
      service: "为您量身打造的服务",
      advice: "来自专家的建议",
      showcase: "专业实力，成就品质",
      offer: "为您准备的专属方案",
      event: "不容错过的精彩活动",
      behind_scenes: "走进我们的幕后",
      recruitment: "加入我们的团队",
    },
    ctas: {
      none: "让我们聊聊您的项目",
      site: "探索我们的世界",
      devis: "获取专属报价",
      appeler: "致电联系我们",
      message: "联系我们，聊聊您的项目",
      custom: "让我们聊聊您的项目",
    },
    supportingEyebrow: "我们的专业实力",
    supportingTitle: "为您量身打造的方案",
    supportingBody: "品质、用心与贴近需求",
    narration:
      "{company}以专业、细致的方式让您的项目成为现实。每一项需求都将转化为清晰、可靠、贴合实际的解决方案。{locationSentence}我们的团队随时倾听您的想法。现在就和我们聊聊您的项目。",
  },
};

export function getAiMediaLanguageCopy(language: AiLanguageCode) {
  return AI_MEDIA_LANGUAGE_COPY[language] || AI_MEDIA_LANGUAGE_COPY.fr;
}

export function buildAiMediaNarrationFallback(args: {
  language: AiLanguageCode;
  company?: string;
  location?: string;
}) {
  const copy = getAiMediaLanguageCopy(args.language);
  const company = String(args.company || copy.professionalFallback).trim();
  const location = String(args.location || "").trim();
  const locationSentence: Record<AiLanguageCode, string> = {
    fr: location ? `À ${location}, nous vous accompagnons avec proximité.` : "",
    en: location ? `In ${location}, we support you with a genuinely local service.` : "",
    es: location ? `En ${location}, le acompañamos con un servicio cercano.` : "",
    it: location ? `A ${location}, vi accompagniamo con un servizio vicino alle vostre esigenze.` : "",
    de: location ? `In ${location} begleiten wir Sie mit persönlichem Service vor Ort.` : "",
    nl: location ? `In ${location} ondersteunen wij u met betrokken service dichtbij.` : "",
    pt: location ? `Em ${location}, acompanhamos o seu projeto com proximidade.` : "",
    th: location ? `ใน${location} เราพร้อมดูแลคุณอย่างใกล้ชิด` : "",
    zh: location ? `在${location}，我们为您提供贴近需求的本地服务。` : "",
  };

  return copy.narration
    .replaceAll("{company}", company)
    .replaceAll("{locationSentence}", locationSentence[args.language])
    .replace(/\s+/g, " ")
    .trim();
}
