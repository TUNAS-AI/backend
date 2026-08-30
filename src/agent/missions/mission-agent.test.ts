import assert from "node:assert/strict";
import test from "node:test";
import { missionCloseoutGraph, missionInterpretationGraph, missionPlanningGraph, MissionAgent } from "./mission-agent";

const candidate = { candidateId: "00000000-0000-4000-8000-000000000001", summary: "Panen 1 September", risks: { precipitationProbability: "10%" }, evidence: [{ evidenceId: "weather:harvest:2026-09-01", source: "WEATHER" as const, rule: "configured harvest weather policy", passed: true, value: 10 }], activities: [{ actionKind: "HARVEST", startsOn: "2026-09-01", windowStart: "06:30", windowEnd: "10:30" }] };

test("ranking receives complete activities and accepts grounded Indonesian reasons", async () => {
  let prompt = "";
  const agent = new MissionAgent(() => ({ withStructuredOutput: () => ({ invoke: async (messages: Array<{ content: unknown }>) => { prompt = messages.map((message) => String(message.content)).join("\n"); return { ranking: [{ candidateId: candidate.candidateId, reasons: [{ text: "Risiko hujan paling rendah.", evidenceRefs: [candidate.evidence[0].evidenceId] }] }] }; } }) }) as never);
  const ranking = await agent.rank([candidate], { responseLanguage: "id" });
  assert.equal(ranking[0].reasons[0].text, "Risiko hujan paling rendah.");
  assert.match(prompt, /\"activities\":\[\{\"actionKind\":\"HARVEST\"/);
  assert.match(prompt, /\"rule\":\"configured harvest weather policy\",\"passed\":true/);
  assert.match(prompt, /Never return, alter, or invent schedule content/);
});

test("ranking rejects unsupported evidence references", async () => {
  const agent = new MissionAgent(() => ({ withStructuredOutput: () => ({ invoke: async () => ({ ranking: [{ candidateId: candidate.candidateId, reasons: [{ text: "Tidak didukung.", evidenceRefs: ["invented"] }] }] }) }) }) as never);
  await assert.rejects(() => agent.rank([candidate], {}), /unsupported evidence/);
});

test("extracts only the essential MVP mission facts", async () => {
  const response = { fieldBlockId: "00000000-0000-4000-8000-000000000001", cropBatchIds: ["00000000-0000-4000-8000-000000000002"], readinessConfirmed: true, destination: "IMMEDIATE_SALE", plannedHarvestKg: 80, deadlineAt: "2026-10-05T03:00:00.000Z", notes: null, clarification: null };
  const agent = new MissionAgent(() => ({ withStructuredOutput: () => ({ invoke: async () => response }) }) as never);
  const result = await agent.interpret("Panen penuh dengan risiko hujan terendah", { responseLanguage: "id" });
  assert.equal(result.facts.readinessConfirmed, true);
  assert.equal(result.facts.plannedHarvestKg, 80);
});

test("normalizes an activity delay without letting the model edit timestamps", async () => {
  const missionStepId = "00000000-0000-4000-8000-000000000003";
  const agent = new MissionAgent(() => ({ withStructuredOutput: () => ({ invoke: async () => ({ type: "SHIFT_ACTIVITY", missionStepId, deltaMinutes: 120, fromDate: null, toDate: null, question: null }) }) }) as never);
  const result = await agent.interpretScheduleEdit("tunda pemeriksaan dua jam", { currentTime: "2026-08-29T00:00:00Z", timezone: "Asia/Jakarta", steps: [{ missionStepId, title: "Periksa kesiapan" }] });
  assert.deepEqual(result, { edit: { type: "SHIFT_ACTIVITY", missionStepId, deltaMinutes: 120 }, question: null });
});

test("exports bounded mission graphs", () => { assert.ok(missionInterpretationGraph); assert.ok(missionPlanningGraph); assert.ok(missionCloseoutGraph); });
