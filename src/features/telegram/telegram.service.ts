import { ApiError } from "../../shared/api-error";
import { env } from "../../config/env";
import { MissionService } from "../missions/mission.service";
import type { OperationalReportInput } from "../tunas/operational-report";
import type { TunasState } from "../tunas/tunas.types";
import type { TunasService } from "../tunas/tunas.service";
import { TelegramQueryService } from "./telegram-query.service";
import { TelegramRepository, telegramToken, telegramTokenHash } from "./telegram.repository";

const LINK_TTL_MS = 10 * 60_000;
const ACTION_TTL_MS = 15 * 60_000;

type TelegramUser = { id: number | string; first_name?: string; username?: string };
type TelegramChat = { id: number | string; type: string };
type TelegramMessage = { message_id: number; text?: string; chat: TelegramChat; from?: TelegramUser };
type TelegramCallback = { id: string; data?: string; from: TelegramUser; message?: TelegramMessage };
export type TelegramUpdate = { update_id?: number; message?: TelegramMessage; callback_query?: TelegramCallback };
export const telegramExternalMessageId = (updateId: number | undefined, chatId: number | string, messageId: number) => updateId === undefined ? `message:${chatId}:${messageId}` : `update:${updateId}`;
type AlertInput = { ownerId: string; missionId: string; demo: boolean; change: string; activity: string; impact: string; recommendation: string };
type CallbackAction = { telegramActionId?: string; action: string; payload?: unknown; farmId: string; missionId?: string; telegramMessageId: string | null; expiresAt?: Date; consumedAt?: Date | null; connection: { userId?: string; telegramConnectionId?: string; telegramUserId: string; telegramChatId: string }; mission: { farmId: string } };
export function telegramCallbackAuthorized(action: CallbackAction | null, callback: TelegramCallback): action is CallbackAction { return Boolean(action && callback.message && action.connection.telegramUserId === String(callback.from.id) && action.connection.telegramChatId === String(callback.message.chat.id) && action.telegramMessageId === String(callback.message.message_id) && action.mission.farmId === action.farmId); }
type OperationalApi = Pick<TunasService, "interact" | "approve" | "reject" | "cancel">;

export class TelegramService {
  private botUsername: string | null = null;
  private operationalApi: OperationalApi | null;

  constructor(private readonly repository = new TelegramRepository(), private readonly fetcher: typeof fetch = fetch, private readonly queries = new TelegramQueryService(), operationalApi: OperationalApi | null = null, private readonly missions = new MissionService()) { this.operationalApi = operationalApi; }

  async status(ownerId: string) {
    const connection = await this.repository.status(ownerId);
    return connection ? { connected: true as const, username: connection.telegramUsername, firstName: connection.telegramFirstName, linkedAt: connection.linkedAt } : { connected: false as const, username: null, firstName: null, linkedAt: null };
  }

  async connect(ownerId: string) {
    this.configuration();
    const connected = await this.repository.status(ownerId);
    if (connected) return { ...(await this.status(ownerId)), connectionUrl: null };
    const token = telegramToken();
    await this.repository.createLink(ownerId, telegramTokenHash(token), new Date(Date.now() + LINK_TTL_MS));
    const username = await this.username();
    return { ...(await this.status(ownerId)), connectionUrl: `https://t.me/${username}?start=${token}` };
  }

  async webhook(update: unknown) {
    const value = update as TelegramUpdate;
    if (!value || typeof value !== "object") throw new ApiError(400, "Telegram update is invalid");
    if (value.message) await this.message(value.message, value.update_id);
    if (value.callback_query) await this.callback(value.callback_query);
    return { ok: true };
  }

  async sendAlert(input: AlertInput) {
    const mission = await this.repository.ownerMission(input.ownerId, input.missionId);
    if (!mission) throw new ApiError(404, "Mission tidak ditemukan.");
    if (mission.status !== "ACTIVE") throw new ApiError(409, "Peringatan hanya dapat dikirim untuk misi aktif.");
    const connection = mission.farm.owner.telegramConnection;
    if (!connection) throw new ApiError(409, "Hubungkan akun Telegram di halaman Farm terlebih dahulu.", "TELEGRAM_NOT_CONNECTED");
    const token = telegramToken();
    const pending = await this.repository.createAction({ telegramConnectionId: connection.telegramConnectionId, farmId: mission.farmId, missionId: mission.missionId, action: "WEATHER_REPLAN", tokenHash: telegramTokenHash(token), expiresAt: new Date(Date.now() + ACTION_TTL_MS) });
    const title = input.demo ? "DEMO PERINGATAN HUJAN" : "PERINGATAN HUJAN";
    const text = `<b>${title}</b>\n\n<b>Misi:</b> ${escapeHtml(mission.originalMessage)}\n<b>Perubahan:</b> ${escapeHtml(input.change)}\n<b>Kegiatan terdampak:</b> ${escapeHtml(input.activity)}\n<b>Dampak:</b> ${escapeHtml(input.impact)}\n<b>Saran:</b> ${escapeHtml(input.recommendation)}\n<b>Status:</b> Belum ada perubahan jadwal. TUNAS akan membuat usulan yang tetap memerlukan persetujuan.`;
    try {
      const sent = await this.api<{ message_id: number }>("sendMessage", { chat_id: connection.telegramChatId, text, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Buat usulan ulang", callback_data: `action:${token}:generate` }]] } });
      await this.repository.bindActionMessage(pending.telegramActionId, String(sent.message_id));
      return { delivered: true as const, telegramMessageId: String(sent.message_id) };
    } catch (error) {
      await this.repository.deleteAction(pending.telegramActionId);
      throw error;
    }
  }

  async setWebhook() {
    const { webhookSecret, webhookUrl } = this.configuration();
    await this.api("setWebhook", { url: webhookUrl, secret_token: webhookSecret, allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
    await this.api("setMyCommands", { commands: [{ command: "bantuan", description: "Lihat kemampuan dan contoh TUNAS" }] });
  }

  private async message(message: TelegramMessage, updateId?: number) {
    const match = message.text?.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{20,80})$/);
    if (!message.text) return;
    if (message.chat.type !== "private" || !message.from || String(message.chat.id) !== String(message.from.id)) {
      await this.api("sendMessage", { chat_id: message.chat.id, text: "Hubungkan akun melalui chat pribadi dengan bot TUNAS." });
      return;
    }
    if (match) {
      try {
        const result = await this.repository.consumeLink(telegramTokenHash(match[1]), { telegramUserId: String(message.from.id), telegramChatId: String(message.chat.id), telegramUsername: message.from.username ?? null, telegramFirstName: message.from.first_name ?? null });
        const text = result.status === "LINKED" ? "Telegram berhasil terhubung ke akun TUNAS. Peringatan misi akan dikirim ke chat ini." : result.status === "CONNECTED" ? "Akun TUNAS ini sudah terhubung ke Telegram." : "Tautan sudah tidak berlaku. Buat tautan baru dari halaman Farm.";
        await this.api("sendMessage", { chat_id: message.chat.id, text });
      } catch {
        await this.api("sendMessage", { chat_id: message.chat.id, text: "Akun Telegram ini sudah terhubung ke akun TUNAS lain." });
      }
      return;
    }
    const connection = await this.repository.identity(String(message.from.id), String(message.chat.id));
    if (!connection) { await this.api("sendMessage", { chat_id: message.chat.id, text: "Telegram belum terhubung. Hubungkan dari halaman Farm di TUNAS." }); return; }
    let text: string; let stage = "route_intent";
    try {
      const externalMessageId = telegramExternalMessageId(updateId, message.chat.id, message.message_id);
      const open = await this.repository.openOperationalPending(connection.userId);
      const replanClarification = open ? null : await this.repository.openReplanClarification(connection.userId);
      if (/^\/bantuan(?:@\w+)?\s*$/i.test(message.text)) { text = commandHelp(); }
      else {
        const route = await this.queries.route(connection.userId, message.text, open?.kind === "CLARIFICATION" ? "REPORT" : replanClarification ? "REPLAN" : null);
        if (open?.kind === "CLARIFICATION" && route.intent === "CANCEL") text = renderOperationalState(await (await this.operations()).cancel(connection.userId, open.pendingActionId));
        else if (open?.kind === "CLARIFICATION" && (route.continuation || route.intent === "REPORT")) {
          stage = "resume_report";
          const result = await (await this.operations()).interact(connection.userId, { message: message.text, missionId: open.missionId, channel: "telegram", externalMessageId, forcedTrigger: "UPDATE" });
          await this.sendOperationalState(connection, message, result, externalMessageId);
          return;
        } else if (open?.kind === "CLARIFICATION") text = "Jawab pertanyaan klarifikasi sebelumnya, atau katakan bahwa Anda ingin membatalkannya.";
        else if (route.intent === "REPORT") {
          if (open) text = "Selesaikan laporan yang sedang menunggu melalui tombol Setujui/Tolak, atau katakan bahwa Anda ingin membatalkannya.";
          else {
            stage = "prepare_report";
            const result = await (await this.operations()).interact(connection.userId, { message: message.text, missionId: null, channel: "telegram", externalMessageId, forcedTrigger: "UPDATE" });
            stage = "send_report_preview";
            await this.sendOperationalState(connection, message, result, externalMessageId);
            return;
          }
        } else if (route.intent === "REPLAN") {
          if (open) text = "Selesaikan atau batalkan laporan yang sedang menunggu sebelum membuat rencana ulang.";
          else {
            const mission = replanClarification ? { missionId: replanClarification.missionId, farmId: replanClarification.farmId } : await this.repository.ownerCurrentMission(connection.userId);
            if (!mission) text = "Tidak ada misi aktif yang dapat direncanakan ulang.";
            else {
              stage = "prepare_replan";
              const previous = replanClarification?.payload as { messages?: string[] } | null;
              const messages = [...(previous?.messages ?? []), message.text].slice(-8);
              const transcript = messages.join("\n");
              const preview = await this.missions.replanFromInstruction(connection.userId, mission.missionId, transcript);
              if (preview.status === "clarification") {
                stage = "record_replan_clarification";
                if (replanClarification) await this.repository.updateActionPayload(replanClarification.telegramActionId, { messages, question: preview.question });
                else await this.repository.createAction({ telegramConnectionId: connection.telegramConnectionId, farmId: mission.farmId, missionId: mission.missionId, action: "REPLAN_CLARIFICATION", tokenHash: telegramTokenHash(telegramToken()), expiresAt: new Date(Date.now() + ACTION_TTL_MS), payload: { messages, question: preview.question } });
                text = preview.question;
              } else {
                if (replanClarification) await this.repository.resolveAction(replanClarification.telegramActionId);
                stage = "send_replan_proposal"; await this.sendPreparedReplanProposal(connection.userId, mission.missionId, message.chat.id, message.message_id, preview); return;
              }
            }
          }
        } else if (route.intent === "STATUS") text = renderMissionStatus(await this.repository.ownerCurrentMission(connection.userId));
        else if (route.intent === "CANCEL") {
          if (open) text = renderOperationalState(await (await this.operations()).cancel(connection.userId, open.pendingActionId));
          else {
            if (replanClarification) await this.repository.resolveAction(replanClarification.telegramActionId);
            text = (await this.queries.respond(connection.userId, message.text, externalMessageId, "Baik, percakapan sebelumnya dibatalkan. Tidak ada data yang diubah.", "CANCEL")).message;
          }
        }
        else if (route.intent === "UNKNOWN") text = (await this.queries.respond(connection.userId, message.text, externalMessageId, "Saya belum memahami maksudnya. Coba jelaskan apakah Anda ingin bertanya, melaporkan kondisi, atau membuat rencana ulang. Ketik /bantuan untuk contoh.", "UNKNOWN")).message;
        else text = (await this.queries.ask(connection.userId, message.text, externalMessageId, "GENERAL")).message;
      }
    } catch (error) {
      console.warn("Telegram message workflow failed", { stage, kind: error instanceof Error ? error.name : "unknown_error" });
      text = error instanceof ApiError ? escapeHtml(error.message) : stage.includes("report") ? "Laporan belum dapat diproses. Coba lagi sebentar." : stage.includes("replan") ? "Rencana ulang belum dapat diproses. Coba lagi sebentar." : "TUNAS belum dapat menjawab. Coba lagi sebentar.";
    }
    await this.api("sendMessage", { chat_id: message.chat.id, reply_to_message_id: message.message_id, text, parse_mode: "HTML" });
  }

  private async callback(callback: TelegramCallback) {
    const match = callback.data?.match(/^action:([A-Za-z0-9_-]{20,80}):(approve|reject|generate)$/);
    if (!match || !callback.message) return;
    const action = await this.repository.action(telegramTokenHash(match[1]));
    if (!telegramCallbackAuthorized(action, callback)) { await this.answer(callback.id, "Tindakan tidak sah atau diteruskan dari chat lain.", true); return; }
    if (action.consumedAt || action.expiresAt <= new Date()) { await this.answer(callback.id, "Tindakan sudah dipakai atau kedaluwarsa.", true); return; }
    const consumedAt = new Date();
    if (!await this.repository.consumeAction(action.telegramActionId, consumedAt)) { await this.answer(callback.id, "Tindakan sudah dipakai atau kedaluwarsa.", true); return; }
    try {
      await this.handleAction(action, match[2] as "approve" | "reject" | "generate", callback.message);
      await this.answer(callback.id, "Keputusan diproses.");
      await this.api("editMessageReplyMarkup", { chat_id: callback.message.chat.id, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
    } catch (error) {
      await this.repository.releaseAction(action.telegramActionId, consumedAt);
      await this.answer(callback.id, error instanceof ApiError ? error.message : "Tindakan belum dapat diproses. Coba lagi.", true);
    }
  }

  private async operations() {
    if (!this.operationalApi) { const { TunasService } = await import("../tunas/tunas.service"); this.operationalApi = new TunasService(); }
    return this.operationalApi;
  }

  private async sendOperationalState(connection: { userId: string; telegramConnectionId: string; telegramChatId: string }, message: TelegramMessage, state: TunasState, externalMessageId: string) {
    const pending = state.pendingAction;
    const text = renderOperationalState(state);
    if (!pending || pending.status !== "PENDING" || pending.kind === "CLARIFICATION" || !state.missionId) {
      await this.api("sendMessage", { chat_id: message.chat.id, reply_to_message_id: message.message_id, text, parse_mode: "HTML" });
      return;
    }
    const token = telegramToken();
    const mission = await this.repository.ownerMission(connection.userId, state.missionId);
    if (!mission) throw new ApiError(404, "Misi laporan tidak ditemukan.");
    const action = await this.repository.createAction({ telegramConnectionId: connection.telegramConnectionId, farmId: mission.farmId, missionId: state.missionId, action: "REPORT_DECISION", tokenHash: telegramTokenHash(token), expiresAt: new Date(Date.now() + ACTION_TTL_MS), externalMessageId, payload: { pendingActionId: pending.pendingActionId, report: (pending.preview as { after?: unknown }).after } });
    if (action.telegramMessageId) return;
    try {
      const sent = await this.api<{ message_id: number }>("sendMessage", { chat_id: message.chat.id, reply_to_message_id: message.message_id, text, parse_mode: "HTML", reply_markup: decisionKeyboard(token) });
      await this.repository.bindActionMessage(action.telegramActionId, String(sent.message_id));
    } catch (error) { await this.repository.deleteAction(action.telegramActionId); throw error; }
  }

  private async handleAction(action: CallbackAction, decision: "approve" | "reject" | "generate", message: TelegramMessage) {
    const ownerId = action.connection.userId!;
    const payload = action.payload as { pendingActionId?: string; report?: OperationalReportInput; previewToken?: string; planId?: string } | null;
    if (action.action === "WEATHER_REPLAN" && decision === "generate") { await this.sendReplanProposal(ownerId, action.missionId!, message.chat.id, message.message_id, payload?.report); return; }
    if (action.action === "REPORT_DECISION" && payload?.pendingActionId && decision !== "generate") {
      const state = decision === "approve" ? await (await this.operations()).approve(ownerId, payload.pendingActionId) : await (await this.operations()).reject(ownerId, payload.pendingActionId);
      await this.api("sendMessage", { chat_id: message.chat.id, reply_to_message_id: message.message_id, text: renderOperationalState(state), parse_mode: "HTML" });
      if (decision === "approve" && state.impact?.replanSupported && payload.report) {
        await this.sendReplanOffer(action.connection.telegramConnectionId!, action.farmId, action.missionId!, message.chat.id, message.message_id, payload.report);
      }
      return;
    }
    if (action.action === "REPLAN_DECISION" && payload?.previewToken && payload.planId && decision !== "generate") {
      if (decision === "reject") { await this.api("sendMessage", { chat_id: message.chat.id, reply_to_message_id: message.message_id, text: "Usulan rencana ulang ditolak. Rencana aktif tidak berubah." }); return; }
      await this.missions.confirmReplan(ownerId, action.missionId!, { previewToken: payload.previewToken, planId: payload.planId });
      await this.api("sendMessage", { chat_id: message.chat.id, reply_to_message_id: message.message_id, text: "Rencana ulang disetujui dan sekarang menjadi rencana aktif. Kegiatan yang sudah selesai tetap dipertahankan." });
      return;
    }
    throw new ApiError(409, "Keputusan tidak cocok dengan tindakan ini.");
  }

  private async sendReplanOffer(telegramConnectionId: string, farmId: string, missionId: string, chatId: number | string, replyTo: number, report: OperationalReportInput) {
    const token = telegramToken();
    const action = await this.repository.createAction({ telegramConnectionId, farmId, missionId, action: "WEATHER_REPLAN", tokenHash: telegramTokenHash(token), expiresAt: new Date(Date.now() + ACTION_TTL_MS), payload: { report } });
    try {
      const sent = await this.api<{ message_id: number }>("sendMessage", { chat_id: chatId, reply_to_message_id: replyTo, text: "Kondisi ini dapat memengaruhi kegiatan yang belum selesai. Buat usulan rencana ulang berdasarkan laporan ini?", reply_markup: { inline_keyboard: [[{ text: "Buat rencana ulang", callback_data: `action:${token}:generate` }]] } });
      await this.repository.bindActionMessage(action.telegramActionId, String(sent.message_id));
    } catch (error) { await this.repository.deleteAction(action.telegramActionId); throw error; }
  }

  private async sendReplanProposal(ownerId: string, missionId: string, chatId: number | string, replyTo: number, report?: OperationalReportInput, instruction?: string) {
    const preview = report ? await this.missions.replanFromReport(ownerId, missionId, report) : await this.missions.replanFromInstruction(ownerId, missionId, instruction);
    if (preview.status === "clarification") { await this.api("sendMessage", { chat_id: chatId, reply_to_message_id: replyTo, text: escapeHtml(preview.question), parse_mode: "HTML" }); return; }
    await this.sendPreparedReplanProposal(ownerId, missionId, chatId, replyTo, preview);
  }

  private async sendPreparedReplanProposal(ownerId: string, missionId: string, chatId: number | string, replyTo: number, preview: Exclude<Awaited<ReturnType<MissionService["replanFromInstruction"]>>, { status: "clarification" }>) {
    if (preview.status === "infeasible") { await this.api("sendMessage", { chat_id: chatId, reply_to_message_id: replyTo, text: `<b>Tidak ada rencana ulang yang layak</b>\n\n${escapeHtml(preview.blockers.join(" "))}`, parse_mode: "HTML" }); return; }
    const recommended = preview.candidates.find((item) => item.planId === preview.recommendation.planId)!;
    const mission = await this.repository.ownerMission(ownerId, missionId); if (!mission?.farm.owner.telegramConnection) throw new ApiError(409, "Telegram connection is unavailable");
    const token = telegramToken();
    const pending = await this.repository.createAction({ telegramConnectionId: mission.farm.owner.telegramConnection.telegramConnectionId, farmId: mission.farmId, missionId, action: "REPLAN_DECISION", tokenHash: telegramTokenHash(token), expiresAt: new Date(Date.now() + ACTION_TTL_MS), payload: { previewToken: preview.previewToken, planId: recommended.planId } });
    const activities = recommended.activities.map((item) => `• ${escapeHtml(localizePlanText(item.title))}: ${formatDate(item.startsOn)} - ${formatDate(item.endsOn)}`).join("\n");
    const text = `<b>Usulan rencana ulang</b>\n\n${escapeHtml(localizePlanText(recommended.name))}\n${escapeHtml(localizePlanText(recommended.summary))}\n\n<b>Kegiatan mendatang</b>\n${activities}\n\n<b>Alasan utama</b>\n${escapeHtml(localizePlanText(preview.recommendation.reasons.join(" ")))}\n\nKegiatan yang sudah selesai tidak akan diubah.`;
    try { const sent = await this.api<{ message_id: number }>("sendMessage", { chat_id: chatId, reply_to_message_id: replyTo, text, parse_mode: "HTML", reply_markup: decisionKeyboard(token) }); await this.repository.bindActionMessage(pending.telegramActionId, String(sent.message_id)); }
    catch (error) { await this.repository.deleteAction(pending.telegramActionId); throw error; }
  }

  private answer(callbackQueryId: string, text: string, showAlert = false) { return this.api("answerCallbackQuery", { callback_query_id: callbackQueryId, text, show_alert: showAlert }); }

  private async username() {
    if (this.botUsername) return this.botUsername;
    const bot = await this.api<{ username?: string }>("getMe");
    if (!bot.username) throw new ApiError(503, "Username bot Telegram tidak tersedia.");
    this.botUsername = bot.username;
    return bot.username;
  }

  private configuration() {
    if (!env.telegramBotToken || !env.telegramWebhookSecret || !env.ngrokDomain) throw new ApiError(503, "Konfigurasi Telegram belum lengkap.");
    return { webhookSecret: env.telegramWebhookSecret, webhookUrl: `${env.ngrokDomain}/api/telegram/webhook` };
  }

  private async api<T = unknown>(method: string, body?: Record<string, unknown>): Promise<T> {
    if (!env.telegramBotToken) throw new ApiError(503, "Token bot Telegram belum tersedia.");
    const response = await this.fetcher(`https://api.telegram.org/bot${env.telegramBotToken}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const payload = await response.json().catch(() => null) as { ok?: boolean; result?: T; description?: string } | null;
    if (!response.ok || !payload?.ok) throw new ApiError(503, payload?.description ? `Telegram gagal: ${payload.description}` : "Layanan Telegram tidak tersedia.");
    return payload.result as T;
  }
}

function escapeHtml(value: string) { return value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!); }
function decisionKeyboard(token: string) { return { inline_keyboard: [[{ text: "Setujui", callback_data: `action:${token}:approve` }, { text: "Tolak", callback_data: `action:${token}:reject` }]] }; }
function commandHelp(intro = "Saya dapat membantu percakapan berikut:") {
  return `<b>Bantuan TUNAS</b>\n\n${escapeHtml(intro)}\n\n<b>Tanya</b>\n“Apa kegiatan berikutnya?”\n\n<b>Lapor</b>\n“Hujan mulai sekarang.”\n“Panen sudah selesai, hasilnya 80 kg.”\n\n<b>Rencana ulang</b>\n“Atur ulang jadwal karena hujan.”\n\n<b>Status</b>\n“Bagaimana status misi saya?”\n\n<b>Batal</b>\n“Batalkan laporan ini.”\n\nKetik <code>/bantuan</code> kapan saja untuk melihat contoh ini.`;
}
function renderMissionStatus(mission: Awaited<ReturnType<TelegramRepository["ownerCurrentMission"]>>) {
  if (!mission) return "Tidak ada misi aktif.";
  const completed = mission.missionSteps.filter((step) => step.status === "COMPLETED").length;
  const next = mission.missionSteps.find((step) => step.status === "IN_PROGRESS") ?? mission.missionSteps.find((step) => step.status === "SCHEDULED");
  const value = (key: string) => mission.constraints.find((item) => item.key === key)?.value;
  const targets = [typeof value("plannedHarvestKg") === "number" ? `${value("plannedHarvestKg")} kg panen` : null, typeof value("plannedDriedKg") === "number" ? `${value("plannedDriedKg")} kg kering` : null].filter(Boolean).join(" / ");
  return `<b>Status misi aktif</b>\n\n<b>Misi:</b> ${escapeHtml(mission.originalMessage)}\n<b>Tahap:</b> ${escapeHtml(stageLabel(mission.stage))}\n<b>Progres:</b> ${completed} dari ${mission.missionSteps.length} kegiatan selesai${next ? `\n<b>Berikutnya:</b> ${escapeHtml(next.title)}, ${formatDate(next.startsOn)}` : ""}${targets ? `\n<b>Target:</b> ${targets}` : ""}`;
}
function stageLabel(stage: string) { return ({ WAITING: "Menunggu pelaksanaan", HARVESTING: "Panen", DRYING: "Pengeringan", FINISHED: "Pekerjaan selesai", TO_REVIEW: "Menunggu peninjauan" } as Record<string, string>)[stage] ?? stage; }
function formatDate(value: Date | string) { return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(value)); }
function reportLabel(type: string) { return ({ ACTIVITY_STARTED: "Kegiatan dimulai", ACTIVITY_COMPLETED: "Kegiatan selesai", ACTUAL_QUANTITY_REPORTED: "Jumlah aktual", WORKER_AVAILABILITY_CHANGED: "Ketersediaan pekerja", BUYER_REQUIREMENT_CHANGED: "Kebutuhan pembeli", DRYING_RESOURCE_CHANGED: "Sumber daya pengeringan", RAIN_OR_FIELD_EVENT: "Hujan atau kejadian lapangan", MISSION_DEVIATION: "Penyimpangan misi", GENERAL_OPERATIONAL_NOTE: "Catatan operasional" } as Record<string, string>)[type] ?? type; }
function localizePlanText(value: string) { return value.replace(/Candidate\s+(\d+)/gi, "Pilihan $1").replace(/Harvest shallots/gi, "Panen bawang merah").replace(/Begin and inspect drying/gi, "Mulai dan periksa pengeringan").replace(/Harvest starts ([^;]+); drying follows harvest\./gi, "Panen dimulai $1; pengeringan dilakukan setelah panen.").replace(/Zero percent precipitation probability minimizes harvest risk\./gi, "Peluang hujan nol persen meminimalkan risiko panen."); }
function reportDetails(report: { reportType?: string; payload?: unknown }) {
  const payload = report.payload as Record<string, unknown> | undefined; if (!payload) return [];
  if (report.reportType === "ACTUAL_QUANTITY_REPORTED") return [`Jumlah: ${payload.quantityKg} kg`];
  if (report.reportType === "WORKER_AVAILABILITY_CHANGED") return [`Pekerja tersedia: ${payload.availableWorkers} orang`];
  if (report.reportType === "BUYER_REQUIREMENT_CHANGED") return [`Target: ${payload.targetQuantityKg} kg ${payload.quantityBasis === "HARVESTED" ? "panen" : "kering"}`, payload.deadline ? `Tenggat: ${payload.deadline}` : ""].filter(Boolean);
  if (report.reportType === "DRYING_RESOURCE_CHANGED") return [`Area pengeringan: ${payload.available ? "tersedia" : "tidak tersedia"}`, `Perlindungan hujan: ${payload.protectionAvailable ? "tersedia" : "tidak tersedia"}`];
  if (report.reportType === "RAIN_OR_FIELD_EVENT") return [`Kejadian: ${payload.event}`];
  if (report.reportType === "MISSION_DEVIATION") return [`Keterangan: ${payload.description}`];
  if (report.reportType === "GENERAL_OPERATIONAL_NOTE") return [`Catatan: ${payload.text}`];
  return [];
}
function renderOperationalState(state: TunasState) {
  const pending = state.pendingAction;
  if (!pending) return escapeHtml(state.message);
  if (pending.kind === "CLARIFICATION") return `<b>Perlu klarifikasi</b>\n\n${escapeHtml(String((pending.preview as { question?: unknown }).question ?? state.message))}`;
  if (pending.status !== "PENDING") {
    const title = pending.status === "APPROVED" ? "Laporan disimpan" : pending.status === "REJECTED" ? "Laporan ditolak" : pending.status === "STALE" ? "Data misi berubah" : pending.status === "SUPERSEDED" ? "Laporan digantikan" : "Laporan diproses";
    const impact = state.impact ? `\n\n<b>Dampak:</b> ${state.impact.level === "MATERIAL" ? "Material" : "Tidak material"}${state.impact.reasons.length ? `\n${state.impact.reasons.map((reason) => `• ${escapeHtml(reason)}`).join("\n")}` : ""}` : "";
    return `<b>${title}</b>\n\n${pending.status === "APPROVED" ? "Data operasional telah dicatat." : pending.status === "STALE" ? "Laporan tidak disimpan karena kondisi misi berubah. Kirim laporan baru jika masih berlaku." : "Rencana aktif tidak berubah."}${impact}`;
  }
  const report = (pending.preview as { after?: unknown }).after as { reportType?: string; observedAt?: string; payload?: unknown; narrative?: string } | undefined;
  if (!report) return escapeHtml(state.message);
  const details = reportDetails(report).map((item) => `• ${escapeHtml(item)}`).join("\n");
  return `<b>Tinjau laporan operasional</b>\n\n<b>Jenis:</b> ${escapeHtml(reportLabel(report.reportType ?? "-"))}\n<b>Waktu:</b> ${report.observedAt ? formatDate(report.observedAt) : "-"}${details ? `\n\n${details}` : ""}${report.narrative ? `\n<b>Catatan:</b> ${escapeHtml(report.narrative)}` : ""}\n\nData belum disimpan. Setujui atau tolak laporan ini.`;
}
