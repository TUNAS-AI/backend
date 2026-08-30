import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Command, isInterrupted, MemorySaver } from "@langchain/langgraph";
import { buildOperationalGraph, classifyOperationalMessage, createOperationalReportExtractor, deterministicRoute, extractOperationalReport, isExpectedStateCurrent, operationalQueryAnswer, parseMutationProposal, structuredRoute, type OperationalDependencies } from "../../agent/operational-agent";
import { parseInteraction } from "./tunas.validation";
import { reportImpact, TunasRepository } from "./tunas.repository";
import { MissionService } from "../missions/mission.service";
import { operationalReportSchema } from "./operational-report";

const updatedAt = new Date("2026-08-27T10:00:00.000Z");
const mission = {
  missionId: "10000000-0000-4000-8000-000000000001", originalMessage: "Harvest Block East", status: "ACTIVE", stage: "HARVESTING", notes: "old", updatedAt, revision: 1, operationalReports: [],
  constraints: [{ key: "plannedHarvestKg", value: 80 }], closeout: null,
  missionSteps: [{ missionStepId: "20000000-0000-4000-8000-000000000001", sequence: 1, title: "Harvest", startsOn: new Date("2026-08-28"), endsOn: new Date("2026-08-28"), stage: "HARVESTING", status: "COMPLETED" }],
};

test("routes explicit operational triggers without model inference", () => {
  assert.equal(deterministicRoute("approve"), "APPROVAL");
  assert.equal(deterministicRoute("reject this"), "REJECTION");
  assert.equal(deterministicRoute("please close out the mission"), "CLOSEOUT");
  assert.equal(deterministicRoute("set mission notes to covered drying"), "UPDATE");
  assert.equal(deterministicRoute("what is next?"), "QUERY");
});

test("uses AI classification first and conservatively falls back on failures or invalid output", async () => {
  let calls = 0;
  assert.deepEqual(await classifyOperationalMessage("please help", async () => { calls++; return { intent: "QUERY" }; }), { trigger: "QUERY", routingSource: "AI", routingFailure: null });
  assert.deepEqual(await classifyOperationalMessage("set mission notes to dry", async () => { calls++; throw new Error("provider unavailable"); }), { trigger: "UPDATE", routingSource: "DETERMINISTIC_FALLBACK", routingFailure: "PROVIDER_FAILURE" });
  assert.deepEqual(await classifyOperationalMessage("what is next?", async () => { calls++; return { intent: "NEW_MISSION" }; }), { trigger: "QUERY", routingSource: "DETERMINISTIC_FALLBACK", routingFailure: "INVALID_OUTPUT" });
  assert.equal(calls, 3);
});

test("structured actions and scheduled triggers bypass AI routing", () => {
  assert.equal(structuredRoute("anything", "scheduled"), "SCHEDULED");
  assert.equal(structuredRoute("mulai hujan", "telegram", "UPDATE"), "UPDATE");
  assert.equal(structuredRoute("anything", "web", "APPROVAL"), "APPROVAL");
});

test("parses schema-backed previews and detects stale authoritative state", () => {
  assert.deepEqual(parseMutationProposal("set mission notes to covered drying", mission as never), { kind: "MISSION_NOTES", before: { notes: "old" }, after: { notes: "covered drying" }, expectedState: { updatedAt: updatedAt.toISOString(), notes: "old" } });
  assert.equal(parseMutationProposal("advance mission stage", mission as never)?.kind, "MISSION_STAGE");
  assert.equal(isExpectedStateCurrent(mission as never, { updatedAt: updatedAt.toISOString() }), true);
  assert.equal(isExpectedStateCurrent(mission as never, { updatedAt: new Date(updatedAt.getTime() + 1).toISOString() }), false);
});

test("grounded query response is read-only and includes progress, next work, target, and closeout", () => {
  const before = structuredClone(mission);
  const answer = operationalQueryAnswer(mission as never);
  assert.match(answer, /ACTIVE\/HARVESTING/);
  assert.match(answer, /1\/1 steps completed/);
  assert.match(answer, /plannedHarvestKg: 80/);
  assert.match(answer, /Closeout: not ready/);
  assert.deepEqual(mission, before);
});

test("interaction identity accepts externalMessageId or Idempotency-Key", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  assert.equal(parseInteraction({ message: "status", externalMessageId: "web-1" }, undefined).externalMessageId, "web-1");
  assert.equal(parseInteraction({ message: "status", missionId: id }, "retry-1").externalMessageId, "retry-1");
  assert.throws(() => parseInteraction({ message: "status" }, undefined), /externalMessageId or Idempotency-Key/);
});

test("strictly validates every report payload and structured interaction shape", () => {
  const valid = { reportType: "WORKER_AVAILABILITY_CHANGED", observedAt: updatedAt.toISOString(), payload: { availableWorkers: 0 } };
  assert.deepEqual(operationalReportSchema.parse(valid).payload, { availableWorkers: 0 });
  assert.equal(operationalReportSchema.safeParse({ ...valid, payload: { availableWorkers: 1.5 } }).success, false);
  assert.equal(operationalReportSchema.safeParse({ ...valid, payload: { availableWorkers: 1, productivity: 4 } }).success, false);
  assert.throws(() => parseInteraction({ message: "x", report: valid, externalMessageId: "both" }, undefined), /exactly one/);
  assert.throws(() => parseInteraction({ report: valid, externalMessageId: "missing-mission" }, undefined), /missionId is required/);
  assert.equal(parseInteraction({ report: valid, missionId: mission.missionId, externalMessageId: "report-1" }, undefined).report?.reportType, "WORKER_AVAILABILITY_CHANGED");
});

test("report specialist returns one report or null and normalizes observed time", async () => {
  let prompt = "";
  const extractor = createOperationalReportExtractor(() => ({ withStructuredOutput: () => ({ invoke: async (messages: Array<{ content: unknown }>) => { prompt = messages.map((item) => String(item.content)).join("\n"); return { report: { reportType: "RAIN_OR_FIELD_EVENT", observedAt: "2020-01-01T00:00:00.000Z", payload: { event: "hujan", observedAt: "2020-01-01T00:00:00.000Z" } }, clarification: null }; } }) }));
  const report = await extractOperationalReport("hujan", mission as never, extractor, updatedAt);
  assert.equal(report.report?.reportType, "RAIN_OR_FIELD_EVENT");
  assert.equal(report.report?.observedAt, updatedAt.toISOString());
  await extractor("kendala lapangan", mission as never);
  assert.match(prompt, /bukan ACTIVITY_STARTED/);
  assert.deepEqual(await extractOperationalReport("test", mission as never, async () => ({ report: null, clarification: "Apa yang terjadi di lapangan?" }), updatedAt), { report: null, clarification: "Apa yang terjadi di lapangan?" });
});

test("evaluates only specified operational impacts", () => {
  assert.equal(reportImpact({ reportType: "GENERAL_OPERATIONAL_NOTE", observedAt: updatedAt.toISOString(), payload: { text: "ok" } }, mission as never).level, "NONE");
  assert.equal(reportImpact({ reportType: "BUYER_REQUIREMENT_CHANGED", observedAt: updatedAt.toISOString(), payload: { targetQuantityKg: 90, quantityBasis: "DRIED" } }, mission as never).level, "MATERIAL");
  const active = { ...mission, missionSteps: [{ ...mission.missionSteps[0], status: "IN_PROGRESS" }] };
  assert.equal(reportImpact({ reportType: "WORKER_AVAILABILITY_CHANGED", observedAt: updatedAt.toISOString(), payload: { availableWorkers: 0 } }, active as never).level, "MATERIAL");
  const rain = reportImpact({ reportType: "RAIN_OR_FIELD_EVENT", observedAt: "2026-08-28T08:00:00.000Z", payload: { event: "hujan", observedAt: "2026-08-28T08:00:00.000Z" } }, active as never);
  assert.equal(rain.level, "MATERIAL");
  assert.equal(rain.replanSupported, true);
});

test("operational schema enforces duplicate protection and append-only timeline storage", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const repository = readFileSync("src/features/tunas/tunas.repository.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20260827120000_add_operational_interactions/migration.sql", "utf8");
  assert.match(schema, /@@unique\(\[farmId, channel, externalMessageId\]\)/);
  assert.match(schema, /model PendingAction/);
  assert.match(schema, /model OperationalEvent/);
  assert.match(schema, /model OperationalReport/);
  assert.match(schema, /revision\s+Int\s+@default\(1\)/);
  assert.match(migration, /CREATE TABLE public\.operational_events/);
  assert.doesNotMatch(migration, /UPDATE public\.operational_events|DELETE FROM public\.operational_events/i);
  const reportsMigration = readFileSync("prisma/migrations/20260827160000_add_operational_reports/migration.sql", "utf8");
  assert.match(reportsMigration, /CREATE TABLE public\.operational_reports/);
  assert.match(reportsMigration, /ADD COLUMN revision integer NOT NULL DEFAULT 1/);
  const telegramMigration = readFileSync("prisma/migrations/20260828120000_expand_telegram_actions/migration.sql", "utf8");
  assert.match(telegramMigration, /ADD COLUMN payload jsonb/);
  assert.match(telegramMigration, /CREATE UNIQUE INDEX telegram_actions_external_message_id_key/);
  assert.doesNotMatch(repository, /operationalInteraction\.create\(\{ data: \{ \.\.\.input/);
});

test("structured reports bypass both classifier and extractor", async () => {
  let classifierCalls = 0; let extractorCalls = 0;
  const fixture = graphFixture(async () => { classifierCalls++; return { intent: "UNKNOWN" }; });
  const config = { configurable: { thread_id: "structured-report" } };
  const waiting = await fixture.graph.invoke({ ...initial, structuredReport: { reportType: "GENERAL_OPERATIONAL_NOTE", observedAt: updatedAt.toISOString(), payload: { text: "covered" } } }, config);
  assert.equal(isInterrupted(waiting), true);
  assert.equal(classifierCalls, 0);
  assert.equal(extractorCalls, 0);
});

function graphFixture(classifier: OperationalDependencies["classifier"] = async () => ({ intent: "UPDATE" })) {
  let revision = 1; let pendingStatus = "PENDING"; let pending: Record<string, unknown> | null = null; let writes = 0;
  const repository = {
    mission: async () => ({ ...mission, revision }), currentMission: async () => ({ ...mission, revision }), auditRoute: async () => undefined, auditResponse: async () => undefined,
    openPending: async () => pending,
    ensurePending: async (input: Record<string, unknown>) => pending ??= { ...input, pendingActionId: "30000000-0000-4000-8000-000000000001", operationalThreadId: input.threadId, operationalInteractionId: input.interactionId, status: pendingStatus },
    resolveClarification: async () => { pendingStatus = "CLARIFIED"; pending = null; },
    pending: async () => pending ? { ...pending, status: pendingStatus, expectedState: (pending as { expectedState?: unknown }).expectedState, preview: (pending as { preview: unknown }).preview, thread: { channel: "web" } } : null,
    acceptReport: async (input: { expectedRevision: number }) => input.expectedRevision !== revision ? null : (writes++, revision++, pendingStatus = "APPROVED", { report: {}, impact: { level: "NONE", reasons: [], replanSupported: false }, pending: { ...pending, status: pendingStatus, preview: (pending as { preview: unknown }).preview } }),
    resolvePending: async (input: { status: string }) => ({ ...pending, status: pendingStatus = input.status, preview: (pending as { preview: unknown }).preview }),
  } as unknown as TunasRepository;
  const graph = buildOperationalGraph({ repository, missions: {} as MissionService, classifier, reportExtractor: async (message) => /note|covered/i.test(message) ? { report: { reportType: "GENERAL_OPERATIONAL_NOTE", observedAt: updatedAt.toISOString(), payload: { text: message } }, clarification: null } : { report: null, clarification: "Apa yang ingin Anda laporkan?" } }, new MemorySaver());
  return { graph, values: () => ({ revision, pendingStatus, writes }), stale: () => revision++ };
}

const initial = { ownerId: "owner", farmId: "farm", missionId: mission.missionId, threadId: "thread", interactionId: "interaction-1", message: "note: covered drying", channel: "web" };

test("graph interrupts for approval and Command resume applies the revalidated mutation", async () => {
  const fixture = graphFixture(); const config = { configurable: { thread_id: "approval-thread" } };
  const waiting = await fixture.graph.invoke(initial, config);
  assert.equal(isInterrupted(waiting), true);
  const completed = await fixture.graph.invoke(new Command({ resume: { kind: "APPROVAL" } }) as never, config);
  assert.equal(completed.response?.pendingAction?.status, "APPROVED");
  assert.deepEqual(fixture.values(), { revision: 2, pendingStatus: "APPROVED", writes: 1 });
});

test("graph resumes clarification on the same checkpoint and then waits for approval", async () => {
  const fixture = graphFixture(); const config = { configurable: { thread_id: "clarification-thread" } };
  const waiting = await fixture.graph.invoke({ ...initial, message: "change it" }, config);
  assert.equal(isInterrupted(waiting), true);
  const proposed = await fixture.graph.invoke(new Command({ resume: { kind: "INTERACTION", message: "note: covered drying", interactionId: "interaction-2" } }) as never, config);
  assert.equal(isInterrupted(proposed), true);
  assert.equal(fixture.values().writes, 0);
});

test("rejection and stale approval structurally perform no mutation", async () => {
  const rejected = graphFixture(); const rejectConfig = { configurable: { thread_id: "reject-thread" } };
  await rejected.graph.invoke(initial, rejectConfig);
  const result = await rejected.graph.invoke(new Command({ resume: { kind: "REJECTION" } }) as never, rejectConfig);
  assert.equal(result.response?.pendingAction?.status, "REJECTED"); assert.equal(rejected.values().writes, 0);

  const stale = graphFixture(); const staleConfig = { configurable: { thread_id: "stale-thread" } };
  const waiting = await stale.graph.invoke(initial, staleConfig); const value = (waiting as unknown as { __interrupt__: Array<{ value: { pendingActionId: string } }> }).__interrupt__[0].value;
  assert.ok(value.pendingActionId);
  stale.stale();
  const staleResult = await stale.graph.invoke(new Command({ resume: { kind: "APPROVAL" } }) as never, staleConfig);
  assert.equal(staleResult.response?.pendingAction?.status, "STALE"); assert.equal(stale.values().writes, 0);
});

test("LangGraph Studio exports the operational graph", () => {
  const config = JSON.parse(readFileSync("langgraph.json", "utf8")) as { graphs: Record<string, string> };
  assert.equal(config.graphs["operational-agent"], "./src/agent/operational-agent.ts:operationalGraph");
});
