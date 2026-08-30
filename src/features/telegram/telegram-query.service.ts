import { ApiError } from "../../shared/api-error";
import { callerFarmId } from "../farm/caller-farm.service";
import { buildTelegramQueryGraph, createTelegramRouter, deterministicTelegramRoute, type TelegramIntent, type TelegramRouter } from "../../agent/telegram-query-agent";
import { TunasRepository } from "../tunas/tunas.repository";
import type { TunasState } from "../tunas/tunas.types";

export class TelegramQueryService {
  private readonly graph;

  constructor(private readonly repository = new TunasRepository(), private readonly farmIdForOwner = callerFarmId, private readonly router: TelegramRouter = createTelegramRouter()) {
    this.graph = buildTelegramQueryGraph(repository);
  }

  async route(_ownerId: string, message: string, activeWorkflow: "REPORT" | "REPLAN" | null) {
    const deterministic = deterministicTelegramRoute(message, activeWorkflow);
    if (deterministic) return deterministic;
    try { return await this.router({ message }); }
    catch (error) { logTelegramRouteFailure(error); return { intent: "UNKNOWN" as const, continuation: false }; }
  }

  async respond(ownerId: string, message: string, externalMessageId: string, responseMessage: string, trigger: string): Promise<TunasState> {
    const farmId = await this.farmIdForOwner(ownerId);
    const started = await this.repository.beginInteraction({ farmId, missionId: null, channel: "telegram", externalMessageId, message });
    if (started.duplicate) {
      if (!started.interaction.response) throw new ApiError(409, "Pesan ini masih diproses.");
      return started.interaction.response as TunasState;
    }
    const response: TunasState = { threadId: started.interaction.operationalThreadId, interactionId: started.interaction.operationalInteractionId, missionId: null, trigger, message: responseMessage, pendingAction: null };
    await this.repository.auditRoute({ threadId: response.threadId, interactionId: response.interactionId, farmId, missionId: null, channel: "telegram" }, { trigger, routingSource: "AI", routingFailure: null });
    await this.repository.auditResponse({ threadId: response.threadId, interactionId: response.interactionId, farmId, missionId: null, channel: "telegram" }, response);
    await this.repository.completeInteraction(response.interactionId, trigger, response);
    return response;
  }

  async ask(ownerId: string, message: string, externalMessageId: string, intent?: TelegramIntent): Promise<TunasState> {
    const farmId = await this.farmIdForOwner(ownerId);
    const started = await this.repository.beginInteraction({ farmId, missionId: null, channel: "telegram", externalMessageId, message });
    if (started.duplicate) {
      if (!started.interaction.response) throw new ApiError(409, "Pertanyaan ini masih diproses.");
      return started.interaction.response as TunasState;
    }
    const interaction = started.interaction;
    try {
      const result = await this.graph.invoke({ farmId, question: message, ...(intent ? { intent } : {}) });
      const response: TunasState = { threadId: interaction.operationalThreadId, interactionId: interaction.operationalInteractionId, missionId: null, trigger: "QUERY", message: result.answer, pendingAction: null };
      await this.repository.auditRoute({ threadId: response.threadId, interactionId: response.interactionId, farmId, missionId: null, channel: "telegram" }, { trigger: result.intent ?? "QUERY", routingSource: result.routingSource ?? "INPUT_VALIDATION", routingFailure: result.routingFailure ?? null });
      await this.repository.auditResponse({ threadId: response.threadId, interactionId: response.interactionId, farmId, missionId: null, channel: "telegram" }, response);
      await this.repository.completeInteraction(response.interactionId, response.trigger, response);
      return response;
    } catch (error) {
      await this.repository.failInteraction(interaction.operationalInteractionId, "QUERY_WORKFLOW_FAILURE");
      throw error;
    }
  }
}

function logTelegramRouteFailure(error: unknown) {
  console.warn("Telegram routing stage failed", { stage: "route_intent", kind: error instanceof Error ? error.name : "unknown_error" });
}
