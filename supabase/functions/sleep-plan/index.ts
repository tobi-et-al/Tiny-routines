const SOURCES = {
  nhsSleep: {
    name: "NHS: Helping your baby to sleep",
    url: "https://www.nhs.uk/baby/caring-for-a-newborn/helping-your-baby-to-sleep/",
    evidence: "Newborn sleep varies widely and often occurs in short bursts. Parents can rest when the baby sleeps, share night care where possible, and keep night care quiet and low-stimulation.",
  },
  nhsParentRest: {
    name: "NHS: Sleep and tiredness after having a baby",
    url: "https://www.nhs.uk/baby/support-and-services/sleep-and-tiredness-after-having-a-baby/",
    evidence: "Partners can share night care. With breastfeeding, a partner can help with nappies, settling and morning care so Mum can return to sleep.",
  },
  nhsResponsiveFeeding: {
    name: "NHS: Feeding on demand",
    url: "https://www.nhs.uk/best-start-in-life/baby/feeding-your-baby/bottle-feeding/bottle-feeding-your-baby/feeding-on-demand/",
    evidence: "Feeding should respond to hunger and fullness cues rather than a rigid timetable. Babies vary in how often they want to feed.",
  },
  nhsSoothing: {
    name: "NHS: Soothing a crying baby",
    url: "https://www.nhs.uk/baby/caring-for-a-newborn/soothing-a-crying-baby/",
    evidence: "Check common needs such as hunger, a nappy, wind or temperature; calm, quiet interaction can help. If crying becomes overwhelming, place baby safely in their cot and take a short break.",
  },
  lullabySleep: {
    name: "The Lullaby Trust: Safer sleep",
    url: "https://www.lullabytrust.org.uk/baby-safety/being-a-parent-or-caregiver/expectant-parents/",
    evidence: "For at least the first six months, baby should sleep on their back in their own clear, flat sleep space in the same room as an adult. Sleeping with a baby on a sofa or chair is dangerous.",
  },
} as const;

const SOURCE_IDS = new Set(Object.keys(SOURCES));
const TRUSTED_DOMAINS = ["nhs.uk", "lullabytrust.org.uk", "unicef.org.uk", "homerton.nhs.uk", "nice.org.uk"];
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
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: JsonRecord, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function finiteIn(value: unknown, min: number, max: number, nullable = false): boolean {
  if (nullable && value === null) return true;
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function validPayload(value: unknown): value is JsonRecord {
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "periodDays", "babyAgeDays", "completeness", "feeding", "hourly"])) return false;
  if (value.schemaVersion !== 1 || ![3, 7, 14].includes(Number(value.periodDays)) || !finiteIn(value.babyAgeDays, 0, 365, true)) return false;
  if (!isRecord(value.completeness) || !exactKeys(value.completeness, ["currentDayPartial", "loggedDays"]) || value.completeness.currentDayPartial !== true || !finiteIn(value.completeness.loggedDays, 0, Number(value.periodDays))) return false;
  if (!isRecord(value.feeding) || !exactKeys(value.feeding, ["totalFeedLogs", "breastfeedLogs", "cupFeedLogs", "nightFeedLogs", "medianGapMinutes"])) return false;
  const feeding = value.feeding;
  if (!["totalFeedLogs", "breastfeedLogs", "cupFeedLogs", "nightFeedLogs"].every((key) => finiteIn(feeding[key], 0, 500)) || !finiteIn(feeding.medianGapMinutes, 0, 720, true)) return false;
  if (!Array.isArray(value.hourly) || value.hourly.length !== 24) return false;
  return value.hourly.every((item, index) => isRecord(item) && exactKeys(item, ["hour", "feedLogs", "breastfeedLogs", "cupFeedLogs", "activeMinutes", "activeDays"]) && item.hour === index && finiteIn(item.feedLogs, 0, 100) && finiteIn(item.breastfeedLogs, 0, 100) && finiteIn(item.cupFeedLogs, 0, 100) && finiteIn(item.activeMinutes, 0, 60) && finiteIn(item.activeDays, 0, Number(value.periodDays)));
}

function withinRateLimit(request: Request): boolean {
  const key = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const current = counters.get(key);
  if (!current || current.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  current.count += 1;
  return current.count <= 12;
}

function extractJson(content: unknown): unknown {
  if (isRecord(content)) return content;
  if (typeof content !== "string") throw new Error("missing model content");
  return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateResult(value: unknown, allowedSourceIds: Set<string>): JsonRecord | null {
  if (!isRecord(value) || !exactKeys(value, ["status", "summary", "basis", "schedule", "tips", "adjustments", "limitations"]) || value.status !== "ok" || typeof value.summary !== "string" || value.summary.length > 360 || typeof value.basis !== "string" || value.basis.length > 700 || !Array.isArray(value.schedule) || value.schedule.length < 4 || value.schedule.length > 8 || !Array.isArray(value.tips) || value.tips.length < 4 || value.tips.length > 6 || !Array.isArray(value.adjustments) || value.adjustments.length > 5 || !Array.isArray(value.limitations) || value.limitations.length > 5) return null;
  const schedule = value.schedule.map((block) => {
    if (!isRecord(block) || !exactKeys(block, ["start", "end", "baby", "mum", "dad", "rationale", "sourceIds"]) || !validTime(block.start) || !validTime(block.end) || ![block.baby, block.mum, block.dad, block.rationale].every((item) => typeof item === "string" && item.length > 0 && item.length <= 300) || !Array.isArray(block.sourceIds) || !block.sourceIds.length || block.sourceIds.some((id) => typeof id !== "string" || !allowedSourceIds.has(id))) return null;
    return { start: block.start, end: block.end, baby: block.baby, mum: block.mum, dad: block.dad, rationale: block.rationale, sourceIds: [...new Set(block.sourceIds)] };
  });
  const tips = value.tips.map((tip) => {
    if (!isRecord(tip) || !exactKeys(tip, ["title", "guidance", "sourceIds"]) || typeof tip.title !== "string" || !tip.title.trim() || tip.title.length > 80 || typeof tip.guidance !== "string" || !tip.guidance.trim() || tip.guidance.length > 320 || !Array.isArray(tip.sourceIds) || !tip.sourceIds.length || tip.sourceIds.some((id) => typeof id !== "string" || !allowedSourceIds.has(id))) return null;
    return { title: tip.title, guidance: tip.guidance, sourceIds: [...new Set(tip.sourceIds)] };
  });
  if (schedule.some((block) => block === null) || tips.some((tip) => tip === null) || !value.adjustments.every((item) => typeof item === "string" && item.length <= 240) || !value.limitations.every((item) => typeof item === "string" && item.length <= 240)) return null;
  const text = [value.summary, value.basis, ...schedule.flatMap((block) => block ? [block.baby, block.mum, block.dad, block.rationale] : []), ...tips.flatMap((tip) => tip ? [tip.title, tip.guidance] : []), ...value.adjustments, ...value.limitations].join(" ");
  if (/\b(delay|skip|withhold)\b[^.]{0,50}\b(feed|feeding|care)\b|\blet (?:the )?baby cry\b|\bguarantee(?:d)?\b|\bsleep through\b|\b(?:sling|carrier)\b|\bsleep with (?:the )?baby\b/i.test(text)) return null;
  return { status: "ok", summary: value.summary, basis: value.basis, schedule, tips, adjustments: value.adjustments, limitations: value.limitations };
}

function peakHours(payload: JsonRecord): number[] {
  const hourly = Array.isArray(payload.hourly) ? payload.hourly.filter(isRecord) : [];
  return hourly.slice().sort((a, b) => Number(b.feedLogs) * 20 + Number(b.activeMinutes) - (Number(a.feedLogs) * 20 + Number(a.activeMinutes))).slice(0, 4).map((item) => Number(item.hour)).sort((a, b) => a - b);
}

function fallback(payload: JsonRecord): JsonRecord {
  const feeding = isRecord(payload.feeding) ? payload.feeding : {};
  const peaks = peakHours(payload);
  const peakText = peaks.length ? peaks.map((hour) => `${String(hour).padStart(2, "0")}:00`).join(", ") : "no repeated time window yet";
  const mostlyBreast = Number(feeding.breastfeedLogs || 0) > Number(feeding.cupFeedLogs || 0);
  const baby = "Follow sleep, hunger and comfort cues; use the clear, flat sleep space whenever baby sleeps.";
  const blocks = [
    ["20:00", "23:00", baby, "Protected first rest block after any needed feed.", "On call for changing, settling and household tasks."],
    ["23:00", "02:00", baby, mostlyBreast ? "Feed responsively if needed; return to rest while Dad settles." : "Protected rest unless a handover is needed.", mostlyBreast ? "Bring baby for feeds, then handle changing and settling." : "Primary on-call caregiver, including a prepared cup feed if appropriate."],
    ["02:00", "05:00", baby, "Protected rest between any feeds that only Mum can provide.", "Primary on-call caregiver; handle all non-feeding care and settling."],
    ["05:00", "08:00", baby, "On call for responsive feeding and early-morning care.", "Protected rest block."],
    ["08:00", "14:00", baby, "Take one rest opportunity when baby sleeps.", "Lead one care block so Mum can rest, eat or shower."],
    ["14:00", "20:00", baby, "Take another rest opportunity before the first night block.", "Prepare the night handover and cover a care window."],
  ].map(([start, end, babyText, mum, dad], index) => ({ start, end, baby: babyText, mum, dad, rationale: index < 4 ? `Night duty is divided into short blocks; the busiest recorded hours were ${peakText}.` : "Daytime rest opportunities protect against relying on one long newborn sleep.", sourceIds: ["nhsSleep", "nhsParentRest", "lullabySleep"] }));
  return {
    status: "ok",
    summary: "A flexible care rota with alternating protected rest blocks.",
    basis: `${Number(payload.completeness && isRecord(payload.completeness) ? payload.completeness.loggedDays : 0)} logged day(s), ${Number(feeding.totalFeedLogs || 0)} feed logs and the recorded hourly activity pattern were considered. Baby timing remains cue-led.`,
    schedule: blocks,
    tips: [
      { title: "Set up each handover", guidance: "Before a protected rest block, agree who is on duty and put nappies, muslins, feeding supplies and water within reach. Keep feeds responsive to baby's cues.", sourceIds: ["nhsParentRest", "nhsResponsiveFeeding"] },
      { title: "Use a settling sequence", guidance: "Check hunger, nappy, wind and temperature first. Then dim the lights, reduce talking and try one calm step such as holding, gentle rocking or a quiet lullaby before putting baby back in their sleep space.", sourceIds: ["nhsSoothing", "nhsSleep"] },
      { title: "Keep night care low-key", guidance: "Use low lights and quiet voices, avoid play, and only change baby when needed. Put baby back in their sleep space after feeding and changing.", sourceIds: ["nhsSleep"] },
      { title: "Protect the off-duty parent", guidance: "Around breastfeeding, Dad can handle bringing baby, nappies and settling so Mum can return to sleep. Use the rota to make the protected block explicit.", sourceIds: ["nhsParentRest"] },
      { title: "Reset before fatigue becomes unsafe", guidance: "If the on-duty parent may fall asleep while holding baby, swap caregiver or place baby on their back in their own clear, flat, firm sleep space in the same room. Never sleep with baby on a sofa or chair.", sourceIds: ["lullabySleep"] },
      { title: "Pause if crying overwhelms you", guidance: "If the crying is making the on-duty parent stressed, place baby safely in their cot, step away briefly to calm down, then return or hand over. Never shake a baby.", sourceIds: ["nhsSoothing"] },
      { title: "Rerun when the pattern changes", guidance: "Newborn sleep varies and changes. Treat this as a handover plan, not a target for baby, and generate it again after several new logs or a disrupted day.", sourceIds: ["nhsSleep"] },
    ],
    adjustments: ["Swap Mum and Dad blocks when either parent is too tired to provide safe care.", "Regenerate after several more logs or whenever the pattern changes.", "Follow any feeding or waking plan from the maternity or neonatal team instead of this rota."],
    limitations: ["Unlogged activity is unknown and appears as quiet time.", "This plan organises adult rest; it does not predict or prescribe baby sleep.", "The model does not know either parent's work, health or medication needs."],
  };
}

function addScheduleGuide(result: JsonRecord): JsonRecord {
  const schedule = Array.isArray(result.schedule) ? result.schedule : [];
  const firstBlock = schedule.find(isRecord);
  if (!firstBlock || typeof firstBlock.start !== "string" || typeof firstBlock.end !== "string") return result;
  const sourceIds = Array.isArray(firstBlock.sourceIds) ? firstBlock.sourceIds.filter((id): id is string => typeof id === "string") : ["nhsSleep"];
  const guide = {
    title: `Start with the ${firstBlock.start}–${firstBlock.end} block`,
    guidance: `Before ${firstBlock.start}, agree who is on duty and prepare the supplies for this block. Follow Baby's cues during it; when it ends at ${firstBlock.end}, hand over the care tasks and protected rest exactly as shown in the rota.`,
    sourceIds: sourceIds.length ? sourceIds : ["nhsSleep"],
  };
  const tips = Array.isArray(result.tips) ? result.tips.filter(isRecord) : [];
  return { ...result, tips: [guide, ...tips].slice(0, 6) };
}

function responseFormat(): JsonRecord {
  const block = {
    type: "object",
    properties: {
      start: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" },
      end: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" },
      baby: { type: "string" }, mum: { type: "string" }, dad: { type: "string" }, rationale: { type: "string" },
      sourceIds: { type: "array", items: { type: "string" } },
    },
    required: ["start", "end", "baby", "mum", "dad", "rationale", "sourceIds"], additionalProperties: false,
  };
  const tip = {
    type: "object",
    properties: { title: { type: "string" }, guidance: { type: "string" }, sourceIds: { type: "array", items: { type: "string" } } },
    required: ["title", "guidance", "sourceIds"], additionalProperties: false,
  };
  return { type: "json_schema", json_schema: { name: "family_sleep_plan", strict: true, schema: { type: "object", properties: { status: { type: "string", enum: ["ok"] }, summary: { type: "string" }, basis: { type: "string" }, schedule: { type: "array", minItems: 4, maxItems: 8, items: block }, tips: { type: "array", minItems: 4, maxItems: 6, items: tip }, adjustments: { type: "array", items: { type: "string" } }, limitations: { type: "array", items: { type: "string" } } }, required: ["status", "summary", "basis", "schedule", "tips", "adjustments", "limitations"], additionalProperties: false } } };
}

function trustedUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !TRUSTED_DOMAINS.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function liveEvidence(): Promise<Array<{ id: string; name: string; url: string; evidence: string }>> {
  const apiKey = Deno.env.get("TAVILY_API_KEY");
  if (!apiKey) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await fetch("https://api.tavily.com/search", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ query: "UK newborn sleep parent tiredness sharing night care responsive feeding safer sleep guidance", search_depth: "basic", max_results: 4, include_answer: false, include_raw_content: false, include_images: false, include_domains: TRUSTED_DOMAINS, country: "united kingdom", language: "en", safe_search: true }), signal: controller.signal });
    if (!response.ok) return [];
    const body = await response.json();
    const seen = new Set<string>();
    return (Array.isArray(body?.results) ? body.results : []).flatMap((item: unknown) => {
      if (!isRecord(item)) return [];
      const url = trustedUrl(item.url), evidence = typeof item.content === "string" ? item.content.trim().slice(0, 1600) : "";
      if (!url || !evidence || seen.has(url)) return [];
      seen.add(url);
      return [{ id: `live${seen.size}`, name: typeof item.title === "string" ? item.title.slice(0, 150) : new URL(url).hostname, url, evidence }];
    }).slice(0, 4);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") {
    if (!ALLOWED_ORIGINS.has(origin)) return json(403, { code: "origin_not_allowed" });
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization, x-client-info, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS", "access-control-max-age": "86400", vary: "origin" } });
  }
  if (request.method !== "POST") return json(405, { code: "method_not_allowed" }, origin);
  if (!ALLOWED_ORIGINS.has(origin)) return json(403, { code: "origin_not_allowed" });
  if (!withinRateLimit(request)) return json(429, { code: "rate_limited", message: "Please try again later." }, origin);
  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 16_000) return json(413, { code: "payload_too_large" }, origin);
    payload = JSON.parse(raw);
  } catch {
    return json(400, { code: "invalid_json" }, origin);
  }
  if (!validPayload(payload)) return json(400, { code: "invalid_payload", message: "Only the de-identified sleep-plan schema is accepted." }, origin);
  const apiUrl = Deno.env.get("AI_API_URL"), apiKey = Deno.env.get("AI_API_KEY"), model = Deno.env.get("AI_MODEL");
  if (!apiUrl || !apiKey || !model) return json(503, { code: "provider_not_configured", message: "The AI service is not configured." }, origin);
  const searched = await liveEvidence();
  const evidence = [...Object.entries(SOURCES).map(([id, source]) => ({ id, ...source })), ...searched];
  const allowedSourceIds = new Set(evidence.map((source) => source.id));
  const fallbackResponse = () => {
    const result = addScheduleGuide(fallback(payload));
    const limitations = Array.isArray(result.limitations) ? result.limitations : [];
    result.limitations = [...limitations, "Live AI wording was unavailable, so this cautious rota uses the recorded pattern and reviewed guidance only."];
    return json(200, { ...result, generation: { mode: "verified_fallback" }, retrieval: { mode: searched.length ? "live_search" : "reviewed_sources", liveSourceCount: searched.length }, sources: Object.fromEntries(evidence.map((source) => [source.id, { name: source.name, url: source.url }])) }, origin);
  };
  const system = `Create a practical 24-hour rest and care rota for Mum, Dad and a newborn from de-identified aggregate logs and supplied evidence. This is a flexible parent handover plan, never a baby sleep-training or feeding schedule. Baby sleep and feeding remain responsive to cues and any individual clinical plan. Never advise delaying, skipping or withholding a feed or care. Never infer unlogged events. Describe quieter and busier recorded windows only, never guaranteed sleep. Protect rest for both parents. When breastfeeds predominate, Dad should handle bringing baby, changing and settling around feeds so Mum can return to sleep; never imply Dad can replace a breastfeed. Each block must say what Baby, Mum and Dad do. Include safer-sleep basics without claiming the logs prove safety. Add 4 to 6 concise, practical tips that help this family carry out the generated rota. Include a concrete settling sequence: check hunger, nappy, wind and temperature; reduce light and talking; try one calm method such as holding, gentle rocking or a quiet lullaby; then return baby to the sleep space. Include a short reset step for overwhelming crying. Cover handover preparation, protected rest, low-stimulation night care and what to do if fatigue makes holding baby unsafe. If a caregiver may fall asleep, advise swapping caregiver or placing baby on their back in their own clear, flat, firm sleep space in the same room. Never suggest a sling, carrier, sofa, chair or adult bed as a fatigue or sleep solution. Tips must be actionable and specific to using the rota, not generic filler. Do not diagnose or claim a pattern is normal, safe, healthy or adequate. Use only supplied source IDs and cite at least one source per block and per tip. Return only the requested JSON.`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22_000);
  try {
    const groq = new URL(apiUrl).hostname === "api.groq.com";
    const providerOptions = groq ? { max_completion_tokens: 4_000, reasoning_effort: "low", reasoning_format: "hidden", response_format: responseFormat() } : { max_tokens: 1_500, response_format: { type: "json_object" } };
    const response = await fetch(apiUrl, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model, temperature: 0.1, ...providerOptions, messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ aggregates: payload, evidence }) }] }), signal: controller.signal });
    const providerText = await response.text();
    if (!response.ok) return fallbackResponse();
    const providerBody = JSON.parse(providerText);
    const content = providerBody?.choices?.[0]?.message?.content ?? providerBody?.output?.[0]?.content?.[0]?.text;
    const verified = validateResult(extractJson(content), allowedSourceIds);
    const result = addScheduleGuide(verified || fallback(payload));
    return json(200, { ...result, generation: { mode: verified ? "verified_model" : "verified_fallback" }, retrieval: { mode: searched.length ? "live_search" : "reviewed_sources", liveSourceCount: searched.length }, sources: Object.fromEntries(evidence.map((source) => [source.id, { name: source.name, url: source.url }])) }, origin);
  } catch (error) {
    return fallbackResponse();
  } finally {
    clearTimeout(timeout);
  }
});
