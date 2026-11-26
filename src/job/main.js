import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

import { loadConfig } from "../config.js";
import { createDraftRecord, DraftStatus, renderPost } from "../models.js";
import { FirestoreRepository } from "../clients/firestoreRepo.js";
import { GCSStorageClient } from "../clients/gcsClient.js";
import { GeminiDraftGenerator } from "../clients/geminiClient.js";
import { RSSReader } from "../clients/rssReader.js";
import { TelegramClient } from "../clients/telegramClient.js";
import { WorkflowsCallbackClient } from "../clients/workflowsClient.js";

export async function runCurationJob({
  config,
  rssReader,
  repo,
  generator,
  storageClient = null,
  telegramClient = null,
  workflowsClient = null,
}) {
  const runId = config.runId || `run-${crypto.randomBytes(6).toString("hex")}`;
  console.log(
    `[Job] Iniciando curadoria (runId=${runId}, maxDrafts=${config.maxDraftsPerRun})`,
  );

  const articles = await rssReader.fetchArticles(config.rssFeeds, config.maxItemsPerFeed);
  console.log(`[Job] Artigos coletados dos feeds RSS: ${articles.length}`);

  const createdDrafts = [];

  for (const article of articles) {
    if (createdDrafts.length >= config.maxDraftsPerRun) {
      break;
    }

    const claimed = await repo.tryClaimArticle(article, runId);
    if (!claimed) {
      console.log(`[Job] Artigo já processado, ignorando: ${article.normalizedUrl}`);
      continue;
    }

    let generated;
    try {
      generated = await generator.generateDraft(article);
    } catch (err) {
      console.error(`[Job] Erro no Gemini para ${article.normalizedUrl}:`, err);
      await repo.releaseArticleClaim(article);
      continue;
    }

    const draftId = crypto.randomBytes(6).toString("hex");
    let imageAsset = null;
    let diagramGcsObject = "";
    let diagramMimeType = "image/png";

    if (generated.needs_diagram && generated.infographic_brief && generator.generateInfographic) {
      try {
        imageAsset = await generator.generateInfographic(generated.infographic_brief);
        if (imageAsset?.buffer && storageClient?.isConfigured) {
          diagramMimeType = imageAsset.mimeType || "image/png";
          const ext = diagramMimeType.includes("jpeg") ? "jpg" : "png";
          const objectName = `drafts/${draftId}.${ext}`;
          await storageClient.uploadObject(objectName, imageAsset.buffer, diagramMimeType);
          diagramGcsObject = objectName;
          console.log(`[Job] Infográfico salvo no GCS: gs://${storageClient.bucket}/${objectName}`);
        }
      } catch (err) {
        console.warn(`[Job] Falha ao gerar/salvar infográfico para ${draftId}, seguindo só com texto: ${err.message}`);
        imageAsset = null;
      }
    }

    const draft = createDraftRecord({
      draftId,
      runId,
      articleTitle: article.title,
      articleUrl: article.normalizedUrl,
      articleSource: article.source,
      content: renderPost(generated, article.normalizedUrl),
      infographicBrief: generated.infographic_brief || "",
      diagramGcsObject,
      diagramMimeType,
      status: DraftStatus.PENDING,
      callbackUrl: config.callbackUrl,
      approvalToken: crypto.randomBytes(24).toString("base64url"),
    });

    await repo.saveDraft(draft);

    if (!config.dryRun && telegramClient) {
      const messageId = await telegramClient.sendDraftForApproval(
        draft,
        config.approvalServiceUrl,
        imageAsset,
      );
      draft.telegram_message_id = messageId;
      await repo.updateTelegramMessageId(draft.draft_id, messageId);
      console.log(`[Job] Rascunho ${draft.draft_id} enviado ao Telegram (msg=${messageId})`);
    } else {
      console.log(`[Job] DRY_RUN ativo: rascunho ${draft.draft_id} salvo no Firestore.`);
    }

    createdDrafts.push(draft);
  }

  if (createdDrafts.length === 0) {
    console.log("[Job] Nenhum artigo novo encontrado nesta execução.");
    if (config.callbackUrl && !config.dryRun && workflowsClient) {
      await workflowsClient.sendCallback(config.callbackUrl, {
        decision: "no_content",
        run_id: runId,
      });
      console.log("[Job] Callback 'no_content' enviado ao Cloud Workflows.");
    }
  }

  console.log(`[Job] Curadoria finalizada com ${createdDrafts.length} rascunho(s).`);
  return createdDrafts;
}

export async function main() {
  const config = loadConfig();
  const rssReader = new RSSReader();
  const repo = new FirestoreRepository({
    projectId: config.gcpProjectId,
    database: config.firestoreDatabase,
  });
  const generator = new GeminiDraftGenerator({
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    imageModel: config.geminiImageModel,
  });
  const storageClient = config.gcsBucket
    ? new GCSStorageClient({ bucket: config.gcsBucket })
    : null;
  const telegramClient = config.dryRun
    ? null
    : new TelegramClient({
        botToken: config.telegramBotToken,
        chatId: config.telegramChatId,
      });
  const workflowsClient = new WorkflowsCallbackClient();

  await runCurationJob({
    config,
    rssReader,
    repo,
    generator,
    storageClient,
    telegramClient,
    workflowsClient,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[Job] Falha fatal:", err);
    process.exit(1);
  });
}
