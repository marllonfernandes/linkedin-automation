import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

import { loadConfig } from "../config.js";
import { FirestoreRepository } from "../clients/firestoreRepo.js";
import { SecretManagerClient } from "../clients/secretManagerClient.js";
import { TelegramClient } from "../clients/telegramClient.js";

export const LINKEDIN_TOKEN_TTL_DAYS = 60;

export async function runTokenCheckJob({
  config,
  secretManager,
  repo,
  telegramClient,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
}) {
  let daysRemaining = null;
  let tokenValid = true;

  if (secretManager?.isConfigured) {
    const meta = await secretManager.getLatestVersionMetadata("linkedin-access-token");
    const createdMs = Date.parse(meta.createTime || "");
    if (!Number.isNaN(createdMs)) {
      const ageDays = (nowMs - createdMs) / (24 * 60 * 60 * 1000);
      daysRemaining = Math.floor(LINKEDIN_TOKEN_TTL_DAYS - ageDays);
    }
  }

  if (config.linkedinAccessToken) {
    try {
      const res = await fetchImpl("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${config.linkedinAccessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 401 || res.status === 403) {
        tokenValid = false;
      }
    } catch (err) {
      console.warn(`[TokenCheck] Não foi possível consultar /v2/userinfo: ${err.message}`);
    }
  }

  const warnDays = config.linkedinTokenWarnDays || 7;
  const needsRenewal = !tokenValid || (daysRemaining !== null && daysRemaining <= warnDays);

  if (!needsRenewal) {
    console.log(
      `[TokenCheck] Token do LinkedIn saudável (${daysRemaining ?? "?"} dias restantes).`,
    );
    return { notified: false, daysRemaining, tokenValid };
  }

  const state = crypto.randomBytes(24).toString("base64url");
  await repo.saveOAuthState(state, 48 * 60 * 60 * 1000);

  const renewUrl = config.approvalServiceUrl
    ? `${config.approvalServiceUrl}/auth/linkedin/start?state=${state}`
    : "";

  const statusText = !tokenValid
    ? "⚠️ Seu token OAuth do LinkedIn está expirado ou revogado!"
    : `⚠️ Seu token OAuth do LinkedIn expira em ${Math.max(0, daysRemaining)} dia(s).`;

  const message = renewUrl
    ? `${statusText}\n\nClique no link abaixo para renovar automaticamente por mais 60 dias (1 clique, sem terminal):\n${renewUrl}`
    : `${statusText}\n\nConfigure APPROVAL_SERVICE_URL e LINKEDIN_CLIENT_ID/SECRET para renovação em 1 clique.`;

  if (!config.dryRun && telegramClient) {
    await telegramClient.sendMessage(message);
    console.log("[TokenCheck] Alerta de renovação enviado no Telegram.");
  }

  return { notified: true, daysRemaining, tokenValid, renewUrl };
}

export async function main() {
  const config = loadConfig();
  const secretManager = new SecretManagerClient({ projectId: config.gcpProjectId });
  const repo = new FirestoreRepository({
    projectId: config.gcpProjectId,
    database: config.firestoreDatabase,
  });
  const telegramClient = config.dryRun
    ? null
    : new TelegramClient({
        botToken: config.telegramBotToken,
        chatId: config.telegramChatId,
      });

  await runTokenCheckJob({
    config,
    secretManager,
    repo,
    telegramClient,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[TokenCheck] Falha fatal:", err);
    process.exit(1);
  });
}
