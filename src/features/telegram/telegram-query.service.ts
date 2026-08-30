import { ApiError } from "../../shared/api-error";
import { callerFarmId } from "../farm/caller-farm.service";
import { buildTelegramQueryGraph } from "../../agent/telegram-query-agent";
import { TunasRepository } from "../tunas/tunas.repository";
import type { TunasState } from "../tunas/tunas.types";

export class TelegramQueryService {
  private readonly graph;

  constructor(private readonly repository = new TunasRepository(), private readonly farmIdForOwner = callerFarmId) {
    this.graph = buildTelegramQueryGraph(repository);
  }

  async ask(ownerId: string, message: string, externalMessageId: string): Promise<TunasState> {
    const farmId = await this.farmIdForOwner(ownerId);
    const started = await this.repository.beginInteraction({ farmId, missionId: null, channel: "telegram", externalMessageId, message });
    if (started.duplicate) {
      if (!started.interaction.response) throw new ApiError(409, "Pertanyaan ini masih diproses.");
      return started.interaction.response as TunasState;
    }
    const interaction = started.interaction;
    try {
      const result = await this.graph.invoke({ farmId, question: message });
      const response: TunasState = { threadId: interaction.operationalThreadId, interactionId: interaction.operationalInteractionId, missionId: null, trigger: "QUERY", message: result.answer, pendingAction: null };
      await this.repository.auditRoute({ threadId: response.threadId, interactionId: response.interactionId, farmId, missionId: null, channel: "telegram" }, { trigger: "QUERY", routingSource: "AI", routingFailure: null });
      await this.repository.auditResponse({ threadId: response.threadId, interactionId: response.interactionId, farmId, missionId: null, channel: "telegram" }, response);
      await this.repository.completeInteraction(response.interactionId, response.trigger, response);
      return response;
    } catch (error) {
      await this.repository.failInteraction(interaction.operationalInteractionId, "QUERY_WORKFLOW_FAILURE");
      throw error;
    }
  }
}
