import assert from "node:assert/strict";
import test from "node:test";
import { signPreview, verifyPreview } from "./mission-preview-token";
import { canAdvanceMissionStage, completedFieldHistory, interpretationUnavailable, isStepTransitionAllowed, logInterpretationFailure, logPlanningFailure, nextMissionStage, planningUnavailable } from "./mission.service";
import { parseCloseout, parsePreviewCandidate } from "./mission.validation";

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
  assert.deepEqual(parseCloseout({ actualHarvestKg: 80, actualDriedKg: 70, harvestedAreaHectares: 0.5, buyerTargetMet: false, dryingCompleted: true, rejectedKg: null, notes: "Rain delayed the final batch." }), { actualHarvestKg: 80, actualDriedKg: 70, harvestedAreaHectares: 0.5, buyerTargetMet: false, dryingCompleted: true, rejectedKg: null, notes: "Rain delayed the final batch." });
});

test("uses only the selected field's six latest closeouts as planning history", () => {
  const history = Array.from({ length: 8 }, (_, index) => ({ mission: { fieldBlockId: index === 7 ? "other-field" : "field-1" }, plannedHarvestKg: `${100 + index}`, plannedDriedKg: 80, actualHarvestKg: 90, actualDriedKg: 70, harvestedAreaHectares: null, buyerTargetMet: false, dryingCompleted: true, rejectedKg: 2, notes: `Rain delay ${index}` }));
  const outcomes = completedFieldHistory(history, "field-1");
  assert.equal(outcomes.length, 6);
  assert.deepEqual(outcomes[0], { plannedHarvestKg: 100, plannedDriedKg: 80, actualHarvestKg: 90, actualDriedKg: 70, harvestedAreaHectares: null, buyerTargetMet: false, dryingCompleted: true, rejectedKg: 2, closeoutNotes: "Rain delay 0" });
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
    facts: { fieldBlockId: "00000000-0000-4000-8000-000000000002", cropBatchIds: ["00000000-0000-4000-8000-000000000003"], buyerCommitmentId: null, buyerQuantityKg: 60, marketQuality: "Grade A", plannedHarvestKg: 80, plannedDriedKg: 70, deadline: "2026-07-23", availableWorkerCount: null, coveredDryingCapacityKg: null, notes: null, clarification: null },
    review: [{ key: "deadline", status: "confirmed", reason: "forged", provenance: "INFERRED", confidence: "high" }], blocks: [{ key: "deadline", value: "forged", provenance: "INFERRED", confidence: "high" }],
  } });
  assert.deepEqual(candidate.review, []);
  assert.deepEqual(candidate.blocks, []);
});
