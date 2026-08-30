import { createHash, randomBytes } from "node:crypto";
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

  async createAction(input: { telegramConnectionId: string; farmId: string; missionId: string; tokenHash: string; expiresAt: Date }) {
    return getPrisma().telegramAction.create({ data: { ...input, action: "MOCK_REPLAN" } });
  }

  async bindActionMessage(telegramActionId: string, telegramMessageId: string) {
    await getPrisma().telegramAction.update({ where: { telegramActionId }, data: { telegramMessageId } });
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
}
