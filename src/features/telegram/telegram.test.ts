import assert from "node:assert/strict";
import test from "node:test";
import { telegramToken, telegramTokenHash } from "./telegram.repository";
import { telegramCallbackAuthorized } from "./telegram.service";

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
