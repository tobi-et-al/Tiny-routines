const SOURCES = {
  homertonFeeding: {
    name: "Homerton infant feeding",
    url: "https://www.homerton.nhs.uk/infant-feeding",
    evidence: "Use responsive feeding. Breastfed newborns commonly feed at least 8 to 10 times in 24 hours. Follow the baby's individual feeding plan and seek feeding support when needed.",
  },
  nhsMilk: {
    name: "NHS: Is my baby getting enough milk?",
    url: "https://www.nhs.uk/baby/breastfeeding-and-bottle-feeding/breastfeeding-problems/enough-milk/",
    evidence: "Wet nappies, feeding behaviour and weight are considered together. From day five, at least six heavy wet nappies in 24 hours can be one sign that feeding is going well.",
  },
  nhsJaundice: {
    name: "NHS: Jaundice in babies",
    url: "https://www.nhs.uk/conditions/jaundice-in-babies/",
    evidence: "Parents should seek prompt clinical advice when a newborn is unwell. This AI response must not replace urgent assessment or the app's on-device temperature warning.",
  },
  nhsSleep: {
    name: "NHS: Helping your baby to sleep",
    url: "https://www.nhs.uk/baby/caring-for-a-newborn/helping-your-baby-to-sleep/",
    evidence: "Newborn sleep varies widely and often occurs in short bursts. Incomplete sleep logging cannot establish total sleep need.",
  },
  homertonPostnatal: {
    name: "Homerton: Caring for you and your baby",
    url: "https://www.homerton.nhs.uk/caring-for-you-and-your-baby",
    evidence: "When emotional wellbeing is difficult, discussing it with a GP, midwife, obstetrician or health visitor is appropriate. Seeking help early is reasonable.",
  },
  ebbBreastfeeding: {
    name: "Evidence Based Birth: Breastfeeding resources",
    url: "https://evidencebasedbirth.com/favorite-resources-breastfeeding-info/",
    evidence: "Evidence-based breastfeeding resources can support informed discussion, but individual feeding concerns need assessment by an appropriately qualified professional.",
  },
} as const;

const SOURCE_IDS = new Set(Object.keys(SOURCES));
const OBSERVATION_CODES = new Set([
  "fellAsleep", "latchedWell", "neededLatchHelp", "calm", "burpedWell", "spitUp", "stillHungry",
  "eyesOpen", "wokeUp", "cried", "alert", "sleepy", "fussy", "hungerCues", "hiccups", "sneezed", "skinToSkin",
  "mumCalm", "mumContent", "mumTired", "mumWorried", "mumOverwhelmed", "mumTearful", "mumLow", "mumIrritable", "mumSupported", "mumNeedsSupport",
]);
const ALLOWED_ORIGINS = new Set([
  "https://tiny-routines.skyscanner-5277.chatgpt.site",
  "https://tiny-routines.netlify.app",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  ...String(Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((value) => value.trim()).filter(Boolean),
]);
const counters = new Map<string, { count: number; resetAt: number }>();

type JsonRecord = Record<string, unknown>;

function json(status: number, body: unknown, origin = ""): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: JsonRecord, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

function finiteIn(value: unknown, min: number, max: number, nullable = false): boolean {
  return nullable && value === null || typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function validatePayload(value: unknown): value is JsonRecord {
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "periodDays", "babyAgeDays", "completeness", "daily", "feeding", "codedObservations", "mumWellbeing", "temperatures"])) return false;
  if (value.schemaVersion !== 1 || ![1, 3, 7, 14, 30].includes(Number(value.periodDays)) || !finiteIn(value.babyAgeDays, 0, 365, true)) return false;
  if (!isRecord(value.completeness) || !exactKeys(value.completeness, ["currentDayPartial", "loggedDays"]) || typeof value.completeness.currentDayPartial !== "boolean" || !finiteIn(value.completeness.loggedDays, 0, 30)) return false;
  if (!Array.isArray(value.daily) || value.daily.length !== value.periodDays || value.daily.length > 30) return false;
  const dailyKeys = ["dayOffset", "feeds", "measuredCupMl", "wet", "dirty", "sleepMinutes"];
  if (!value.daily.every((day) => isRecord(day) && exactKeys(day, dailyKeys) && finiteIn(day.dayOffset, -29, 0) && finiteIn(day.feeds, 0, 100) && finiteIn(day.measuredCupMl, 0, 10000) && finiteIn(day.wet, 0, 100) && finiteIn(day.dirty, 0, 100) && finiteIn(day.sleepMinutes, 0, 1440, true))) return false;
  const feedingKeys = ["totalFeeds", "breastfeeds", "breastMinutes", "cupFormulaMl", "cupBreastMl", "pumpedMl", "medianGapMinutes", "longestGapMinutes"];
  if (!isRecord(value.feeding) || !exactKeys(value.feeding, feedingKeys)) return false;
  const feeding = value.feeding;
  if (!feedingKeys.every((key) => finiteIn(feeding[key], 0, key.includes("Gap") ? 720 : 50000, key.includes("Gap")))) return false;
  if (!isRecord(value.codedObservations)) return false;
  const codedObservations = value.codedObservations;
  if (Object.keys(codedObservations).some((key) => !OBSERVATION_CODES.has(key) || !finiteIn(codedObservations[key], 1, 1000))) return false;
  if (!isRecord(value.mumWellbeing) || !exactKeys(value.mumWellbeing, ["steady", "strained", "support"]) || !Object.values(value.mumWellbeing).every((item) => finiteIn(item, 0, 1000))) return false;
  if (!isRecord(value.temperatures) || !exactKeys(value.temperatures, ["count", "minC", "maxC"]) || !finiteIn(value.temperatures.count, 0, 100) || !finiteIn(value.temperatures.minC, 25, 45, true) || !finiteIn(value.temperatures.maxC, 25, 45, true)) return false;
  return true;
}

function withinBestEffortLimit(request: Request): boolean {
  const key = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const current = counters.get(key);
  if (!current || current.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  current.count += 1;
  return current.count <= 10;
}

function extractJson(content: unknown): unknown {
  if (isRecord(content)) return content;
  if (typeof content !== "string") throw new Error("missing model content");
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

function validateModelResult(value: unknown): JsonRecord | null {
  if (!isRecord(value) || !exactKeys(value, ["status", "summary", "insights", "limitations"])) return null;
  if (!['ok', 'insufficient'].includes(String(value.status)) || typeof value.summary !== "string" || value.summary.length > 500 || !Array.isArray(value.insights) || value.insights.length > 5 || !Array.isArray(value.limitations) || value.limitations.length > 6) return null;
  if (!value.limitations.every((item) => typeof item === "string" && item.length <= 240)) return null;
  const insights = value.insights.map((item) => {
    if (!isRecord(item) || !exactKeys(item, ["title", "finding", "context", "sourceIds"]) || typeof item.title !== "string" || typeof item.finding !== "string" || typeof item.context !== "string" || item.title.length > 120 || item.finding.length > 500 || item.context.length > 500 || !Array.isArray(item.sourceIds) || !item.sourceIds.length || item.sourceIds.some((id) => typeof id !== "string" || !SOURCE_IDS.has(id))) return null;
    return { title: item.title, finding: item.finding, context: item.context, sourceIds: [...new Set(item.sourceIds)] };
  });
  if (insights.some((item) => item === null)) return null;
  if (value.status === "insufficient" && insights.length) return null;
  return { status: value.status, summary: value.status === "insufficient" ? "Not enough information for a supported summary." : value.summary, insights, limitations: value.limitations };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") {
    if (!ALLOWED_ORIGINS.has(origin)) return json(403, { code: "origin_not_allowed" });
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization, x-client-info, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS", "access-control-max-age": "86400", "vary": "origin" } });
  }
  if (request.method !== "POST") return json(405, { code: "method_not_allowed" }, origin);
  if (!ALLOWED_ORIGINS.has(origin)) return json(403, { code: "origin_not_allowed" });
  if (!withinBestEffortLimit(request)) return json(429, { code: "rate_limited", message: "Please try again later." }, origin);
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > 20_000) return json(413, { code: "payload_too_large" }, origin);

  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 20_000) return json(413, { code: "payload_too_large" }, origin);
    payload = JSON.parse(raw);
  } catch {
    return json(400, { code: "invalid_json" }, origin);
  }
  if (!validatePayload(payload)) return json(400, { code: "invalid_payload", message: "Only the documented de-identified aggregate schema is accepted." }, origin);

  const apiUrl = Deno.env.get("AI_API_URL");
  const apiKey = Deno.env.get("AI_API_KEY");
  const model = Deno.env.get("AI_MODEL");
  if (!apiUrl || !apiKey || !model) return json(503, { code: "provider_not_configured", message: "The AI evidence service is not configured." }, origin);

  const evidence = Object.entries(SOURCES).map(([id, source]) => ({ id, ...source }));
  const system = `You explain patterns in de-identified newborn and maternal wellbeing log aggregates using only the supplied evidence. Never diagnose. Never infer missing events, intake, sleep, hydration, weight, illness, or wellbeing. Treat a partial day and unlogged days as incomplete. If the data cannot support a useful statement, return status "insufficient". Every insight must cite one or more supplied source IDs and must be directly supported by those sources. Do not give urgent care instructions; the app handles urgent safety rules outside the model. Return only JSON with exactly: {"status":"ok"|"insufficient","summary":string,"insights":[{"title":string,"finding":string,"context":string,"sourceIds":string[]}],"limitations":string[]}.`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const providerResponse = await fetch(apiUrl, {
      method: "POST",
      headers: { "authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 900, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ aggregates: payload, evidence }) }] }),
      signal: controller.signal,
    });
    if (!providerResponse.ok) return json(502, { code: "provider_error", message: "The model provider did not return a usable response." }, origin);
    const providerBody = await providerResponse.json();
    const content = providerBody?.choices?.[0]?.message?.content ?? providerBody?.output?.[0]?.content?.[0]?.text;
    const result = validateModelResult(extractJson(content));
    if (!result) return json(502, { code: "invalid_model_output", message: "The model response was hidden because it could not be verified." }, origin);
    return json(200, { ...result, sources: Object.fromEntries(Object.entries(SOURCES).map(([id, source]) => [id, { name: source.name, url: source.url }])) }, origin);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return json(502, { code: timedOut ? "provider_timeout" : "provider_error", message: timedOut ? "The model provider timed out." : "The model provider response could not be verified." }, origin);
  } finally {
    clearTimeout(timeout);
  }
});
