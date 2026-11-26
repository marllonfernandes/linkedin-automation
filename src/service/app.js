import crypto from "node:crypto";
import express from "express";
import { OAuth2Client } from "google-auth-library";

import { loadConfig } from "../config.js";
import { DraftStatus } from "../models.js";
import { FirestoreRepository } from "../clients/firestoreRepo.js";
import { GCSStorageClient } from "../clients/gcsClient.js";
import { LinkedInClient } from "../clients/linkedinClient.js";
import { SecretManagerClient } from "../clients/secretManagerClient.js";
import { TelegramClient } from "../clients/telegramClient.js";
import { WorkflowsCallbackClient } from "../clients/workflowsClient.js";

const VALID_DRAFT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const VALID_OAUTH_STATE_RE = /^[a-zA-Z0-9_-]{16,128}$/;
const VALID_GCS_OBJECT_RE = /^drafts\/[a-zA-Z0-9_-]{1,64}\.(png|jpg|jpeg)$/;
const APPROVAL_LINK_TTL_MS = 48 * 60 * 60 * 1000;

function createRateLimiter({ windowMs = 60_000, maxRequests = 60 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 1000) {
        for (const [k, v] of hits.entries()) {
          if (now > v.resetAt) hits.delete(k);
        }
      }
      return next();
    }
    entry.count += 1;
    if (entry.count > maxRequests) {
      return res.status(429).json({ detail: "Muitas requisições. Tente novamente em instantes." });
    }
    return next();
  };
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isValidDraftId(value) {
  return VALID_DRAFT_ID_RE.test(String(value || ""));
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function createApp({
  config = loadConfig(),
  repo = null,
  storageClient = null,
  secretManagerClient = null,
  telegramClient = null,
  workflowsClient = null,
  linkedinClient = null,
  oidcVerifier = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  // Headers defensivos para API JSON (sem dependências externas)
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });

  const publicRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60 });
  const isProd = process.env.NODE_ENV === "production";

  let cachedRepo = repo;
  let cachedStorage = storageClient;
  let cachedSecretManager = secretManagerClient;
  let cachedTelegram = telegramClient;
  let cachedWorkflows = workflowsClient;
  let cachedLinkedIn = linkedinClient;
  let activeLinkedinAccessToken = config.linkedinAccessToken;
  const oauthClient = oidcVerifier ? null : new OAuth2Client();

  const getRepo = () => {
    if (!cachedRepo) {
      cachedRepo = new FirestoreRepository({
        projectId: config.gcpProjectId,
        database: config.firestoreDatabase,
      });
    }
    return cachedRepo;
  };

  const getStorage = () => {
    if (!cachedStorage && config.gcsBucket) {
      cachedStorage = new GCSStorageClient({ bucket: config.gcsBucket });
    }
    return cachedStorage;
  };

  const getSecretManager = () => {
    if (!cachedSecretManager && config.gcpProjectId) {
      cachedSecretManager = new SecretManagerClient({ projectId: config.gcpProjectId });
    }
    return cachedSecretManager;
  };

  const getTelegram = () => {
    if (!cachedTelegram && config.telegramBotToken) {
      cachedTelegram = new TelegramClient({
        botToken: config.telegramBotToken,
        chatId: config.telegramChatId,
      });
    }
    return cachedTelegram;
  };

  const getWorkflows = () => {
    if (!cachedWorkflows) {
      cachedWorkflows = new WorkflowsCallbackClient();
    }
    return cachedWorkflows;
  };

  const getLinkedIn = () => {
    if (!cachedLinkedIn) {
      cachedLinkedIn = new LinkedInClient({
        accessToken: activeLinkedinAccessToken,
        authorUrn: config.linkedinAuthorUrn,
        apiVersion: config.linkedinApiVersion,
      });
    }
    return cachedLinkedIn;
  };

  async function processDecision(draftId, action) {
    const draft = await getRepo().getDraft(draftId);
    if (!draft) {
      return { statusCode: 404, body: { detail: "Rascunho não encontrado." } };
    }

    if (draft.status !== DraftStatus.PENDING) {
      return {
        statusCode: 200,
        body: {
          ok: true,
          draft_id: draft.draft_id,
          status: draft.status,
          already_processed: true,
        },
      };
    }

    const hasMedia = Boolean(draft.diagram_gcs_object || draft.diagram_image_url);
    const isApprove = ["approve", "approve_media", "approve_text"].includes(action);
    const newStatus = isApprove ? DraftStatus.APPROVED : DraftStatus.REJECTED;
    const includeDiagram = action === "approve_text" ? false : hasMedia;

    await getRepo().updateStatus(
      draft.draft_id,
      newStatus,
      isApprove ? { include_diagram: includeDiagram } : {},
    );

    let awaitingOtherDrafts = false;
    if (!isApprove && typeof getRepo().hasPendingDraftsForRun === "function") {
      awaitingOtherDrafts = await getRepo().hasPendingDraftsForRun(draft.run_id);
    }

    if (draft.callback_url && !config.dryRun && !awaitingOtherDrafts) {
      try {
        await getWorkflows().sendCallback(draft.callback_url, {
          decision: newStatus,
          draft_id: draft.draft_id,
          run_id: draft.run_id,
        });
      } catch (err) {
        console.error(`[Service] Falha ao disparar callback para ${draft.draft_id}:`, err);
        return {
          statusCode: 502,
          body: { detail: "Falha ao notificar Cloud Workflows." },
        };
      }
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        draft_id: draft.draft_id,
        status: newStatus,
        already_processed: false,
        awaiting_other_drafts: awaitingOtherDrafts,
      },
    };
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post(
    "/webhook/telegram",
    publicRateLimiter,
    asyncHandler(async (req, res) => {
      const expectedSecret = config.telegramWebhookSecret;
      if (isProd && (!expectedSecret || !config.telegramChatId)) {
        return res
          .status(503)
          .json({ detail: "Segredo do webhook ou TELEGRAM_CHAT_ID não configurado em produção." });
      }
      if (expectedSecret) {
        const providedSecret = req.header("x-telegram-bot-api-secret-token");
        if (!providedSecret || !safeEqual(providedSecret, expectedSecret)) {
          return res.status(401).json({ detail: "Secret token do webhook inválido." });
        }
      }

      const callbackQuery = req.body?.callback_query;
      if (!callbackQuery) {
        return res.json({ ok: true, ignored: true });
      }

      const message = callbackQuery.message || {};
      const chatId = String(message.chat?.id ?? "");
      if (config.telegramChatId && chatId !== String(config.telegramChatId)) {
        return res.status(403).json({ detail: "Chat não autorizado para aprovação." });
      }

      const callbackData = String(callbackQuery.data || "");
      const sepIdx = callbackData.indexOf(":");
      if (sepIdx === -1) {
        return res.json({ ok: true, ignored: true });
      }

      const action = callbackData.slice(0, sepIdx);
      const draftId = callbackData.slice(sepIdx + 1);
      if (
        !["approve", "approve_media", "approve_text", "reject"].includes(action) ||
        !isValidDraftId(draftId)
      ) {
        return res.json({ ok: true, ignored: true });
      }

      const result = await processDecision(draftId, action);
      if (result.statusCode !== 200) {
        return res.status(result.statusCode).json(result.body);
      }

      const telegram = getTelegram();
      if (telegram) {
        const feedback = result.body.already_processed
          ? "Rascunho já processado anteriormente."
          : action === "approve_text"
            ? "Aprovado! Publicando só texto no LinkedIn..."
            : action === "approve_media"
              ? "Aprovado! Publicando com infográfico no LinkedIn..."
              : action === "approve"
                ? "Aprovado! Publicando no LinkedIn..."
                : result.body.awaiting_other_drafts
                  ? "Rascunho rejeitado. Você ainda pode aprovar o outro rascunho!"
                  : "Rascunho rejeitado. Execução encerrada.";

        if (callbackQuery.id) {
          try {
            await telegram.answerCallbackQuery(String(callbackQuery.id), feedback);
          } catch (err) {
            console.warn("[Service] Falha ao responder callback_query:", err.message);
          }
        }

        if (chatId && message.message_id) {
          try {
            await telegram.clearInlineButtons(chatId, Number(message.message_id));
          } catch (err) {
            console.warn("[Service] Falha ao limpar botões inline:", err.message);
          }
        }
      }

      return res.json(result.body);
    }),
  );

  app.get(
    "/approve/:draftId",
    publicRateLimiter,
    asyncHandler(async (req, res) => {
      const { draftId } = req.params;
      if (!isValidDraftId(draftId)) {
        return res.status(400).json({ detail: "draftId inválido." });
      }

      const action = String(req.query.action || "");
      const token = String(req.query.token || "");

      if (!["approve", "approve_media", "approve_text", "reject"].includes(action)) {
        return res.status(400).json({
          detail: "Ação inválida. Use 'approve', 'approve_media', 'approve_text' ou 'reject'.",
        });
      }

      const draft = await getRepo().getDraft(draftId);
      if (!draft) {
        return res.status(404).json({ detail: "Rascunho não encontrado." });
      }

      if (!draft.approval_token || !safeEqual(token, draft.approval_token)) {
        return res.status(403).json({ detail: "Token de aprovação inválido." });
      }

      const createdAtMs = Date.parse(draft.created_at || "");
      if (!Number.isNaN(createdAtMs) && Date.now() - createdAtMs > APPROVAL_LINK_TTL_MS) {
        return res.status(410).json({ detail: "Link de aprovação expirado." });
      }

      const result = await processDecision(draftId, action);
      return res.status(result.statusCode).json(result.body);
    }),
  );

  app.post(
    "/internal/publish",
    asyncHandler(async (req, res) => {
      if (isProd && !config.workflowsServiceAccount) {
        return res.status(503).json({ detail: "WORKFLOWS_SERVICE_ACCOUNT não configurado em produção." });
      }

      if (config.workflowsServiceAccount) {
        const authHeader = req.header("authorization") || "";
        if (!authHeader.startsWith("Bearer ")) {
          return res.status(401).json({ detail: "Token OIDC ausente." });
        }
        const idToken = authHeader.slice("Bearer ".length).trim();
        try {
          const claims = oidcVerifier
            ? await oidcVerifier(idToken, config.approvalServiceUrl || undefined)
            : (
                await oauthClient.verifyIdToken({
                  idToken,
                  audience: config.approvalServiceUrl || undefined,
                })
              ).getPayload();

          if (claims?.email !== config.workflowsServiceAccount) {
            return res.status(403).json({ detail: "Service account não autorizada." });
          }
        } catch {
          return res.status(401).json({ detail: "Token OIDC inválido." });
        }
      }

      const draftId = String(req.body?.draft_id || "");
      if (!isValidDraftId(draftId)) {
        return res.status(400).json({ detail: "draft_id inválido ou ausente." });
      }

      let draft;
      if (typeof getRepo().claimForPublish === "function") {
        const claim = await getRepo().claimForPublish(draftId);
        if (claim.state === "not_found") {
          return res.status(404).json({ detail: "Rascunho não encontrado." });
        }
        if (claim.state === "already_published") {
          return res.json({
            ok: true,
            draft_id: claim.draft.draft_id,
            status: DraftStatus.PUBLISHED,
            linkedin_post_urn: claim.draft.linkedin_post_urn,
            already_published: true,
          });
        }
        if (claim.state === "conflict") {
          return res.status(409).json({
            detail: `Publicação bloqueada: rascunho está em status '${claim.draft.status}', esperado 'approved'.`,
          });
        }
        draft = claim.draft;
      } else {
        draft = await getRepo().getDraft(draftId);
        if (!draft) {
          return res.status(404).json({ detail: "Rascunho não encontrado." });
        }
        if (draft.status === DraftStatus.PUBLISHED) {
          return res.json({
            ok: true,
            draft_id: draft.draft_id,
            status: DraftStatus.PUBLISHED,
            linkedin_post_urn: draft.linkedin_post_urn,
            already_published: true,
          });
        }
        if (draft.status !== DraftStatus.APPROVED) {
          return res.status(409).json({
            detail: `Publicação bloqueada: rascunho está em status '${draft.status}', esperado 'approved'.`,
          });
        }
      }

      let postUrn;
      if (config.dryRun) {
        postUrn = `urn:li:share:dry-run-${draft.draft_id}`;
      } else {
        try {
          let imageBuffer = null;
          let imageMimeType = draft.diagram_mime_type || "image/png";
          const shouldAttachImage = draft.include_diagram !== false;

          if (
            shouldAttachImage &&
            draft.diagram_gcs_object &&
            VALID_GCS_OBJECT_RE.test(draft.diagram_gcs_object) &&
            getStorage()
          ) {
            try {
              const downloaded = await getStorage().downloadObject(draft.diagram_gcs_object);
              imageBuffer = downloaded.buffer;
              imageMimeType = downloaded.contentType || imageMimeType;
            } catch (gcsErr) {
              console.warn(
                `[Service] Falha ao baixar infográfico do GCS (${draft.diagram_gcs_object}): ${gcsErr.message}`,
              );
            }
          }

          postUrn = await getLinkedIn().publishPost(draft.content, {
            imageBuffer,
            imageMimeType,
            imageUrl: shouldAttachImage && !imageBuffer ? draft.diagram_image_url || "" : "",
            imageTitle: draft.article_title || "Infográfico Técnico",
          });
        } catch (err) {
          console.error(`[Service] Falha ao publicar no LinkedIn (draft=${draft.draft_id}):`, err);
          if (draft.status === DraftStatus.PUBLISHING) {
            try {
              await getRepo().updateStatus(draft.draft_id, DraftStatus.APPROVED);
            } catch (revertErr) {
              console.error("[Service] Falha ao reverter status para approved:", revertErr);
            }
          }
          return res.status(502).json({
            detail: "Falha ao publicar no LinkedIn. Verifique os logs do serviço.",
          });
        }
      }

      await getRepo().markPublished(draft.draft_id, postUrn);

      const telegram = getTelegram();
      if (telegram && config.telegramChatId && !config.dryRun) {
        try {
          await telegram.sendMessage(
            `Post publicado no LinkedIn!\nID do rascunho: ${draft.draft_id}\nURN: ${postUrn}`,
          );
        } catch (err) {
          console.warn("[Service] Post publicado, mas falhou notificação Telegram:", err.message);
        }
      }

      return res.json({
        ok: true,
        draft_id: draft.draft_id,
        status: DraftStatus.PUBLISHED,
        linkedin_post_urn: postUrn,
        already_published: false,
      });
    }),
  );

  // Renovação em 1 clique do token OAuth 2.0 do LinkedIn
  app.get(
    "/auth/linkedin/start",
    publicRateLimiter,
    asyncHandler(async (req, res) => {
      const state = String(req.query.state || "");
      if (!VALID_OAUTH_STATE_RE.test(state)) {
        return res.status(400).json({ detail: "Parâmetro state inválido." });
      }
      if (!config.linkedinClientId || !config.approvalServiceUrl) {
        return res
          .status(503)
          .json({ detail: "LINKEDIN_CLIENT_ID ou APPROVAL_SERVICE_URL não configurado." });
      }

      const stored = await getRepo().getOAuthState(state);
      const expiresMs = Date.parse(stored?.expires_at || "");
      if (!stored || stored.used || (!Number.isNaN(expiresMs) && Date.now() > expiresMs)) {
        return res.status(403).json({ detail: "Link de renovação inválido ou expirado." });
      }

      const redirectUri = `${config.approvalServiceUrl}/auth/linkedin/callback`;
      const params = new URLSearchParams({
        response_type: "code",
        client_id: config.linkedinClientId,
        redirect_uri: redirectUri,
        scope: "openid profile w_member_social",
        state,
      });
      return res.redirect(302, `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`);
    }),
  );

  app.get(
    "/auth/linkedin/callback",
    publicRateLimiter,
    asyncHandler(async (req, res) => {
      const code = String(req.query.code || "");
      const state = String(req.query.state || "");
      if (!code || !VALID_OAUTH_STATE_RE.test(state)) {
        return res.status(400).json({ detail: "Parâmetros code/state inválidos." });
      }
      if (!config.linkedinClientId || !config.linkedinClientSecret || !config.approvalServiceUrl) {
        return res
          .status(503)
          .json({ detail: "Credenciais OAuth do LinkedIn não configuradas no serviço." });
      }

      const consumed = await getRepo().consumeOAuthState(state);
      if (!consumed) {
        return res.status(403).json({ detail: "State OAuth inválido, expirado ou já utilizado." });
      }

      const redirectUri = `${config.approvalServiceUrl}/auth/linkedin/callback`;
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: config.linkedinClientId,
        client_secret: config.linkedinClientSecret,
        redirect_uri: redirectUri,
      });

      const tokenRes = await fetchImpl("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(15000),
      });

      if (!tokenRes.ok) {
        console.error("[Service] Falha ao trocar code OAuth no LinkedIn:", tokenRes.status);
        return res.status(502).json({ detail: "Falha ao obter novo token no LinkedIn." });
      }

      const tokenData = await tokenRes.json();
      const newAccessToken = String(tokenData.access_token || "");
      if (!newAccessToken) {
        return res.status(502).json({ detail: "LinkedIn não retornou access_token." });
      }

      if (config.linkedinAuthorUrn) {
        const profileRes = await fetchImpl("https://api.linkedin.com/v2/userinfo", {
          headers: { Authorization: `Bearer ${newAccessToken}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!profileRes.ok) {
          return res.status(502).json({ detail: "Não foi possível validar o perfil autorizado no LinkedIn." });
        }
        const profile = await profileRes.json();
        const authorizedUrn = profile?.sub ? `urn:li:person:${profile.sub}` : "";
        if (!authorizedUrn || !safeEqual(authorizedUrn, config.linkedinAuthorUrn)) {
          return res.status(403).json({
            detail: "A conta autorizada no LinkedIn não corresponde ao LINKEDIN_AUTHOR_URN configurado.",
          });
        }
      }

      const secretManager = getSecretManager();
      if (!secretManager?.isConfigured) {
        return res.status(503).json({ detail: "Secret Manager não configurado." });
      }

      await secretManager.addSecretVersion("linkedin-access-token", newAccessToken);
      activeLinkedinAccessToken = newAccessToken;
      cachedLinkedIn = null;

      const telegram = getTelegram();
      if (telegram && config.telegramChatId && !config.dryRun) {
        try {
          await telegram.sendMessage(
            "✅ Token do LinkedIn renovado com sucesso no Secret Manager (válido por mais 60 dias)!",
          );
        } catch (err) {
          console.warn("[Service] Token renovado, mas falhou aviso no Telegram:", err.message);
        }
      }

      return res.json({
        ok: true,
        message: "Token do LinkedIn renovado e salvo no Secret Manager com sucesso!",
        expires_in_seconds: tokenData.expires_in || 5184000,
      });
    }),
  );

  // Tratamento global de erros sem expor stack traces
  app.use((err, _req, res, _next) => {
    console.error("[Service] Erro interno não tratado:", err);
    res.status(500).json({ detail: "Erro interno do servidor." });
  });

  return app;
}
