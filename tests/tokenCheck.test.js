import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { runTokenCheckJob } from "../src/job/tokenCheck.js";

test("runTokenCheckJob não notifica quando token tem mais de 7 dias restantes e está válido", async () => {
  const nowMs = Date.parse("2026-11-26T12:00:00Z");
  const tenDaysAgo = new Date(nowMs - 10 * 24 * 60 * 60 * 1000).toISOString();
  const sent = [];

  const result = await runTokenCheckJob({
    config: loadConfig({
      LINKEDIN_ACCESS_TOKEN: "valid-token",
      APPROVAL_SERVICE_URL: "https://service.run.app",
      LINKEDIN_TOKEN_WARN_DAYS: "7",
    }),
    secretManager: {
      isConfigured: true,
      getLatestVersionMetadata: async () => ({ createTime: tenDaysAgo }),
    },
    repo: { saveOAuthState: async () => { throw new Error("não deve salvar state"); } },
    telegramClient: { sendMessage: async (msg) => sent.push(msg) },
    fetchImpl: async () => new Response(JSON.stringify({ sub: "abc" }), { status: 200 }),
    nowMs,
  });

  assert.equal(result.notified, false);
  assert.equal(result.daysRemaining, 50);
  assert.equal(sent.length, 0);
});

test("runTokenCheckJob cria OAuth state e envia link no Telegram quando faltam <= 7 dias", async () => {
  const nowMs = Date.parse("2026-11-26T12:00:00Z");
  const fiftyFiveDaysAgo = new Date(nowMs - 55 * 24 * 60 * 60 * 1000).toISOString();
  const savedStates = [];
  const sent = [];

  const result = await runTokenCheckJob({
    config: loadConfig({
      LINKEDIN_ACCESS_TOKEN: "expiring-token",
      APPROVAL_SERVICE_URL: "https://service.run.app",
      LINKEDIN_TOKEN_WARN_DAYS: "7",
    }),
    secretManager: {
      isConfigured: true,
      getLatestVersionMetadata: async () => ({ createTime: fiftyFiveDaysAgo }),
    },
    repo: { saveOAuthState: async (state) => savedStates.push(state) },
    telegramClient: { sendMessage: async (msg) => sent.push(msg) },
    fetchImpl: async () => new Response(JSON.stringify({ sub: "abc" }), { status: 200 }),
    nowMs,
  });

  assert.equal(result.notified, true);
  assert.equal(result.daysRemaining, 5);
  assert.equal(savedStates.length, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /https:\/\/service\.run\.app\/auth\/linkedin\/start\?state=/);
});
