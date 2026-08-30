import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildTelegramQueryGraph, classifyTelegramIntent, createTelegramAnswerer, createTelegramRouter, deterministicTelegramIntent, fallbackTelegramAnswer, renderTelegramAnswer } from "../../agent/telegram-query-agent";
import { TunasRepository } from "../tunas/tunas.repository";
import { telegramToken, telegramTokenHash } from "./telegram.repository";
import { TelegramService, telegramCallbackAuthorized, telegramExternalMessageId } from "./telegram.service";
import { TelegramQueryService } from "./telegram-query.service";
import { env } from "../../config/env";

const action = { action: "MOCK_REPLAN", farmId: "farm", telegramMessageId: "42", connection: { telegramUserId: "7", telegramChatId: "7" }, mission: { farmId: "farm" } };
const callback = { id: "callback", from: { id: 7 }, message: { message_id: 42, chat: { id: 7, type: "private" } } };
const updatedAt = new Date("2026-08-28T10:00:00.000Z");

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

test("status exposes the cached bot link without depending on Telegram availability", async () => {
  const previousToken = env.telegramBotToken;
  env.telegramBotToken = "test-token";
  let calls = 0;
  const repository = { status: async () => ({ telegramUsername: "pakrudi", telegramFirstName: "Rudi", linkedAt: updatedAt }) };
  const fetcher = async () => { calls++; return new Response(JSON.stringify({ ok: true, result: { username: "TunasDemoBot" } }), { status: 200 }); };
  try {
    const service = new TelegramService(repository as never, fetcher as typeof fetch);
    assert.equal((await service.status("owner")).botUrl, "https://t.me/TunasDemoBot");
    assert.equal((await service.status("owner")).botUrl, "https://t.me/TunasDemoBot");
    assert.equal(calls, 1);
  } finally { env.telegramBotToken = previousToken; }
});

test("routes Telegram operational reports to a bound approval preview", async () => {
  let queryCalls = 0; let actionPayload: unknown; let interactionInput: { message: string; forcedTrigger?: string } | undefined; const requests: Array<Record<string, unknown>> = [];
  const repository = {
    identity: async () => ({ userId: "owner", telegramConnectionId: "connection", telegramChatId: "7" }), openOperationalPending: async () => null, openReplanClarification: async () => null,
    ownerMission: async () => ({ farmId: "farm", farm: { owner: { telegramConnection: { telegramConnectionId: "connection" } } } }),
    createAction: async (input: { payload: unknown }) => { actionPayload = input.payload; return { telegramActionId: "action" }; }, bindActionMessage: async () => undefined, deleteAction: async () => undefined,
  };
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => { requests.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), { status: 200 }); };
  const queries = { route: async () => ({ intent: "REPORT", continuation: false, history: [] }), ask: async () => { queryCalls++; throw new Error("query path should not run"); } };
  const operations = {
    interact: async (_owner: string, input: { message: string; forcedTrigger?: string }) => {
      interactionInput = input;
      return { threadId: "thread", interactionId: "interaction", missionId: "mission", trigger: "UPDATE", message: "review", pendingAction: { pendingActionId: "pending", kind: "OPERATIONAL_REPORT", status: "PENDING", preview: { before: null, after: { reportType: "ACTUAL_QUANTITY_REPORTED", observedAt: updatedAt.toISOString(), payload: { quantityKg: 70 } } }, actions: { approve: "", reject: "" } } };
    },
    approve: async () => { throw new Error("unused"); }, reject: async () => { throw new Error("unused"); }, cancel: async () => { throw new Error("unused"); },
  };
  const service = new TelegramService(repository as never, fetcher as typeof fetch, queries as never, operations as never, {} as never);
  await service.webhook({ update_id: 10, message: { message_id: 20, text: "hasil aktual 70 kg", chat: { id: 7, type: "private" }, from: { id: 7 } } });
  assert.equal(queryCalls, 0);
  assert.equal(interactionInput?.message, "hasil aktual 70 kg");
  assert.equal(interactionInput?.forcedTrigger, "UPDATE");
  assert.deepEqual(actionPayload, { pendingActionId: "pending", report: { reportType: "ACTUAL_QUANTITY_REPORTED", observedAt: updatedAt.toISOString(), payload: { quantityKg: 70 } } });
  assert.match(JSON.stringify(requests), /Setujui/);
  assert.match(JSON.stringify(requests), /Tinjau laporan operasional/);
});

test("keeps A07/A08 Telegram templates human-readable", () => {
  const service = readFileSync("src/features/telegram/telegram.service.ts", "utf8");
  assert.match(service, /TUNAS sedang menyiapkan usulan jadwal baru/);
  assert.match(service, /Belum ada perubahan yang diterapkan/);
  assert.match(service, /Setujui Replan/);
  assert.match(service, /CONFIRM_READINESS_WEATHER: "Periksa kesiapan tanaman dan lahan"/);
  assert.match(service, /TRANSFER_TO_DRYING: "Pindahkan hasil ke area pengeringan"/);
  assert.match(service, /recommendation\.reasons\.map\(\(reason\) => `• \$\{escapeHtml\(localizePlanText\(reason\.text\)\)\}`\)/);
  assert.doesNotMatch(service, /recommendation\.reasons\.join/);
  assert.doesNotMatch(service, /escapeHtml\(reason\)/);
});

test("does not reopen completed decisions after Telegram delivery failures", () => {
  const service = readFileSync("src/features/telegram/telegram.service.ts", "utf8");
  assert.match(service, /consumeAction[\s\S]+answer callback[\s\S]+handleAction/);
  assert.match(service, /Keputusan sedang diproses/);
  assert.match(service, /await this\.handleAction[\s\S]+catch \(error\) \{\s+await this\.repository\.releaseAction/);
  assert.match(service, /await this\.bestEffort\("answer callback"/);
  assert.match(service, /await this\.bestEffort\("remove callback buttons"/);
  assert.match(service, /await this\.bestEffort\("send report decision"/);
  assert.match(service, /send replan decision fallback/);
  assert.match(service, /Laporan sudah disimpan, tetapi usulan jadwal baru belum berhasil dibuat/);
  assert.equal((service.match(/releaseAction\(/g) ?? []).length, 1);
});

test("confirms an applied replan before waiting for Calendar synchronization", async () => {
  const previousToken = env.telegramBotToken; env.telegramBotToken = "test-token";
  const order: string[] = []; const sent: Array<Record<string, unknown>> = [];
  const repository = {
    action: async () => ({ telegramActionId: "action", action: "REPLAN_DECISION", farmId: "farm", missionId: "mission", telegramMessageId: "40", expiresAt: new Date(Date.now() + 60_000), consumedAt: null, payload: { previewToken: "preview", planId: "plan", summary: { missionName: "Panen Blok Utara" } }, connection: { userId: "owner", telegramUserId: "7", telegramChatId: "7" }, mission: { farmId: "farm" } }),
    consumeAction: async () => true, releaseAction: async () => undefined, updateActionPayload: async () => undefined,
  };
  const missions = {
    confirmReplan: async () => { order.push("confirm"); return { mission: {}, calendarSync: { status: "PENDING" } }; },
    syncCalendar: async () => { order.push("calendar"); return null; },
  };
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>; sent.push(body);
    if (body.text && String(body.text).includes("Replan disetujui")) order.push("message");
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
  };
  try {
    const service = new TelegramService(repository as never, fetcher as typeof fetch, {} as never, null, missions as never);
    await service.webhook({ callback_query: { id: "callback", data: `action:${"a".repeat(20)}:approve`, from: { id: 7 }, message: { message_id: 40, chat: { id: 7, type: "private" } } } });
    assert.deepEqual(order, ["confirm", "message", "calendar"]);
    assert.match(JSON.stringify(sent), /Keputusan sedang diproses/);
    assert.match(JSON.stringify(sent), /Replan disetujui/);
  } finally { env.telegramBotToken = previousToken; }
});

test("replays a stored terminal result without applying the replan twice", async () => {
  const previousToken = env.telegramBotToken; env.telegramBotToken = "test-token";
  let confirms = 0; const sent: Array<Record<string, unknown>> = [];
  const repository = { action: async () => ({ telegramActionId: "action", action: "REPLAN_DECISION", farmId: "farm", missionId: "mission", telegramMessageId: "40", expiresAt: new Date(Date.now() + 60_000), consumedAt: new Date(), payload: { terminalText: "Replan disetujui dan tersimpan." }, connection: { userId: "owner", telegramUserId: "7", telegramChatId: "7" }, mission: { farmId: "farm" } }) };
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }); };
  try {
    const service = new TelegramService(repository as never, fetcher as typeof fetch, {} as never, null, { confirmReplan: async () => { confirms++; } } as never);
    await service.webhook({ callback_query: { id: "callback", data: `action:${"a".repeat(20)}:approve`, from: { id: 7 }, message: { message_id: 40, chat: { id: 7, type: "private" } } } });
    assert.equal(confirms, 0);
    assert.match(JSON.stringify(sent), /Replan disetujui dan tersimpan/);
  } finally { env.telegramBotToken = previousToken; }
});

test("persists only the active replan clarification transcript", async () => {
  let payload: unknown; const requests: Array<Record<string, unknown>> = [];
  const repository = { identity: async () => ({ userId: "owner", telegramConnectionId: "connection", telegramChatId: "7" }), openOperationalPending: async () => null, openReplanClarification: async () => ({ telegramActionId: "clarification", missionId: "mission", payload: { messages: ["Atur ulang karena hujan"] } }), updateActionPayload: async (_id: string, value: unknown) => { payload = value; } };
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => { requests.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ ok: true, result: { message_id: 100 } }), { status: 200 }); };
  const queries = { route: async () => ({ intent: "REPLAN", continuation: true }) };
  const missions = { replanFromInstruction: async (_owner: string, _mission: string, transcript: string) => { assert.equal(transcript, "Atur ulang karena hujan\n3"); return { status: "clarification", missionId: "mission", question: "Apakah tiga pekerja tersedia sepanjang hari?" }; } };
  const service = new TelegramService(repository as never, fetcher as typeof fetch, queries as never, null, missions as never);
  await service.webhook({ update_id: 11, message: { message_id: 21, text: "3", chat: { id: 7, type: "private" }, from: { id: 7 } } });
  assert.deepEqual(payload, { messages: ["Atur ulang karena hujan", "3"], question: "Apakah tiga pekerja tersedia sepanjang hari?" });
  assert.match(JSON.stringify(requests), /Apakah tiga pekerja/);
});

test("uses the shared structured runtime for grounded Indonesian conversation", async () => {
  let prompt = "";
  const output = { title: "Prioritas", answer: "Misi pengeringan paling mendesak karena jadwalnya besok.", listTitle: "Yang perlu disiapkan:", items: ["Siapkan penutup."], details: ["Tahap: pengeringan"], clarification: null };
  const answerer = createTelegramAnswerer(() => ({ withStructuredOutput: () => ({ invoke: async (messages: Array<{ content: unknown }>) => { prompt = messages.map((message) => String(message.content)).join("\n"); return output; } }) }));
  assert.deepEqual(await answerer({ question: "Mana yang mendesak?", context: { missions: [{ status: "ACTIVE" }] } }), output);
  assert.doesNotMatch(prompt, /Bahas misi|RIWAYAT/);
  assert.match(prompt, /Bedakan fakta tersimpan dari saran/);
  assert.match(prompt, /Jangan membuat bagian "Fakta utama" atau "Saran"/);
  assert.match(prompt, /Mana yang mendesak/);
});

test("routes ambiguous messages without Telegram history or farm context", async () => {
  let prompt = "";
  const router = createTelegramRouter(() => ({ withStructuredOutput: () => ({ invoke: async (messages: Array<{ content: unknown }>) => { prompt = messages.map((item) => String(item.content)).join("\n"); return { intent: "REPLAN", continuation: true }; } }) }));
  assert.deepEqual(await router({ message: "3" }), { intent: "REPLAN", continuation: true });
  assert.doesNotMatch(prompt, /Berapa pekerja yang tersedia/);
  assert.match(prompt, /MESSAGE: "3"/);
  assert.match(prompt, /tanpa riwayat atau data kebun/);
});

test("routes obvious reports without loading context, history, or the model", async () => {
  let calls = 0;
  const service = new TelegramQueryService({} as TunasRepository, async () => { throw new Error("unused"); }, async () => { calls += 1; throw new Error("unused"); });
  assert.deepEqual(await service.route("owner", "hujan mulai sekarang", null), { intent: "REPORT", continuation: false });
  assert.equal(calls, 0);
});

test("LangGraph loads authoritative context without conversation history", async () => {
  let received: { question: string; context: unknown; guidance?: string } | undefined;
  const repository = { queryContext: async (farmId: string) => ({ name: "Kebun Makmur", farmId, missions: [] }), recentConversation: async (_farmId: string, channel: string, limit: number) => [{ role: "user", content: `${channel}:${limit}` }] } as unknown as TunasRepository;
  const graph = buildTelegramQueryGraph(repository, async (input) => { received = input; return { title: "Pilihan", answer: "Mari bandingkan dua pilihan itu.", listTitle: null, items: ["Tinjau jadwal."], details: [], clarification: null }; }, async () => ({ intent: "ADVISORY" }));
  const result = await graph.invoke({ farmId: "farm-1", question: "Bagaimana kalau panen ditunda?" });
  assert.match(result.answer, /<b>Pilihan<\/b>/);
  assert.match(result.answer, /• Tinjau jadwal\./);
  assert.deepEqual(received, { question: "Bagaimana kalau panen ditunda?", context: { name: "Kebun Makmur", farmId: "farm-1", missions: [] }, guidance: "Berikan beberapa pilihan praktis; pisahkan setiap saran dari fakta tersimpan." });
  assert.equal(result.intent, "ADVISORY");
  assert.equal(result.routingSource, "AI");
});

test("routes mutation requests to a deterministic read-only response", async () => {
  let answerCalls = 0;
  const repository = { queryContext: async () => ({ missions: [] }), recentConversation: async () => [] } as unknown as TunasRepository;
  const graph = buildTelegramQueryGraph(repository, async () => { answerCalls += 1; return {}; }, async () => ({ intent: "MUTATION_REQUEST" }));
  const result = await graph.invoke({ farmId: "farm", question: "Ubah jadwal panen besok" });
  assert.equal(answerCalls, 0);
  assert.equal(result.intent, "MUTATION_REQUEST");
  assert.match(result.answer, /Mode baca saja/);
  assert.match(result.answer, /Tidak ada data yang diubah/);
});

test("falls back to deterministic intent routing when classification fails", async () => {
  assert.equal(deterministicTelegramIntent("Apa status misi saya?"), "FACTUAL_QUERY");
  assert.equal(deterministicTelegramIntent("Tolong ubah jadwal"), "MUTATION_REQUEST");
  assert.equal(deterministicTelegramIntent("Panen sudah selesai"), "OPERATIONAL_REPORT");
  assert.deepEqual(await classifyTelegramIntent("Bagaimana kalau panen ditunda?", async () => { throw new Error("offline"); }), { intent: "ADVISORY", routingSource: "DETERMINISTIC_FALLBACK", routingFailure: "PROVIDER_FAILURE" });
});

test("rejects invalid input before loading farm data", async () => {
  let repositoryCalls = 0;
  const repository = { queryContext: async () => { repositoryCalls += 1; return {}; }, recentConversation: async () => [] } as unknown as TunasRepository;
  const graph = buildTelegramQueryGraph(repository, async () => ({}), async () => ({ intent: "GENERAL" }));
  const result = await graph.invoke({ farmId: "farm", question: "   " });
  assert.equal(repositoryCalls, 0);
  assert.equal(result.routingFailure, "INVALID_INPUT");
  assert.match(result.answer, /Pesan belum dapat diproses/);
});

test("uses a grounded deterministic fallback when answer generation fails", async () => {
  const context = { missions: [{ originalMessage: "Keringkan bawang", status: "ACTIVE", stage: "DRYING" }] };
  assert.match(fallbackTelegramAnswer(context), /Keringkan bawang/);
  const repository = { queryContext: async () => context, recentConversation: async () => [] } as unknown as TunasRepository;
  const graph = buildTelegramQueryGraph(repository, async () => { throw new Error("provider unavailable"); }, async () => ({ intent: "FACTUAL_QUERY" }));
  assert.match((await graph.invoke({ farmId: "farm", question: "Apa berikutnya?" })).answer, /ACTIVE \/ DRYING/);
});

test("renders readable Telegram HTML and escapes all model content", () => {
  const message = renderTelegramAnswer({ title: "🌱 Panen <utama>", answer: "Aman & terjadwal.", listTitle: "Persiapan:", items: ["Bandingkan A & B"], details: ["Progres: 1 < 3"], clarification: "Pilih petak > 1?" });
  assert.match(message, /^<b>🌱 Panen &lt;utama&gt;<\/b>/);
  assert.match(message, /<b>Persiapan:<\/b>\n• Bandingkan A &amp; B/);
  assert.match(message, /Progres: 1 &lt; 3/);
  assert.match(message, /Pilih petak &gt; 1\?/);
  assert.doesNotMatch(message, /Fakta utama|<b>Saran<\/b>|Perlu klarifikasi/);
  assert.doesNotMatch(message, /<utama>/);
});

test("exports the Telegram conversation graph for LangGraph Studio", () => {
  const config = JSON.parse(readFileSync("langgraph.json", "utf8")) as { graphs: Record<string, string> };
  assert.equal(config.graphs["telegram-query-agent"], "./src/agent/telegram-query-agent.ts:telegramQueryGraph");
});
