import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../infrastructure/prisma";

export const telegramToken = () => randomBytes(24).toString("base64url");
export const telegramTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export class TelegramRepository {
  status(userId: string) {
    return getPrisma().telegramConnection.findUnique({ where: { userId } });
  }

  identity(telegramUserId: string, telegramChatId: string) {
    return getPrisma().telegramConnection.findFirst({ where: { telegramUserId, telegramChatId } });
  }

  openOperationalPending(ownerId: string) {
    return getPrisma().pendingAction.findFirst({ where: { status: "PENDING", farm: { ownerId }, thread: { channel: "telegram" } }, orderBy: { createdAt: "desc" } });
  }

  openReplanClarification(ownerId: string) {
    return getPrisma().telegramAction.findFirst({ where: { action: "REPLAN_CLARIFICATION", consumedAt: null, expiresAt: { gt: new Date() }, farm: { ownerId } }, orderBy: { createdAt: "desc" } });
  }

  async createLink(userId: string, tokenHash: string, expiresAt: Date) {
    await getPrisma().telegramLinkToken.upsert({ where: { userId }, create: { userId, tokenHash, expiresAt }, update: { tokenHash, expiresAt, createdAt: new Date() } });
  }

  async consumeLink(tokenHash: string, identity: { telegramUserId: string; telegramChatId: string; telegramUsername: string | null; telegramFirstName: string | null }) {
    return getPrisma().$transaction(async (tx) => {
      const link = await tx.telegramLinkToken.findUnique({ where: { tokenHash }, include: { user: { include: { telegramConnection: true } } } });
      if (!link || link.expiresAt <= new Date()) return { status: "INVALID" as const };
      if (link.user.telegramConnection) {
        await tx.telegramLinkToken.delete({ where: { telegramLinkTokenId: link.telegramLinkTokenId } });
        return { status: "CONNECTED" as const, connection: link.user.telegramConnection };
      }
      const connection = await tx.telegramConnection.create({ data: { userId: link.userId, ...identity } });
      await tx.telegramLinkToken.delete({ where: { telegramLinkTokenId: link.telegramLinkTokenId } });
      return { status: "LINKED" as const, connection };
    });
  }

  async ownerMission(ownerId: string, missionId: string) {
    return getPrisma().mission.findFirst({
      where: { missionId, farm: { ownerId } },
      include: {
        farm: { include: { owner: { include: { telegramConnection: true } } } },
        fieldBlock: true,
        missionSteps: { where: { status: { in: ["SCHEDULED", "IN_PROGRESS"] }, stage: { in: ["HARVESTING", "DRYING"] } }, orderBy: { sequence: "asc" } },
      },
    });
  }

  ownerCurrentMission(ownerId: string) {
    return getPrisma().mission.findFirst({ where: { status: "ACTIVE", farm: { ownerId } }, include: { constraints: true, missionSteps: { orderBy: { sequence: "asc" } } }, orderBy: { updatedAt: "desc" } });
  }

  async createAction(input: { telegramConnectionId: string; farmId: string; missionId: string; action: string; tokenHash: string; expiresAt: Date; payload?: unknown; externalMessageId?: string }) {
    const data = { ...input, payload: input.payload as Prisma.InputJsonValue | undefined };
    return input.externalMessageId
      ? getPrisma().telegramAction.upsert({ where: { externalMessageId: input.externalMessageId }, create: data, update: {} })
      : getPrisma().telegramAction.create({ data });
  }

  async bindActionMessage(telegramActionId: string, telegramMessageId: string) {
    await getPrisma().telegramAction.update({ where: { telegramActionId }, data: { telegramMessageId } });
  }

  async updateActionPayload(telegramActionId: string, payload: unknown) {
    return getPrisma().telegramAction.update({ where: { telegramActionId }, data: { payload: payload as Prisma.InputJsonValue } });
  }

  async resolveAction(telegramActionId: string) {
    await getPrisma().telegramAction.updateMany({ where: { telegramActionId, consumedAt: null }, data: { consumedAt: new Date() } });
  }

  async deleteAction(telegramActionId: string) {
    await getPrisma().telegramAction.deleteMany({ where: { telegramActionId, consumedAt: null } });
  }

  action(tokenHash: string) {
    return getPrisma().telegramAction.findUnique({ where: { tokenHash }, include: { connection: true, mission: true } });
  }

  async consumeAction(telegramActionId: string, now: Date) {
    return (await getPrisma().telegramAction.updateMany({ where: { telegramActionId, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } })).count === 1;
  }

  async releaseAction(telegramActionId: string, consumedAt: Date) {
    await getPrisma().telegramAction.updateMany({ where: { telegramActionId, consumedAt }, data: { consumedAt: null } });
  }
}
