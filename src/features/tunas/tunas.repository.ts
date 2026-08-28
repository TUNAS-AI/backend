import { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../infrastructure/prisma";
import type { TunasAction, TunasMessageRecord, TunasMissionReference } from "./tunas.types";

const messageSelect = { tunasMessageId: true, missionId: true, kind: true, role: true, content: true, actions: true, readAt: true, createdAt: true, mission: { select: { missionId: true, originalMessage: true, status: true, stage: true } } } as const;
const actions = (value: unknown) => Array.isArray(value) ? value as TunasAction[] : [];
const record = (value: { tunasMessageId: string; missionId: string | null; mission: TunasMissionReference | null; kind: string; role: string; content: string; actions: unknown; readAt: Date | null; createdAt: Date }): TunasMessageRecord => ({ ...value, actions: actions(value.actions) });

export class TunasRepository {
  async farm(farmId: string) { return getPrisma().farm.findUniqueOrThrow({ where: { farmId } }); }
  async hasChecked(farmId: string, forecastDate: Date) { return Boolean(await getPrisma().tunasForecastCheck.findUnique({ where: { farmId_forecastDate: { farmId, forecastDate } } })); }
  async markChecked(farmId: string, forecastDate: Date) { await getPrisma().tunasForecastCheck.upsert({ where: { farmId_forecastDate: { farmId, forecastDate } }, create: { farmId, forecastDate }, update: {} }); }
  async activeMissions(farmId: string) {
    return getPrisma().mission.findMany({
      where: { farmId, status: "ACTIVE", missionSteps: { some: { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, stage: { in: ["HARVESTING", "DRYING"] } } } },
      include: { fieldBlock: true, missionSteps: { where: { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, stage: { in: ["HARVESTING", "DRYING"] } } } },
      orderBy: { createdAt: "desc" },
    });
  }
  async latestActiveMission(farmId: string) { return (await this.activeMissions(farmId))[0] ?? null; }
  async createMessage(input: { farmId: string; missionId?: string | null; kind: string; role?: string; content: string; actions?: TunasAction[]; dedupeKey?: string | null }) {
    const create = { ...input, actions: (input.actions ?? []) as Prisma.InputJsonValue };
    const value = input.dedupeKey
      ? await getPrisma().tunasMessage.upsert({ where: { farmId_dedupeKey: { farmId: input.farmId, dedupeKey: input.dedupeKey } }, create, update: {}, select: messageSelect })
      : await getPrisma().tunasMessage.create({ data: create, select: messageSelect });
    return record(value);
  }
  async messages(farmId: string) {
    const [items, unread] = await Promise.all([
      getPrisma().tunasMessage.findMany({ where: { farmId }, orderBy: { createdAt: "desc" }, take: 20, select: messageSelect }),
      getPrisma().tunasMessage.count({ where: { farmId, readAt: null } }),
    ]);
    return { messages: items.reverse().map(record), unreadCount: unread };
  }
  async markRead(farmId: string) { await getPrisma().tunasMessage.updateMany({ where: { farmId, readAt: null }, data: { readAt: new Date() } }); return this.messages(farmId); }
  async message(farmId: string, tunasMessageId: string) { const value = await getPrisma().tunasMessage.findFirst({ where: { farmId, tunasMessageId }, select: messageSelect }); return value ? record(value) : null; }
  async consumeAction(farmId: string, tunasMessageId: string) { await getPrisma().tunasMessage.updateMany({ where: { farmId, tunasMessageId }, data: { actions: [] as Prisma.InputJsonValue, readAt: new Date() } }); }
}
