import { ApiError } from "../../shared/api-error";
import { env } from "../../config/env";
import { TelegramRepository, telegramToken, telegramTokenHash } from "./telegram.repository";

const LINK_TTL_MS = 10 * 60_000;
const ACTION_TTL_MS = 15 * 60_000;

type TelegramUser = { id: number | string; first_name?: string; username?: string };
type TelegramChat = { id: number | string; type: string };
type TelegramMessage = { message_id: number; text?: string; chat: TelegramChat; from?: TelegramUser };
type TelegramCallback = { id: string; data?: string; from: TelegramUser; message?: TelegramMessage };
export type TelegramUpdate = { update_id?: number; message?: TelegramMessage; callback_query?: TelegramCallback };
type AlertInput = { ownerId: string; missionId: string; demo: boolean; change: string; activity: string; impact: string; recommendation: string };
type CallbackAction = { action: string; farmId: string; telegramMessageId: string | null; connection: { telegramUserId: string; telegramChatId: string }; mission: { farmId: string } };
export function telegramCallbackAuthorized(action: CallbackAction | null, callback: TelegramCallback): action is CallbackAction { return Boolean(action && callback.message && action.action === "MOCK_REPLAN" && action.connection.telegramUserId === String(callback.from.id) && action.connection.telegramChatId === String(callback.message.chat.id) && action.telegramMessageId === String(callback.message.message_id) && action.mission.farmId === action.farmId); }

export class TelegramService {
  private botUsername: string | null = null;

  constructor(private readonly repository = new TelegramRepository(), private readonly fetcher: typeof fetch = fetch) {}

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
    if (value.message) await this.linkFromMessage(value.message);
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
    const pending = await this.repository.createAction({ telegramConnectionId: connection.telegramConnectionId, farmId: mission.farmId, missionId: mission.missionId, tokenHash: telegramTokenHash(token), expiresAt: new Date(Date.now() + ACTION_TTL_MS) });
    const title = input.demo ? "DEMO PERINGATAN HUJAN" : "PERINGATAN HUJAN";
    const text = `<b>${title}</b>\n\n<b>Misi:</b> ${escapeHtml(mission.originalMessage)}\n<b>Perubahan:</b> ${escapeHtml(input.change)}\n<b>Kegiatan terdampak:</b> ${escapeHtml(input.activity)}\n<b>Dampak:</b> ${escapeHtml(input.impact)}\n<b>Saran:</b> ${escapeHtml(input.recommendation)}\n<b>Persetujuan:</b> Belum ada perubahan jadwal. Tombol di bawah hanya simulasi MVP.`;
    try {
      const sent = await this.api<{ message_id: number }>("sendMessage", { chat_id: connection.telegramChatId, text, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "Rencanakan ulang (demo)", callback_data: `replan:${token}` }]] } });
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
  }

  private async linkFromMessage(message: TelegramMessage) {
    const match = message.text?.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{20,80})$/);
    if (!match) return;
    if (message.chat.type !== "private" || !message.from || String(message.chat.id) !== String(message.from.id)) {
      await this.api("sendMessage", { chat_id: message.chat.id, text: "Hubungkan akun melalui chat pribadi dengan bot TUNAS." });
      return;
    }
    try {
      const result = await this.repository.consumeLink(telegramTokenHash(match[1]), { telegramUserId: String(message.from.id), telegramChatId: String(message.chat.id), telegramUsername: message.from.username ?? null, telegramFirstName: message.from.first_name ?? null });
      const text = result.status === "LINKED" ? "Telegram berhasil terhubung ke akun TUNAS. Peringatan misi akan dikirim ke chat ini." : result.status === "CONNECTED" ? "Akun TUNAS ini sudah terhubung ke Telegram." : "Tautan sudah tidak berlaku. Buat tautan baru dari halaman Farm.";
      await this.api("sendMessage", { chat_id: message.chat.id, text });
    } catch {
      await this.api("sendMessage", { chat_id: message.chat.id, text: "Akun Telegram ini sudah terhubung ke akun TUNAS lain." });
    }
  }

  private async callback(callback: TelegramCallback) {
    const match = callback.data?.match(/^replan:([A-Za-z0-9_-]{20,80})$/);
    if (!match || !callback.message) return;
    const action = await this.repository.action(telegramTokenHash(match[1]));
    if (!telegramCallbackAuthorized(action, callback)) { await this.answer(callback.id, "Tindakan tidak sah atau diteruskan dari chat lain.", true); return; }
    if (action.consumedAt || action.expiresAt <= new Date()) { await this.answer(callback.id, "Tindakan sudah dipakai atau kedaluwarsa.", true); return; }
    if (!await this.repository.consumeAction(action.telegramActionId, new Date())) { await this.answer(callback.id, "Tindakan sudah dipakai atau kedaluwarsa.", true); return; }
    await this.answer(callback.id, "Simulasi rencana ulang selesai.");
    await this.api("editMessageReplyMarkup", { chat_id: callback.message.chat.id, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
    await this.api("sendMessage", { chat_id: callback.message.chat.id, reply_to_message_id: callback.message.message_id, text: "Rencana ulang dicatat (demo). Jadwal misi belum berubah." });
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
