export type TunasAction = { id: "keep" | "reschedule" | "regenerate"; label: string };
export type TunasMissionReference = { missionId: string; originalMessage: string; status: string; stage: string };
export type TunasMessageRecord = { tunasMessageId: string; missionId: string | null; mission: TunasMissionReference | null; kind: string; role: string; content: string; actions: TunasAction[]; readAt: Date | null; createdAt: Date };
