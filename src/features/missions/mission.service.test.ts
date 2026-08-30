import assert from "node:assert/strict";
import test from "node:test";
import { signPreview, verifyPreview } from "./mission-preview-token";
import { canAdvanceMissionStage, completedFieldHistory, interpretationUnavailable, isStepTransitionAllowed, logInterpretationFailure, logPlanningFailure, MissionService, missionVersionTimestamp, nextMissionStage, planningUnavailable } from "./mission.service";
import { parseCloseout, parsePreviewCandidate, parseReplanConfirmation } from "./mission.validation";

test("rejects a tampered mission preview", () => {
  const previous = process.env.MISSION_PREVIEW_SECRET;
  process.env.MISSION_PREVIEW_SECRET = "test-secret";
  try {
    const token = signPreview({ farmId: "farm" });
    assert.equal(verifyPreview<{ exp: number; farmId: string }>(token).farmId, "farm");
    assert.throws(() => verifyPreview(`${token}x`), /invalid/);
  } finally {
    if (previous === undefined) delete process.env.MISSION_PREVIEW_SECRET; else process.env.MISSION_PREVIEW_SECRET = previous;
  }
});

test("only permits the ordered active mission lifecycle", () => {
  assert.equal(nextMissionStage("WAITING"), "HARVESTING");
  assert.equal(nextMissionStage("HARVESTING"), "DRYING");
  assert.equal(nextMissionStage("DRYING"), "FINISHED");
  assert.equal(nextMissionStage("FINISHED"), "TO_REVIEW");
  assert.equal(nextMissionStage("TO_REVIEW"), undefined);
});

test("requires ordered step progress before advancing operational stages", () => {
  const steps = [
    { missionStepId: "step-1", sequence: 1, stage: "HARVESTING" as const, status: "SCHEDULED" as const },
    { missionStepId: "step-2", sequence: 2, stage: "HARVESTING" as const, status: "SCHEDULED" as const },
    { missionStepId: "step-3", sequence: 3, stage: "DRYING" as const, status: "SCHEDULED" as const },
  ];
  assert.equal(canAdvanceMissionStage("WAITING", steps), true);
  assert.equal(canAdvanceMissionStage("HARVESTING", steps), false);
  assert.equal(isStepTransitionAllowed(steps[0], "IN_PROGRESS", steps), true);
  assert.equal(isStepTransitionAllowed(steps[0], "COMPLETED", steps), true);
  assert.equal(isStepTransitionAllowed(steps[1], "IN_PROGRESS", steps), false);
  const harvestingDone = [{ ...steps[0], status: "COMPLETED" as const }, { ...steps[1], status: "COMPLETED" as const }, steps[2]];
  assert.equal(canAdvanceMissionStage("HARVESTING", harvestingDone), true);
  assert.equal(isStepTransitionAllowed(harvestingDone[2], "IN_PROGRESS", harvestingDone), true);
  assert.equal(canAdvanceMissionStage("FINISHED", harvestingDone), false);
});

test("accepts the documented farmer closeout outcome", () => {
  assert.deepEqual(parseCloseout({ actualHarvestKg: 80, actualDriedKg: 70, harvestedAreaHectares: 0.5, dryingCompleted: true, rejectedKg: null, notes: "Rain delayed the final batch." }), { actualHarvestKg: 80, actualDriedKg: 70, harvestedAreaHectares: 0.5, dryingCompleted: true, rejectedKg: null, notes: "Rain delayed the final batch." });
});

test("allows only executable stages when confirming a replacement plan", () => {
  assert.deepEqual(parseReplanConfirmation({ previewToken: "token", planId: "00000000-0000-4000-8000-000000000001", stage: "DRYING" }), { previewToken: "token", planId: "00000000-0000-4000-8000-000000000001" });
});

test("preserves timestamp milliseconds in replan concurrency tokens", () => {
  assert.equal(missionVersionTimestamp(new Date("2026-08-28T15:31:42.347Z")), "2026-08-28T15:31:42.347Z");
});

test("projects a buyer quantity into the MVP harvest target", async () => {
  const facts = { fieldBlockId: "field", cropBatchIds: ["batch"], readinessConfirmed: true, destination: "IMMEDIATE_SALE" as const, plannedHarvestKg: 80, deadlineAt: "2026-09-01T00:00:00.000Z", notes: null, clarification: null };
  let received: typeof facts | undefined;
  const service = { replanDraft: async () => ({ previewId: "preview", messages: [{ role: "farmer" as const, content: "mission" }], facts, review: [], blocks: [] }), replanPreview: async (_ownerId: string, _missionId: string, candidate: { facts: typeof facts }) => { received = candidate.facts; return { status: "infeasible" as const, missionId: "mission", blockers: [] }; } } as unknown as MissionService;
  await MissionService.prototype.replanFromReport.call(service, "owner", "mission", { reportType: "BUYER_REQUIREMENT_CHANGED", observedAt: new Date().toISOString(), payload: { targetQuantityKg: 65, quantityBasis: "DRIED", buyerPickupAt: "2026-08-30T08:00:00.000Z" } });
  assert.equal(received?.plannedHarvestKg, 65);
  assert.equal(received?.deadlineAt, "2026-08-30T08:00:00.000Z");
});

test("carries observed rain into a report-driven replan", async () => {
  const observedAt = "2026-08-28T08:15:00.000Z";
  let received: unknown[] | undefined;
  const service = { replanDraft: async () => ({ previewId: "preview", messages: [{ role: "farmer" as const, content: "mission" }], facts: {}, review: [], blocks: [] }), replanPreview: async (...args: unknown[]) => { received = args; return { status: "infeasible" as const, missionId: "mission", blockers: [] }; } } as unknown as MissionService;
  await MissionService.prototype.replanFromReport.call(service, "owner", "mission", { reportType: "RAIN_OR_FIELD_EVENT", observedAt, payload: { event: "hujan", observedAt } });
  assert.equal(received?.[3], "id");
  assert.equal(received?.[4], observedAt);
});

test("projects farmer-reported worker facts into a replan", async () => {
  const facts = { fieldBlockId: "field", cropBatchIds: ["batch"], readinessConfirmed: true, destination: "IMMEDIATE_SALE" as const, plannedHarvestKg: 500, deadlineAt: "2026-09-01T00:00:00.000Z", notes: null, clarification: null };
  let received: typeof facts & { workers?: number | null; harvestDurationMinutes?: number | null } | undefined;
  const service = { replanDraft: async () => ({ previewId: "preview", messages: [{ role: "farmer" as const, content: "mission" }], facts, review: [], blocks: [] }), replanPreview: async (_ownerId: string, _missionId: string, candidate: { facts: typeof received }) => { received = candidate.facts; return { status: "infeasible" as const, missionId: "mission", blockers: [] }; } } as unknown as MissionService;
  await MissionService.prototype.replanFromReport.call(service, "owner", "mission", { reportType: "WORKER_AVAILABILITY_CHANGED", observedAt: new Date().toISOString(), payload: { availableWorkers: 3, estimatedHarvestMinutes: 450 } });
  assert.equal(received?.workers, 3);
  assert.equal(received?.harvestDurationMinutes, 450);
});

test("confirms a schedule edit with nullable optional facts and strict step data", async () => {
  const previous = process.env.MISSION_PREVIEW_SECRET; process.env.MISSION_PREVIEW_SECRET = "test-secret";
  const stepId = "00000000-0000-4000-8000-000000000010";
  const mission = {
    missionId: "mission", farmId: "farm", fieldBlockId: "field", status: "ACTIVE", stage: "WAITING", approvedPlanId: "old-plan", revision: 4, updatedAt: new Date("2026-08-29T01:00:00Z"), originalMessage: "Panen Blok Utara", notes: null,
    messages: [{ role: "farmer", content: "Panen Blok Utara" }], cropBatches: [{ cropBatchId: "batch" }],
    constraints: [{ key: "readinessConfirmed", value: true }, { key: "destination", value: "IMMEDIATE_SALE" }, { key: "plannedHarvestKg", value: 80 }, { key: "deadlineAt", value: "2026-08-31T09:00:00.000Z" }],
    missionSteps: [{ missionStepId: stepId, sequence: 1, status: "SCHEDULED", actionKind: "CONFIRM_READINESS_WEATHER", title: "Check readiness", description: "Check readiness", scheduleType: "DAILY_WINDOW", startsOn: new Date("2026-08-29T00:00:00Z"), endsOn: new Date("2026-08-29T00:00:00Z"), windowStart: "06:00", windowEnd: "06:15", timezone: "Asia/Jakarta", isConditional: false, stage: "HARVESTING", targetHarvestKg: null, quantityKg: null, dependencies: [], resourceDemands: [], calendarSyncStatus: "SYNCED", googleCalendarEventId: "private-calendar-id" }],
  };
  const context = { farm: { timezone: "Asia/Jakarta", defaultWorkingHours: { saturday: [{ start: "06:00", end: "16:00" }] }, dryingProfile: {}, schedulingDurations: {}, owner: { displayName: "Owner", locale: "id", timezone: "Asia/Jakarta" }, name: "Farm", location: "", notes: null, defaultWorkerCount: 2 }, fields: [{ fieldBlockId: "field", name: "Blok Utara", latitude: 0, longitude: 0 }], cropBatches: [{ cropBatchId: "batch", fieldBlockId: "field", crop: "shallot", variety: null }], history: [] };
  let replacement: Record<string, unknown> | undefined;
  const repository = { find: async () => mission, context: async () => context, replaceConfirmedPlan: async (input: Record<string, unknown>) => { replacement = input; return mission; } };
  const agent = { interpretScheduleEdit: async () => ({ edit: { type: "SHIFT_ACTIVITY" as const, missionStepId: stepId, deltaMinutes: 120 }, question: null }) };
  const service = new MissionService(repository as never, agent as never, async () => "farm", async () => ({ hourly: {} }), { syncIfConnected: async () => null } as never);
  try {
    const preview = await service.replanFromInstruction("owner", "mission", "tunda pemeriksaan dua jam");
    assert.equal(preview.status, "feasible");
    if (preview.status !== "feasible") return;
    const signed = verifyPreview<{ exp: number; plans: Array<{ activities: Array<Record<string, unknown>> }>; candidate: { blocks: Array<{ key: string }> } }>(preview.previewToken);
    assert.equal("calendarSyncStatus" in signed.plans[0].activities[0], false);
    assert.equal("googleCalendarEventId" in signed.plans[0].activities[0], false);
    assert.equal(signed.candidate.blocks.some((block) => block.key === "workers" || block.key === "harvestDurationMinutes"), false);
    await service.confirmReplan("owner", "mission", { previewToken: preview.previewToken, planId: preview.recommendation.planId, syncCalendar: false });
    assert.equal(replacement?.expectedRevision, 4);
    assert.deepEqual((replacement?.blocks as Array<{ key: string }>).map((block) => block.key).sort(), ["cropBatchIds", "deadlineAt", "destination", "fieldBlockId", "plannedHarvestKg", "readinessConfirmed"].sort());
  } finally { if (previous === undefined) delete process.env.MISSION_PREVIEW_SECRET; else process.env.MISSION_PREVIEW_SECRET = previous; }
});

test("uses only the selected field's six latest closeouts as planning history", () => {
  const history = Array.from({ length: 8 }, (_, index) => ({ mission: { fieldBlockId: index === 7 ? "other-field" : "field-1" }, plannedHarvestKg: `${100 + index}`, plannedDriedKg: 80, actualHarvestKg: 90, actualDriedKg: 70, harvestedAreaHectares: null, dryingCompleted: true, rejectedKg: 2, notes: `Rain delay ${index}` }));
  const outcomes = completedFieldHistory(history, "field-1");
  assert.equal(outcomes.length, 6);
  assert.deepEqual(outcomes[0], { plannedHarvestKg: 100, plannedDriedKg: 80, actualHarvestKg: 90, actualDriedKg: 70, harvestedAreaHectares: null, dryingCompleted: true, rejectedKg: 2, closeoutNotes: "Rain delay 0" });
});

test("turns an empty planner response into a retryable API error", () => {
  const error = planningUnavailable(new SyntaxError("Failed to parse. Text: \"\""));
  assert.equal(error.status, 503);
  assert.match(error.message, /could not produce a complete plan/i);
});

test("turns an invalid interpretation response into a retryable API error", () => {
  const error = interpretationUnavailable(new SyntaxError("Failed to parse model output"));
  assert.equal(error.status, 503);
  assert.match(error.message, /could not interpret/i);
});

test("logs only safe metadata for invalid interpretation output", () => {
  const previous = console.warn;
  const calls: unknown[][] = [];
  console.warn = (...args: unknown[]) => { calls.push(args); };
  try {
    logInterpretationFailure("preview-1", new SyntaxError("Failed to parse. Text: farmer-private-request"));
  } finally {
    console.warn = previous;
  }
  assert.deepEqual(calls, [["Mission interpretation failed", { previewId: "preview-1", kind: "output_parsing_failure" }]]);
});

test("logs only safe metadata for invalid planner output", () => {
  const previous = console.warn; const calls: unknown[][] = [];
  console.warn = (...args: unknown[]) => { calls.push(args); };
  try {
    logPlanningFailure("mission-1", new Error("targetHarvestKg is missing: farmer-private-request"));
  } finally {
    console.warn = previous;
  }
  assert.deepEqual(calls, [["Mission planning failed", { missionId: "mission-1", kind: "output_validation_failure" }]]);
});

test("discards browser-provided mission review and fact blocks", () => {
  const candidate = parsePreviewCandidate({ candidate: {
    previewId: "00000000-0000-4000-8000-000000000001", messages: [{ role: "farmer", content: "Harvest shallots" }],
    facts: { fieldBlockId: "00000000-0000-4000-8000-000000000002", cropBatchIds: ["00000000-0000-4000-8000-000000000003"], readinessConfirmed: true, destination: "IMMEDIATE_SALE", plannedHarvestKg: 80, deadlineAt: "2026-08-23T00:00:00.000Z", notes: null, clarification: null },
    review: [{ key: "deadlineAt", status: "confirmed", reason: "forged", provenance: "INFERRED", confidence: "high" }], blocks: [{ key: "deadlineAt", value: "forged", provenance: "INFERRED", confidence: "high" }],
  } });
  assert.deepEqual(candidate.review, []);
  assert.deepEqual(candidate.blocks, []);
});
