import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../../config/env";
import { logAgentRawOutput } from "../runtime";
import { getMissionModelConfig, missionCloseoutGraph, missionInterpretationGraph, missionPlanningGraph, MissionAgent, normalizeMissionDeadline, summarizeWeather, validateGeneratedPlans } from "./mission-agent";

test("accepts a configured Gemini model", () => {
  assert.deepEqual(getMissionModelConfig({ AI_PROVIDER: "gemini", AI_API_KEY: "key", AI_MODEL: "gemini-3.1-flash-lite" }), {
    provider: "gemini", apiKey: "key", model: "gemini-3.1-flash-lite",
  });
  assert.throws(() => getMissionModelConfig({ AI_PROVIDER: "openai", AI_API_KEY: "key", AI_MODEL: "gemini-3.1-flash-lite" }), /must equal gemini/);
  assert.throws(() => getMissionModelConfig({ AI_PROVIDER: "gemini", AI_MODEL: "gemini-3.1-flash-lite" }), /AI_API_KEY and AI_MODEL/);
});

test("rejects generated activities with an invalid calendar schedule", () => {
  const plan = {
    name: "Harvest", summary: "Harvest shallots", recommended: true, assumptions: ["Drying estimate"], risks: {}, dryingEstimateDays: 4, dryingEstimateReason: "Traditional drying estimate.",
    activities: [{ title: "Pick", description: "Harvest", scheduleType: "DAILY_WINDOW" as const, startsOn: "2026-07-15", endsOn: "2026-07-15", windowStart: "09:00", windowEnd: "08:00", timezone: "Asia/Jakarta", isConditional: false, stage: "HARVESTING" as const }],
  };
  const threePlans = (value: Parameters<typeof validateGeneratedPlans>[0][number]) => [value, { ...value, name: `${value.name} alternative 1`, recommended: false }, { ...value, name: `${value.name} alternative 2`, recommended: false }];
  assert.throws(() => validateGeneratedPlans(threePlans(plan)), /increasing time window/);
  const validHarvest = { ...plan.activities[0], windowEnd: "10:00" };
  assert.throws(() => validateGeneratedPlans(threePlans({ ...plan, activities: [{ ...validHarvest, timezone: "not/a-timezone" }] })), /IANA timezone/);
  assert.throws(() => validateGeneratedPlans(threePlans({ ...plan, activities: [{ ...validHarvest, timezone: "UTC" }] }), "Asia/Jakarta"), /farm timezone/);
  assert.throws(() => validateGeneratedPlans(threePlans({ ...plan, activities: [{ ...validHarvest, scheduleType: "DATE_RANGE" as const, windowStart: null, windowEnd: null }] })), /Harvesting activities/);
  assert.doesNotThrow(() => validateGeneratedPlans(threePlans({ ...plan, activities: [validHarvest, { title: "Dry", description: "Drying estimate", scheduleType: "DATE_RANGE", startsOn: "2026-07-15", endsOn: "2026-07-19", windowStart: null, windowEnd: null, timezone: "Asia/Jakarta", isConditional: true, stage: "DRYING" }] }), "Asia/Jakarta"));
});

test("requires exactly three uniquely named plans and one recommendation", () => {
  const plan = { name: "Early harvest", summary: "Harvest", recommended: true, assumptions: [], risks: {}, dryingEstimateDays: 4, dryingEstimateReason: "Dry weather", activities: [{ title: "Harvest", description: "Pick", scheduleType: "DAILY_WINDOW" as const, startsOn: "2026-07-15", endsOn: "2026-07-15", windowStart: "08:00", windowEnd: "10:00", timezone: "Asia/Jakarta", isConditional: false, stage: "HARVESTING" as const }] };
  assert.throws(() => validateGeneratedPlans([plan]), /exactly three/);
  assert.throws(() => validateGeneratedPlans([plan, { ...plan, name: "Before rain", recommended: true }, { ...plan, name: "After rain", recommended: false }]), /exactly one recommendation/);
  assert.throws(() => validateGeneratedPlans([plan, { ...plan, recommended: false }, { ...plan, name: "After rain", recommended: false }]), /distinct names/);
});

test("instructs the planner to return three options and extend drying for rain", async () => {
  const plan = { name: "Early harvest", summary: "Harvest", recommended: true, assumptions: ["Rain adds a day"], risks: { rain: "Drying is delayed" }, dryingEstimateDays: 5, dryingEstimateReason: "Rain adds drying time.", activities: [{ title: "Harvest", description: "Pick", scheduleType: "DAILY_WINDOW" as const, startsOn: "2026-07-15", endsOn: "2026-07-15", windowStart: "08:00", windowEnd: "10:00", timezone: "Asia/Jakarta", isConditional: false, stage: "HARVESTING" as const }, { title: "Dry", description: "Dry", scheduleType: "DATE_RANGE" as const, startsOn: "2026-07-15", endsOn: "2026-07-20", windowStart: null, windowEnd: null, timezone: "Asia/Jakarta", isConditional: true, stage: "DRYING" as const }] };
  let prompt = "";
  const agent = new MissionAgent(() => ({ withStructuredOutput: () => ({ invoke: async (value: Array<{ content: unknown }>) => { prompt = value.map((message) => String(message.content)).join("\n"); return { plans: [plan, { ...plan, name: "Before rain", recommended: false }, { ...plan, name: "After rain", recommended: false }] }; } }) }) as never);
  await agent.plan({ candidate: { facts: { deadline: "2026-07-18T16:59:59.999Z" } } }, { timezone: "Asia/Jakarta", hourly: { time: ["2026-07-15T00:00"], precipitation_probability: [90], precipitation: [8], wind_speed_10m: [5] } }, "Asia/Jakarta");
  assert.match(prompt, /exactly three meaningful, distinct/);
  assert.match(prompt, /exactly one marked recommended/);
  assert.match(prompt, /Forecast rain must directly extend the drying estimate and the DRYING date range/);
  assert.match(prompt, /rain-adjusted deadline/);
  assert.match(prompt, /Hijau AI backend agent/);
});

test("logs the raw planner response through the shared runtime when debugging is enabled", async () => {
  const plan = { name: "Early harvest", summary: "Harvest", recommended: true, assumptions: [], risks: {}, dryingEstimateDays: 4, dryingEstimateReason: "Dry", activities: [{ title: "Harvest", description: "Pick", scheduleType: "DAILY_WINDOW" as const, startsOn: "2026-07-15", endsOn: "2026-07-15", windowStart: "08:00", windowEnd: "10:00", timezone: "Asia/Jakarta", isConditional: false, stage: "HARVESTING" as const }] };
  const previousDebug = env.agentDebugRawOutput; const previousInfo = console.info; const previousDir = console.dir; const calls: unknown[][] = [];
  env.agentDebugRawOutput = true;
  console.info = (...args: unknown[]) => { calls.push(args); };
  console.dir = (...args: unknown[]) => { calls.push(args); };
  try {
    const agent = new MissionAgent(() => ({ withStructuredOutput: (_schema: unknown, options: { includeRaw?: boolean }) => ({ invoke: async () => { assert.equal(options.includeRaw, true); return { raw: { content: '{"provider":"raw"}' }, parsed: { plans: [plan, { ...plan, name: "Before rain", recommended: false }, { ...plan, name: "After rain", recommended: false }] } }; } }) }) as never);
    await agent.plan({}, {}, "Asia/Jakarta", "mission-raw");
  } finally {
    env.agentDebugRawOutput = previousDebug;
    console.info = previousInfo;
    console.dir = previousDir;
  }
  assert.deepEqual(calls, [["\n[agent raw output] agent=mission-planner runId=mission-raw"], ['{"provider":"raw"}', { depth: null }], ["[/agent raw output]\n"]]);
});

test("keeps only the relevant Open-Meteo forecast window for planning", () => {
  const summary = summarizeWeather({ timezone: "Asia/Jakarta", hourly: { time: ["2026-07-15T00:00", "2026-07-15T01:00"], precipitation_probability: [10, 80], precipitation: [0, 2], wind_speed_10m: [3, 9] } });
  assert.deepEqual(summary, { timezone: "Asia/Jakarta", hours: [{ time: "2026-07-15T00:00", precipitationProbability: 10, precipitation: 0, windSpeed: 3 }, { time: "2026-07-15T01:00", precipitationProbability: 80, precipitation: 2, windSpeed: 9 }] });
});

test("normalizes common relative mission deadlines against the farm timezone", () => {
  const now = new Date("2026-07-16T03:00:00.000Z");
  assert.equal(normalizeMissionDeadline("next week", "Asia/Jakarta", now), "2026-07-23T16:59:59.999Z");
  assert.equal(normalizeMissionDeadline("minggu depan", "Asia/Jakarta", now), "2026-07-23T16:59:59.999Z");
  assert.equal(normalizeMissionDeadline("besok", "Asia/Jakarta", now), "2026-07-17T16:59:59.999Z");
  assert.equal(normalizeMissionDeadline("when it feels ready", "Asia/Jakarta", now), null);
});

test("runs caller-scoped interpretation through the bounded workflow", async () => {
  const response = { fieldBlockId: null, cropBatchIds: [], buyerCommitmentId: null, maturity: null, buyerQuantityKg: null, marketQuality: null, plannedHarvestKg: null, plannedDriedKg: null, deadline: null, availableWorkerCount: null, coveredDryingCapacityKg: null, notes: null, clarification: { key: "field", question: "Which field?" } };
  const agent = new MissionAgent(() => ({ withStructuredOutput: () => ({ invoke: async () => response }) }) as never);
  const result = await agent.interpret("Help me harvest", { fields: [] });
  assert.equal(result.facts.clarification?.key, "field");
  assert.deepEqual(result.facts.cropBatchIds, []);
  assert.equal(result.review.find((item) => item.key === "fieldBlockId")?.status, "needs_clarification");
  assert.equal(result.review.find((item) => item.key === "notes")?.status, "missing");
});

test("gives interpretation a structured mission input and requires JSON only", async () => {
  const response = { fieldBlockId: null, cropBatchIds: [], buyerCommitmentId: null, maturity: null, buyerQuantityKg: null, marketQuality: null, plannedHarvestKg: null, plannedDriedKg: null, deadline: null, availableWorkerCount: null, coveredDryingCapacityKg: null, notes: null, clarification: { key: "fieldBlockId", question: "Which field should be harvested?" } };
  let prompt = "";
  const agent = new MissionAgent(() => ({ withStructuredOutput: () => ({ invoke: async (value: Array<{ content: unknown }>) => { prompt = value.map((message) => String(message.content)).join("\n"); return response; } }) }) as never, () => new Date("2026-07-16T03:00:00.000Z"));
  await agent.interpret("Harvest the north field", { farmer: { displayName: "Ayu" }, farm: { timezone: "Asia/Jakarta" }, fields: [{ fieldBlockId: "field-1", name: "North" }], cropBatches: [{ cropBatchId: "batch-1", fieldBlockId: "field-1" }], buyerCommitments: [], completedMissionHistory: [], conversation: [{ role: "farmer", content: "Harvest the north field" }], existingFacts: null });
  assert.match(prompt, /"farmer":\{"displayName":"Ayu"\}/);
  assert.match(prompt, /"fields":\[\{"fieldBlockId":"field-1"/);
  assert.match(prompt, /"conversation":\[\{"role":"farmer"/);
  assert.match(prompt, /"currentTime":\{"iso":"2026-07-16T03:00:00.000Z","timezone":"Asia\/Jakarta"\}/);
  assert.match(prompt, /no Markdown, explanation, or additional words/);
  assert.doesNotMatch(prompt, /"next week" means/);
});

test("exports every mission graph for LangGraph Studio", () => {
  assert.ok(missionInterpretationGraph);
  assert.ok(missionPlanningGraph);
  assert.ok(missionCloseoutGraph);
});

test("prints raw output with the agent name and run ID only when debugging is enabled", () => {
  const info = console.info; const dir = console.dir; const calls: unknown[][] = [];
  console.info = (...args: unknown[]) => { calls.push(args); };
  console.dir = (...args: unknown[]) => { calls.push(args); };
  try {
    logAgentRawOutput("mission-planner", "mission-1", '{"plans":[]}', true);
    logAgentRawOutput("mission-closeout", "mission-2", "hidden", false);
  } finally {
    console.info = info; console.dir = dir;
  }
  assert.deepEqual(calls, [["\n[agent raw output] agent=mission-planner runId=mission-1"], ['{"plans":[]}', { depth: null }], ["[/agent raw output]\n"]]);
});

test("marks complete required facts ready for planning", async () => {
  const response = { fieldBlockId: "00000000-0000-4000-8000-000000000001", cropBatchIds: ["00000000-0000-4000-8000-000000000002"], buyerCommitmentId: null, maturity: "ready", buyerQuantityKg: 40, marketQuality: "A", plannedHarvestKg: 50, plannedDriedKg: 35, deadline: "2026-07-20T08:00:00.000Z", availableWorkerCount: null, coveredDryingCapacityKg: null, notes: null, clarification: null };
  const agent = new MissionAgent(() => ({ withStructuredOutput: () => ({ invoke: async () => response }) }) as never);
  const result = await agent.interpret("Harvest when ready", {});
  assert.ok(result.review.filter((item) => !["notes", "buyerCommitmentId", "availableWorkerCount", "coveredDryingCapacityKg"].includes(item.key)).every((item) => item.status === "confirmed"));
});

test("rejects an empty structured planner response", async () => {
  const agent = new MissionAgent(() => ({ withStructuredOutput: () => ({ invoke: async () => "" }) }) as never);
  await assert.rejects(() => agent.plan({}, {}, "Asia/Jakarta"));
});

test("rejects invalid structured interpretation output", async () => {
  const agent = new MissionAgent(() => ({ withStructuredOutput: () => ({ invoke: async () => ({ objective: "Missing required fields" }) }) }) as never);
  await assert.rejects(() => agent.interpret("Help me harvest", { fields: [] }));
});

test("rejects OpenCode-style interpretation aliases instead of accepting them as facts", async () => {
  const response = { readiness: null, buyerQuantity: null, marketQuality: null, plannedHarvestKg: null, plannedDriedKg: null, deadline: null, workerAvailability: { defaultWorkerCount: 4 }, coveredDryingCapacity: null, notes: null, clarification: "Which field block do you want to harvest?" };
  const agent = new MissionAgent(() => ({ withStructuredOutput: () => ({ invoke: async () => response }) }) as never);
  await assert.rejects(() => agent.interpret("Help me harvest", { fields: [] }));
});
