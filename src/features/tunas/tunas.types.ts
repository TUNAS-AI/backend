export type TunasAction = { id: "keep" | "reschedule" | "regenerate"; label: string };
export type TunasMissionReference = { missionId: string; originalMessage: string; status: string; stage: string };
export type TunasMessageRecord = { tunasMessageId: string; missionId: string | null; mission: TunasMissionReference | null; kind: string; role: string; content: string; actions: TunasAction[]; readAt: Date | null; telegramSentAt: Date | null; telegramMessageId: string | null; createdAt: Date };
import type { OperationalImpact, OperationalReportInput } from "./operational-report";

export type OperationalPendingKind = "CLARIFICATION" | "MISSION_NOTES" | "MISSION_STAGE" | "MISSION_STEP_STATUS" | "CLOSEOUT" | "OPERATIONAL_REPORT";
export type SemanticAction = { type: "APPROVE_REPORT" | "REJECT_REPORT" | "OPEN_REPLAN"; missionId: string | null; pendingActionId?: string };
export type OperationalPending = { pendingActionId: string; kind: OperationalPendingKind; status: string; preview: { before: unknown; after: unknown }; actions: { approve: string; reject: string }; semanticActions?: SemanticAction[] };
export type ReplanPreview = Awaited<ReturnType<import("../missions/mission.service").MissionService["replanFromInstruction"]>>;
export type TunasState = { threadId: string; interactionId: string; missionId: string | null; trigger: string; message: string; pendingAction: OperationalPending | null; impact?: OperationalImpact | null; semanticActions?: SemanticAction[]; transient?: boolean; replan?: ReplanPreview };
export type InteractionInput = { message: string; report?: OperationalReportInput; missionId: string | null; channel: string; externalMessageId: string; forcedTrigger?: "UPDATE"; replanContext?: string[] };
