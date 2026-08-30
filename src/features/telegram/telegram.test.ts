import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildTelegramQueryGraph, createTelegramAnswerer, fallbackTelegramAnswer, renderTelegramAnswer } from "../../agent/telegram-query-agent";
import { TunasRepository } from "../tunas/tunas.repository";
import { telegramToken, telegramTokenHash } from "./telegram.repository";
import { telegramCallbackAuthorized, telegramExternalMessageId } from "./telegram.service";

const action = { action: "MOCK_REPLAN", farmId: "farm", telegramMessageId: "42", connection: { telegramUserId: "7", telegramChatId: "7" }, mission: { farmId: "farm" } };
const callback = { id: "callback", from: { id: 7 }, message: { message_id: 42, chat: { id: 7, type: "private" } } };

test("creates opaque Telegram tokens and hashes stored values", () => {
  const token = telegramToken();
  assert.match(token, /^[A-Za-z0-9_-]{20,}$/);
  assert.notEqual(telegramTokenHash(token), token);
  assert.equal(telegramTokenHash(token), telegramTokenHash(token));
});

test("binds callbacks to the Telegram user, chat, message, farm, and mission", () => {
  assert.equal(telegramCallbackAuthorized(action, callback), true);
  assert.equal(telegramCallbackAuthorized({ ...action, telegramMessageId: "41" }, callback), false);
  assert.equal(telegramCallbackAuthorized({ ...action, mission: { farmId: "other" } }, callback), false);
  assert.equal(telegramCallbackAuthorized(action, { ...callback, from: { id: 8 } }), false);
  assert.equal(telegramCallbackAuthorized(action, { ...callback, message: { ...callback.message, chat: { id: 8, type: "private" } } }), false);
});

test("uses Telegram update identity with a chat-bound message fallback", () => {
  assert.equal(telegramExternalMessageId(123, 7, 42), "update:123");
  assert.equal(telegramExternalMessageId(undefined, 7, 42), "message:7:42");
});

test("uses the shared structured runtime for grounded Indonesian conversation", async () => {
  let prompt = "";
  const output = { title: "Prioritas", summary: "Misi pengeringan paling mendesak karena jadwalnya besok.", facts: ["Tahap: pengeringan"], suggestions: ["Siapkan penutup."], clarification: null };
  const answerer = createTelegramAnswerer(() => ({ withStructuredOutput: () => ({ invoke: async (messages: Array<{ content: unknown }>) => { prompt = messages.map((message) => String(message.content)).join("\n"); return output; } }) }));
  assert.deepEqual(await answerer({ question: "Mana yang mendesak?", context: { missions: [{ status: "ACTIVE" }] }, history: [{ user: "Bahas misi", assistant: "Baik." }] }), output);
  assert.match(prompt, /RIWAYAT 15 PESAN TERAKHIR/);
  assert.match(prompt, /Bedakan fakta tersimpan dari saran/);
  assert.match(prompt, /Mana yang mendesak/);
});

test("LangGraph loads authoritative context and conversation before answering", async () => {
  let received: { question: string; context: unknown; history: unknown[] } | undefined;
  const repository = { queryContext: async (farmId: string) => ({ name: "Kebun Makmur", farmId, missions: [] }), recentConversation: async (_farmId: string, channel: string, limit: number) => [{ role: "user", content: `${channel}:${limit}` }] } as unknown as TunasRepository;
  const graph = buildTelegramQueryGraph(repository, async (input) => { received = input; return { title: "Pilihan", summary: "Mari bandingkan dua pilihan itu.", facts: [], suggestions: ["Tinjau jadwal."], clarification: null }; });
  const result = await graph.invoke({ farmId: "farm-1", question: "Bagaimana kalau panen ditunda?" });
  assert.match(result.answer, /<b>Pilihan<\/b>/);
  assert.match(result.answer, /<b>Saran<\/b>/);
  assert.deepEqual(received, { question: "Bagaimana kalau panen ditunda?", context: { name: "Kebun Makmur", farmId: "farm-1", missions: [] }, history: [{ role: "user", content: "telegram:15" }] });
});

test("uses a grounded deterministic fallback when answer generation fails", async () => {
  const context = { missions: [{ originalMessage: "Keringkan bawang", status: "ACTIVE", stage: "DRYING" }] };
  assert.match(fallbackTelegramAnswer(context), /Keringkan bawang/);
  const repository = { queryContext: async () => context, recentConversation: async () => [] } as unknown as TunasRepository;
  const graph = buildTelegramQueryGraph(repository, async () => { throw new Error("provider unavailable"); });
  assert.match((await graph.invoke({ farmId: "farm", question: "Apa berikutnya?" })).answer, /ACTIVE \/ DRYING/);
});

test("renders readable Telegram HTML and escapes all model content", () => {
  const message = renderTelegramAnswer({ title: "Panen <utama>", summary: "Aman & terjadwal.", facts: ["Progres: 1 < 3"], suggestions: ["Bandingkan A & B"], clarification: "Pilih petak > 1?" });
  assert.match(message, /^<b>Panen &lt;utama&gt;<\/b>/);
  assert.match(message, /<b>Fakta utama<\/b>\n• Progres: 1 &lt; 3/);
  assert.match(message, /<b>Saran<\/b>\n• Bandingkan A &amp; B/);
  assert.match(message, /<b>Perlu klarifikasi<\/b>/);
  assert.doesNotMatch(message, /<utama>/);
});

test("exports the Telegram conversation graph for LangGraph Studio", () => {
  const config = JSON.parse(readFileSync("langgraph.json", "utf8")) as { graphs: Record<string, string> };
  assert.equal(config.graphs["telegram-query-agent"], "./src/agent/telegram-query-agent.ts:telegramQueryGraph");
});
