import { percentile } from "./ai-live-qa-evaluator.mjs";

const REQUIRED_LANGUAGES = ["fr", "en", "es", "it", "de", "nl", "pt", "th", "zh"];
const REQUIRED_MEDIA = ["text", "image", "video"];
const REQUIRED_CREATIVITY = ["classic", "balanced", "creative"];
const REQUIRED_PROFILES = ["minimal", "full"];

function average(values) {
  const safe = values.map(Number).filter(Number.isFinite);
  return safe.length ? safe.reduce((sum, value) => sum + value, 0) / safe.length : 0;
}

function ratio(part, total) {
  return total > 0 ? part / total : 0;
}

function uniq(values) {
  return Array.from(new Set(values.filter((value) => value !== undefined && value !== null)));
}

function coversAll(actual, required) {
  const set = new Set(actual);
  return required.every((value) => set.has(value));
}

function telemetryOf(row) {
  return row?.telemetry && typeof row.telemetry === "object" ? row.telemetry : null;
}

function threshold(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) ? raw : fallback;
}

export function buildCoverageSummary(report) {
  const engines = Array.isArray(report?.engines) ? report.engines : [];
  const results = Array.isArray(report?.results) ? report.results : [];
  const scenarios = results.map((row) => row?.scenario || {}).filter(Boolean);
  const languages = uniq(scenarios.map((scenario) => scenario.language));
  const media = uniq(scenarios.map((scenario) => scenario.media));
  const creativity = uniq(scenarios.map((scenario) => scenario.creativity));
  const profiles = uniq(scenarios.map((scenario) => scenario.profile));
  const channelCounts = uniq(
    scenarios.map((scenario) => Array.isArray(scenario.channels) ? scenario.channels.length : 0),
  ).sort((a, b) => a - b);
  const maxConfiguredChannels = Math.max(
    0,
    ...scenarios.map((scenario) => Array.isArray(scenario.channels) ? scenario.channels.length : 0),
  );

  return {
    engineCount: engines.length,
    engineIds: engines.map((engine) => engine.engine).filter(Boolean),
    languages,
    media,
    creativity,
    profiles,
    channelCounts,
    maxConfiguredChannels,
    hasSingleChannelCase: channelCounts.includes(1),
    hasAllChannelCase: maxConfiguredChannels >= 9,
    coversAllLanguages: coversAll(languages, REQUIRED_LANGUAGES),
    // Kept for consumers of reports generated before Thai and Chinese support.
    coversSevenLanguages: coversAll(languages, REQUIRED_LANGUAGES),
    coversAllMedia: coversAll(media, REQUIRED_MEDIA),
    coversAllCreativity: coversAll(creativity, REQUIRED_CREATIVITY),
    coversBothProfiles: coversAll(profiles, REQUIRED_PROFILES),
  };
}

export function buildFinalCertification(report, options = {}) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const engines = Array.isArray(report?.engines) ? report.engines : [];
  const coverage = buildCoverageSummary(report);
  const successes = results.filter((row) => row?.success === true);
  const qualityRows = successes.filter((row) => row?.quality);
  const telemetryRows = results.filter((row) => telemetryOf(row));
  const successfulTelemetryRows = successes.filter((row) => telemetryOf(row));
  const allChannelRows = results.filter((row) => Array.isArray(row?.scenario?.channels) && row.scenario.channels.length >= 9);
  const crossEngineValues = Object.values(report?.crossEngineDiversity || {}).map(Number).filter(Number.isFinite);

  const expectedResultCount = engines.length * Number(report?.scenarioCount || 0);
  const successRate = ratio(successes.length, results.length);
  const allChannelSuccessRate = ratio(allChannelRows.filter((row) => row.success).length, allChannelRows.length);
  const repairRate = ratio(successes.filter((row) => row.repairUsed).length, successes.length);
  const averageQuality = average(qualityRows.map((row) => row.quality.totalScore));
  const averagePreference = average(qualityRows.map((row) => row.quality.preferenceAdherence));
  const averageLanguage = average(qualityRows.map((row) => row.quality.languageScore));
  const averageDiversity = average(crossEngineValues);
  const p95DurationMs = percentile(successes.map((row) => row.durationMs || 0), 0.95);

  const telemetryCoverage = ratio(successfulTelemetryRows.length, successes.length);
  const callCounts = successfulTelemetryRows.map((row) => Number(telemetryOf(row)?.callCount || 0));
  const averageCallCount = average(callCounts);
  const maxCallCount = callCounts.length ? Math.max(...callCounts) : 0;
  const maxHttpAttempts = successfulTelemetryRows.length
    ? Math.max(...successfulTelemetryRows.map((row) => Number(telemetryOf(row)?.maxHttpAttempts || 0)))
    : 0;
  const totalInputTokens = telemetryRows.reduce((sum, row) => sum + Number(telemetryOf(row)?.inputTokens || 0), 0);
  const totalOutputTokens = telemetryRows.reduce((sum, row) => sum + Number(telemetryOf(row)?.outputTokens || 0), 0);
  const totalTokens = telemetryRows.reduce((sum, row) => sum + Number(telemetryOf(row)?.totalTokens || 0), 0);
  const totalCostMicroUsd = telemetryRows.reduce((sum, row) => sum + Number(telemetryOf(row)?.costMicroUsd || 0), 0);
  const configuredPricingCalls = telemetryRows.reduce((sum, row) => sum + Number(telemetryOf(row)?.configuredPricingCalls || 0), 0);
  const fallbackPricingCalls = telemetryRows.reduce((sum, row) => sum + Number(telemetryOf(row)?.fallbackPricingCalls || 0), 0);
  const estimatedUsageCalls = telemetryRows.reduce((sum, row) => sum + Number(telemetryOf(row)?.usageEstimatedCalls || 0), 0);
  const successfulCalls = telemetryRows.reduce((sum, row) => sum + Number(telemetryOf(row)?.successCount || 0), 0);
  const configuredPricingCoverage = ratio(configuredPricingCalls, configuredPricingCalls + fallbackPricingCalls);
  const actualUsageCoverage = ratio(Math.max(0, successfulCalls - estimatedUsageCalls), successfulCalls);

  const perEngine = Object.fromEntries(
    engines.map((engine) => {
      const rows = results.filter((row) => row.engine === engine.engine);
      const ok = rows.filter((row) => row.success);
      return [
        engine.engine,
        {
          cases: rows.length,
          successes: ok.length,
          successRate: ratio(ok.length, rows.length),
          averageQuality: average(ok.map((row) => row.quality?.totalScore || 0)),
          averagePreference: average(ok.map((row) => row.quality?.preferenceAdherence || 0)),
          p95DurationMs: percentile(ok.map((row) => row.durationMs || 0), 0.95),
          repairRate: ratio(ok.filter((row) => row.repairUsed).length, ok.length),
          averageCallCount: average(ok.map((row) => Number(telemetryOf(row)?.callCount || 0))),
          costMicroUsd: ok.reduce((sum, row) => sum + Number(telemetryOf(row)?.costMicroUsd || 0), 0),
        },
      ];
    }),
  );

  const thresholds = {
    minSuccessRate: options.minSuccessRate ?? threshold("AI_GATEWAY_CERT_MIN_SUCCESS_RATE", 0.98),
    minPerEngineSuccessRate: options.minPerEngineSuccessRate ?? threshold("AI_GATEWAY_CERT_MIN_ENGINE_SUCCESS_RATE", 0.95),
    minAllChannelSuccessRate: options.minAllChannelSuccessRate ?? threshold("AI_GATEWAY_CERT_MIN_ALL_CHANNEL_SUCCESS_RATE", 0.95),
    minAverageQuality: options.minAverageQuality ?? threshold("AI_GATEWAY_CERT_MIN_QUALITY", 0.78),
    minAveragePreference: options.minAveragePreference ?? threshold("AI_GATEWAY_CERT_MIN_PREFERENCE", 0.74),
    minAverageLanguage: options.minAverageLanguage ?? threshold("AI_GATEWAY_CERT_MIN_LANGUAGE", 0.8),
    minCrossEngineDiversity: options.minCrossEngineDiversity ?? threshold("AI_GATEWAY_CERT_MIN_DIVERSITY", 0.5),
    maxRepairRate: options.maxRepairRate ?? threshold("AI_GATEWAY_CERT_MAX_REPAIR_RATE", 0.25),
    maxP95DurationMs: options.maxP95DurationMs ?? threshold("AI_GATEWAY_CERT_MAX_P95_MS", 110_000),
    minTelemetryCoverage: options.minTelemetryCoverage ?? threshold("AI_GATEWAY_CERT_MIN_TELEMETRY_COVERAGE", 0.98),
    maxAverageCallCount: options.maxAverageCallCount ?? threshold("AI_GATEWAY_CERT_MAX_AVG_CALLS", 2.2),
    maxCallCount: options.maxCallCount ?? threshold("AI_GATEWAY_CERT_MAX_CALLS", 3),
    maxHttpAttempts: options.maxHttpAttempts ?? threshold("AI_GATEWAY_CERT_MAX_HTTP_ATTEMPTS", 2),
    minConfiguredPricingCoverage: options.minConfiguredPricingCoverage ?? threshold("AI_GATEWAY_CERT_MIN_PRICING_COVERAGE", 1),
  };

  const gates = [];
  const addGate = (id, passed, value, expected, severity = "critical") => {
    gates.push({ id, passed: Boolean(passed), value, expected, severity });
  };

  addGate("coverage.engines", coverage.engineCount === 8, coverage.engineCount, "8 moteurs");
  addGate("coverage.languages", coverage.coversAllLanguages, coverage.languages, REQUIRED_LANGUAGES);
  addGate("coverage.media", coverage.coversAllMedia, coverage.media, REQUIRED_MEDIA);
  addGate("coverage.creativity", coverage.coversAllCreativity, coverage.creativity, REQUIRED_CREATIVITY);
  addGate("coverage.profiles", coverage.coversBothProfiles, coverage.profiles, REQUIRED_PROFILES);
  addGate("coverage.single_channel", coverage.hasSingleChannelCase, coverage.channelCounts, "inclure 1 canal");
  addGate("coverage.all_channels", coverage.hasAllChannelCase, coverage.maxConfiguredChannels, ">= 9 canaux");
  addGate("execution.complete_matrix", results.length === expectedResultCount, results.length, expectedResultCount);
  addGate("reliability.global_success", successRate >= thresholds.minSuccessRate, successRate, `>= ${thresholds.minSuccessRate}`);
  addGate("reliability.per_engine", Object.values(perEngine).every((row) => row.successRate >= thresholds.minPerEngineSuccessRate), Object.fromEntries(Object.entries(perEngine).map(([key, row]) => [key, row.successRate])), `chaque moteur >= ${thresholds.minPerEngineSuccessRate}`);
  addGate("reliability.all_channels", allChannelSuccessRate >= thresholds.minAllChannelSuccessRate, allChannelSuccessRate, `>= ${thresholds.minAllChannelSuccessRate}`);
  addGate("quality.average", averageQuality >= thresholds.minAverageQuality, averageQuality, `>= ${thresholds.minAverageQuality}`);
  addGate("quality.preferences", averagePreference >= thresholds.minAveragePreference, averagePreference, `>= ${thresholds.minAveragePreference}`);
  addGate("quality.language", averageLanguage >= thresholds.minAverageLanguage, averageLanguage, `>= ${thresholds.minAverageLanguage}`);
  addGate("personality.cross_engine_diversity", averageDiversity >= thresholds.minCrossEngineDiversity, averageDiversity, `>= ${thresholds.minCrossEngineDiversity}`);
  addGate("orchestration.repair_rate", repairRate <= thresholds.maxRepairRate, repairRate, `<= ${thresholds.maxRepairRate}`);
  addGate("performance.p95", p95DurationMs <= thresholds.maxP95DurationMs, p95DurationMs, `<= ${thresholds.maxP95DurationMs} ms`);
  addGate("telemetry.coverage", telemetryCoverage >= thresholds.minTelemetryCoverage, telemetryCoverage, `>= ${thresholds.minTelemetryCoverage}`);
  addGate("orchestration.average_calls", averageCallCount <= thresholds.maxAverageCallCount, averageCallCount, `<= ${thresholds.maxAverageCallCount}`);
  addGate("orchestration.max_calls", maxCallCount <= thresholds.maxCallCount, maxCallCount, `<= ${thresholds.maxCallCount}`);
  addGate("transport.max_http_attempts", maxHttpAttempts <= thresholds.maxHttpAttempts, maxHttpAttempts, `<= ${thresholds.maxHttpAttempts}`);
  addGate("economics.configured_pricing", configuredPricingCoverage >= thresholds.minConfiguredPricingCoverage, configuredPricingCoverage, `>= ${thresholds.minConfiguredPricingCoverage}`);
  addGate("economics.actual_usage", actualUsageCoverage >= 0.9, actualUsageCoverage, ">= 0.9", "warning");

  const criticalFailures = gates.filter((gate) => gate.severity === "critical" && !gate.passed);
  const warnings = gates.filter((gate) => gate.severity === "warning" && !gate.passed);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    reportId: report?.reportId || null,
    certified: criticalFailures.length === 0,
    status: criticalFailures.length === 0 ? "certified" : "not_certified",
    coverage,
    thresholds,
    metrics: {
      resultCount: results.length,
      expectedResultCount,
      successRate,
      allChannelSuccessRate,
      averageQuality,
      averagePreference,
      averageLanguage,
      averageCrossEngineDiversity: averageDiversity,
      repairRate,
      p95DurationMs,
      telemetryCoverage,
      averageCallCount,
      maxCallCount,
      maxHttpAttempts,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      totalCostMicroUsd,
      totalCostUsd: totalCostMicroUsd / 1_000_000,
      configuredPricingCoverage,
      actualUsageCoverage,
    },
    perEngine,
    gates,
    failures: criticalFailures,
    warnings,
  };
}
