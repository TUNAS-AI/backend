import { ApiError } from "../../shared/api-error";
import { callerFarmId } from "../farm/caller-farm.service";
import { getOpenMeteoForecast } from "../../agent/missions/open-meteo.client";
import { TunasRepository } from "./tunas.repository";
import type { TunasAction } from "./tunas.types";
import { Command, isInterrupted } from "@langchain/langgraph";
import { getOperationalGraph, type ResumePayload } from "../../agent/operational-agent";
import type { InteractionInput, OperationalPending, OperationalPendingKind, TunasState } from "./tunas.types";
import { TelegramService } from "../telegram/telegram.service";

type WeatherHour = { time: string; probability: number; precipitation: number };
type AlertStep = { title: string; stage: string; startsOn: Date; endsOn: Date; windowStart: string | null; windowEnd: string | null };
const localDate = (date: Date, timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const weatherHours = (weather: Record<string, unknown>) => { const hourly = weather.hourly as { time?: unknown; precipitation_probability?: unknown; precipitation?: unknown } | undefined; const times = Array.isArray(hourly?.time) ? hourly.time.slice(0, 72) : []; return times.flatMap((time, index): WeatherHour[] => typeof time === "string" ? [{ time, probability: Number(Array.isArray(hourly?.precipitation_probability) ? hourly.precipitation_probability[index] : 0), precipitation: Number(Array.isArray(hourly?.precipitation) ? hourly.precipitation[index] : 0) }] : []); };
export function rainImpact(hours: WeatherHour[], steps: AlertStep[], timezone: string) { return steps.flatMap((step) => { const start = localDate(step.startsOn, timezone); const end = localDate(step.endsOn, timezone); const rainy = hours.filter((hour) => { const day = hour.time.slice(0, 10); const time = hour.time.slice(11, 16); return hour.precipitation > 0.1 && day >= start && day <= end && (step.stage !== "HARVESTING" || (time >= (step.windowStart ?? "00:00") && time < (step.windowEnd ?? "24:00"))); }); return rainy.length ? [{ step, rainy }] : []; }); }
const action = (id: TunasAction["id"], label: string): TunasAction => ({ id, label });

const pendingView = (pending: { pendingActionId: string; kind: string; status: string; preview: unknown }): OperationalPending => ({ pendingActionId: pending.pendingActionId, kind: pending.kind as OperationalPendingKind, status: pending.status, preview: pending.preview as { before: unknown; after: unknown }, actions: { approve: `/api/tunas/pending/${pending.pendingActionId}/approve`, reject: `/api/tunas/pending/${pending.pendingActionId}/reject` } });

export class TunasService {
  constructor(private readonly repository = new TunasRepository(), private readonly farmIdForOwner = callerFarmId, private readonly forecast = getOpenMeteoForecast, private readonly telegram = new TelegramService()) {}

  async messages(ownerId: string) { return this.repository.messages(await this.farmIdForOwner(ownerId)); }
  async interactions(ownerId: string) { return { interactions: await this.repository.interactions(await this.farmIdForOwner(ownerId)) }; }
  async markRead(ownerId: string) { return this.repository.markRead(await this.farmIdForOwner(ownerId)); }

  async dailyCheck(ownerId: string) {
    const farmId = await this.farmIdForOwner(ownerId); const farm = await this.repository.farm(farmId);
    await this.deliverPendingAlerts(ownerId, farmId);
    const today = new Date(`${localDate(new Date(), farm.timezone)}T00:00:00.000Z`);
    if (await this.repository.hasChecked(farmId, today)) return this.repository.messages(farmId);
    const missions = await this.repository.activeMissions(farmId);
    const forecasts = new Map<string, Promise<{ previous: Awaited<ReturnType<TunasRepository["latestWeather"]>>; weather: Record<string, unknown> }>>();
    for (const mission of missions.filter((item) => item.fieldBlock)) {
      const field = mission.fieldBlock!;
      let fieldForecast = forecasts.get(field.fieldBlockId);
      if (!fieldForecast) {
        fieldForecast = Promise.all([this.repository.latestWeather(farmId, field.fieldBlockId), this.forecast(Number(field.latitude), Number(field.longitude), farm.timezone)]).then(([previous, weather]) => ({ previous, weather }));
        forecasts.set(field.fieldBlockId, fieldForecast);
      }
      const { previous, weather } = await fieldForecast;
      const impact = rainImpact(weatherHours(weather), mission.missionSteps, farm.timezone);
      const previousImpact = previous ? rainImpact(weatherHours(previous.payload as Record<string, unknown>), mission.missionSteps, farm.timezone) : [];
      const signature = (items: typeof impact) => items.map(({ step, rainy }) => `${step.title}:${rainy.map((hour) => hour.time).join(",")}`).join("|");
      if (!impact.length) { await this.repository.saveWeather(farmId, field.fieldBlockId, weather); continue; }
      if (signature(impact) === signature(previousImpact)) { await this.repository.saveWeather(farmId, field.fieldBlockId, weather); continue; }
      const affected = impact[0]; const rainDays = new Set(impact.flatMap(({ rainy }) => rainy.map((hour) => hour.time.slice(0, 10))));
      const drying = affected.step.stage === "DRYING";
      const protection = mission.constraints.find((item) => item.key === "rainProtectionAvailable")?.value === true;
      const kind = rainDays.size >= 2 ? "irregular-rain" : drying ? "drying-rain" : "harvest-rain";
      const recommendation = rainDays.size >= 2 ? "Tinjau ulang jadwal panen dan pengeringan." : drying ? protection ? "Siapkan penutup sebelum hujan." : "Tutup atau pindahkan bawang ke tempat terlindung." : "Tinjau waktu panen agar tidak terkena hujan.";
      const content = `Prakiraan hujan berubah dan dapat mengenai ${affected.step.title}. ${recommendation} Belum ada perubahan jadwal.`;
      const actions = drying ? [] : rainDays.size >= 2 ? [action("regenerate", "Buat 3 rencana"), action("keep", "Pertahankan rencana")] : [action("reschedule", "Atur ulang"), action("keep", "Pertahankan rencana")];
      const message = await this.repository.createMessage({ farmId, missionId: mission.missionId, kind, dedupeKey: `${localDate(new Date(), farm.timezone)}:${mission.missionId}:${kind}`, content, actions });
      if (!message.telegramSentAt) {
        try {
          const sent = await this.telegram.sendAlert({ ownerId, missionId: mission.missionId, demo: false, change: `Prakiraan menunjukkan hujan di ${[...rainDays].join(", ")}.`, activity: affected.step.title, impact: drying ? "Bawang yang sedang dikeringkan berisiko terkena hujan." : "Jendela panen berisiko terganggu hujan.", recommendation });
          await this.repository.markTelegramSent(farmId, message.tunasMessageId, sent.telegramMessageId);
        } catch (error) { if (!(error instanceof ApiError && error.code === "TELEGRAM_NOT_CONNECTED")) throw error; }
      }
      await this.repository.saveWeather(farmId, field.fieldBlockId, weather);
    }
    await this.repository.markChecked(farmId, today);
    return this.repository.messages(farmId);
  }

  private async deliverPendingAlerts(ownerId: string, farmId: string) {
    for (const message of await this.repository.pendingTelegramMessages(farmId)) {
      if (!message.missionId) continue;
      try {
        const sent = await this.telegram.sendAlert({ ownerId, missionId: message.missionId, demo: false, change: "Prakiraan hujan berubah sejak pemeriksaan terakhir.", activity: message.kind === "drying-rain" ? "Pengeringan bawang" : message.kind === "harvest-rain" ? "Panen bawang" : "Panen dan pengeringan", impact: message.content, recommendation: message.kind === "drying-rain" ? "Lindungi bawang sebelum hujan." : "Tinjau ulang waktu kegiatan." });
        await this.repository.markTelegramSent(farmId, message.tunasMessageId, sent.telegramMessageId);
      } catch (error) { if (error instanceof ApiError && error.code === "TELEGRAM_NOT_CONNECTED") return; throw error; }
    }
  }

  async act(ownerId: string, messageId: string, requested: TunasAction["id"]) {
    const farmId = await this.farmIdForOwner(ownerId); const message = await this.repository.message(farmId, messageId);
    if (!message) throw new ApiError(404, "Tunas message not found");
    if (!message.actions.some((item) => item.id === requested)) throw new ApiError(409, "That Tunas action is not available");
    await this.repository.consumeAction(farmId, messageId);
    await this.repository.createMessage({ farmId, missionId: message.missionId, kind: "farmer-decision", role: "farmer", content: requested === "keep" ? "Keep the current mission plan." : requested === "regenerate" ? "Generate replacement plans for the irregular rain forecast." : "Reschedule this harvest because of the rain forecast." });
    if (requested === "keep" || !message.missionId) return { messages: await this.repository.markRead(farmId), navigation: null };
    return { messages: await this.repository.markRead(farmId), navigation: { missionId: message.missionId, draft: requested === "regenerate" ? "Regenerate three harvest and drying plans around the irregular rain forecast." : "Reschedule the harvest and drying plan around the rain forecast.", autoGenerate: requested === "regenerate" } };
  }

  async test(ownerId: string, missionId: string, scenario: "drying-rain" | "harvest-rain" | "irregular-rain") {
    const farmId = await this.farmIdForOwner(ownerId); const mission = await this.repository.activeMission(farmId, missionId);
    if (!mission) throw new ApiError(409, "Misi aktif dengan kegiatan panen atau pengeringan diperlukan untuk demo ini.");
    const step = mission.missionSteps.find((item) => item.stage === (scenario === "drying-rain" ? "DRYING" : "HARVESTING")) ?? mission.missionSteps[0];
    const config = scenario === "drying-rain" ? { content: "Demo: hujan diperkirakan mengenai pengeringan. Lindungi bawang sebelum hujan.", actions: [] } : scenario === "harvest-rain" ? { content: "Demo: hujan diperkirakan mengenai waktu panen. Tinjau ulang jadwal panen.", actions: [action("reschedule", "Atur ulang"), action("keep", "Pertahankan rencana")] } : { content: "Demo: pola hujan berubah selama misi. Tinjau ulang jadwal panen dan pengeringan.", actions: [action("regenerate", "Buat 3 rencana"), action("keep", "Pertahankan rencana")] };
    const message = await this.repository.createMessage({ farmId, missionId: mission.missionId, kind: scenario, content: config.content, actions: config.actions });
    let sent: Awaited<ReturnType<TelegramService["sendAlert"]>>;
    try { sent = await this.telegram.sendAlert({ ownerId, missionId, demo: true, change: scenario === "irregular-rain" ? "Prakiraan menunjukkan pola hujan tidak menentu selama misi." : "Prakiraan menunjukkan hujan pada waktu kegiatan berlangsung.", activity: step.title, impact: step.stage === "DRYING" ? "Bawang yang sedang dikeringkan berisiko terkena hujan." : "Jendela panen berisiko terganggu hujan.", recommendation: step.stage === "DRYING" ? "Tutup atau pindahkan bawang ke tempat terlindung." : "Tinjau waktu panen agar tidak terkena hujan." }); }
    catch (error) { await this.repository.deleteMessage(farmId, message.tunasMessageId); throw error; }
    await this.repository.markTelegramSent(farmId, message.tunasMessageId, sent.telegramMessageId);
    return { ...(await this.repository.messages(farmId)), delivered: true, telegramMessageId: sent.telegramMessageId };
  }

  async interact(ownerId: string, input: InteractionInput): Promise<TunasState> {
    const farmId = await this.farmIdForOwner(ownerId);
    let mission = input.missionId ? await this.repository.mission(farmId, input.missionId) : await this.repository.currentMission(farmId);
    if (input.missionId && !mission) throw new ApiError(404, "Mission not found");
    const missionId = mission?.missionId ?? null;
    const started = await this.repository.beginInteraction({ ...input, farmId, missionId });
    if (started.duplicate) {
      if (!started.interaction.response) throw new ApiError(409, "Interaction with this identity is still processing");
      return started.interaction.response as TunasState;
    }
    const interaction = started.interaction; const threadId = interaction.operationalThreadId; const open = await this.repository.openPending(threadId);
    try {
      const inputState = open ? new Command({ resume: { kind: "INTERACTION", message: input.message, interactionId: interaction.operationalInteractionId } satisfies ResumePayload }) : { ownerId, farmId, missionId, threadId, interactionId: interaction.operationalInteractionId, message: input.message, channel: input.channel, structuredReport: input.report };
      const result = await getOperationalGraph().invoke(inputState as never, { configurable: { thread_id: threadId } });
      const response = isInterrupted(result) ? this.interruptedState(interaction.operationalInteractionId, threadId, missionId, result.__interrupt__[0]?.value) : result.response as TunasState;
      await this.repository.completeInteraction(interaction.operationalInteractionId, response.trigger, response);
      if (open && response.pendingAction?.status !== "PENDING") await this.repository.updateInteractionResponse(open.operationalInteractionId, response);
      return response;
    } catch (error) {
      await this.repository.failInteraction(interaction.operationalInteractionId, error instanceof ApiError ? `API_${error.status}` : "WORKFLOW_FAILURE");
      throw error;
    }
  }

  async approve(ownerId: string, pendingActionId: string): Promise<TunasState> {
    const farmId = await this.farmIdForOwner(ownerId); const pending = await this.repository.pending(farmId, pendingActionId);
    if (!pending) throw new ApiError(404, "Pending action not found");
    if (pending.status !== "PENDING") return this.pendingState(pending, `Pending action is already ${pending.status.toLowerCase()}.`);
    if (pending.kind === "CLARIFICATION") throw new ApiError(409, "This pending item requires clarification, not approval");
    return this.resumePending(pending, "APPROVAL");
  }

  async reject(ownerId: string, pendingActionId: string): Promise<TunasState> {
    const farmId = await this.farmIdForOwner(ownerId); const pending = await this.repository.pending(farmId, pendingActionId);
    if (!pending) throw new ApiError(404, "Pending action not found");
    if (pending.status !== "PENDING") return this.pendingState(pending, `Pending action is already ${pending.status.toLowerCase()}.`);
    return this.resumePending(pending, "REJECTION");
  }

  private async resumePending(pending: NonNullable<Awaited<ReturnType<TunasRepository["pending"]>>>, kind: "APPROVAL" | "REJECTION") {
    const result = await getOperationalGraph().invoke(new Command({ resume: { kind } satisfies ResumePayload }), { configurable: { thread_id: pending.operationalThreadId } });
    const state = result.response as TunasState;
    await this.repository.updateInteractionResponse(pending.operationalInteractionId, state);
    return state;
  }

  private interruptedState(interactionId: string, threadId: string, missionId: string | null, value: unknown): TunasState {
    const pendingAction = value as OperationalPending;
    return { threadId, interactionId, missionId, trigger: pendingAction.kind === "CLARIFICATION" ? "CLARIFICATION" : "UPDATE", message: pendingAction.kind === "CLARIFICATION" ? String((pendingAction.preview as { question?: unknown }).question ?? "Please clarify the request.") : pendingAction.kind === "OPERATIONAL_REPORT" ? "Review this operational report before approval." : "Review this proposed mission change before approval.", pendingAction };
  }

  private pendingState(pending: { pendingActionId: string; operationalThreadId: string; operationalInteractionId: string; missionId: string | null; kind: string; status: string; preview: unknown }, message: string): TunasState {
    return { threadId: pending.operationalThreadId, interactionId: pending.operationalInteractionId, missionId: pending.missionId, trigger: pending.status, message, pendingAction: pendingView(pending) };
  }

  async timeline(ownerId: string, missionId: string) {
    const farmId = await this.farmIdForOwner(ownerId);
    if (!await this.repository.mission(farmId, missionId)) throw new ApiError(404, "Mission not found");
    return { missionId, events: await this.repository.timeline(farmId, missionId) };
  }

  async reports(ownerId: string, missionId: string) {
    const farmId = await this.farmIdForOwner(ownerId);
    if (!await this.repository.mission(farmId, missionId)) throw new ApiError(404, "Mission not found");
    return { missionId, reports: await this.repository.reports(farmId, missionId) };
  }
}
