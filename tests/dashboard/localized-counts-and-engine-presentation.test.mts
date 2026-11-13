import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IntlMessageFormat } from "intl-messageformat";
import { AI_ENGINE_OPTIONS } from "../../lib/aiEnginePreference.ts";
import { getAiEnginePresentation } from "../../app/dashboard/_components/aiEnginePresentation.ts";

const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const originalEngines = structuredClone(AI_ENGINE_OPTIONS);
function catalog(locale: string, namespace: string): Record<string, string> {
  return JSON.parse(readFileSync(new URL(`../../messages/${locale}/${namespace}.json`, import.meta.url), "utf8"));
}

for (const locale of locales) {
  test(`engine explanations and scheduling counts use complete localized messages in ${locale}`, () => {
    const booster = catalog(locale, "booster"), agent = catalog(locale, "agent"), agenda = catalog(locale, "agenda");
    const translate = (key: string) => {
      assert.equal(typeof booster[key], "string", `Missing ${locale}.booster.${key}`);
      return new IntlMessageFormat(booster[key], locale).format() as string;
    };
    for (const option of AI_ENGINE_OPTIONS) {
      const presentation = getAiEnginePresentation(translate, option.value);
      assert.ok(presentation.tendency.length > 10 && presentation.bestFor.length > 10);
      if (locale !== "fr-FR") {
        assert.notEqual(presentation.tendency, option.naturalTendency, "the explanation must not fall back to French provider metadata");
        assert.notEqual(presentation.bestFor, option.bestFor);
      }
    }
    assert.deepEqual(AI_ENGINE_OPTIONS, originalEngines, "localizing presentation never changes provider configuration or stored engine values");
    for (const count of [0, 1, 2, 30]) {
      for (const template of [booster.schedule_recipient_count, agent.settings_impact_affected_count, agenda.calendar_more_events]) {
        const result = new IntlMessageFormat(template, locale).format({ count });
        assert.equal(typeof result, "string");
        assert.ok(String(result).includes(new Intl.NumberFormat(locale).format(count)), "the complete localized sentence includes the count");
        assert.doesNotMatch(String(result), /\{count|plural|undefined/);
      }
    }
    for (const key of ["settings_impact_available_images", "settings_impact_available_video_seconds"]) {
      const unlimited = new IntlMessageFormat(agent[key], locale).format({ count: -1 });
      assert.doesNotMatch(String(unlimited), /-1|undefined|plural/, "the sentinel is rendered as a localized unlimited allowance");
    }
    const eventTitle = "Événement client 保留";
    assert.ok(String(new IntlMessageFormat(agenda.calendar_draft_title, locale).format({ title: eventTitle })).includes(eventTitle), "event titles remain exactly as authored");
  });
}
