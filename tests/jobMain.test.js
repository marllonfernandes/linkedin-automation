import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { runCurationJob } from "../src/job/main.js";
import { DraftStatus, normalizeUrl, urlHash } from "../src/models.js";

function makeArticle(title, url, source = "Tech Blog") {
  const normalizedUrl = normalizeUrl(url);
  return { title, url, normalizedUrl, urlId: urlHash(normalizedUrl), summary: "Resumo", source };
}

class InMemoryRepo {
  constructor(claimed = []) {
    this.claimed = new Set(claimed);
    this.drafts = new Map();
  }

  async tryClaimArticle(article) {
    if (this.claimed.has(article.urlId)) return false;
    this.claimed.add(article.urlId);
    return true;
  }

  async releaseArticleClaim(article) {
    this.claimed.delete(article.urlId);
  }

  async saveDraft(draft) {
    this.drafts.set(draft.draft_id, draft);
  }

  async updateTelegramMessageId(draftId, messageId) {
    this.drafts.get(draftId).telegram_message_id = messageId;
  }
}

test("runCurationJob gera até MAX_DRAFTS_PER_RUN e ignora duplicados", async () => {
  const a1 = makeArticle("Artigo 1", "https://example.com/1");
  const a2 = makeArticle("Artigo 2", "https://example.com/2");
  const a3 = makeArticle("Artigo 3", "https://example.com/3");

  const repo = new InMemoryRepo([a1.urlId]);
  const sent = [];
  const callbacks = [];

  const config = loadConfig({
    MAX_DRAFTS_PER_RUN: "2",
    RUN_ID: "exec-1",
    CALLBACK_URL: "https://workflowexecutions.googleapis.com/callback/1",
  });

  const drafts = await runCurationJob({
    config,
    rssReader: { fetchArticles: async () => [a1, a2, a3] },
    repo,
    generator: {
      generateDraft: async (article) => ({
        hook: `Análise: ${article.title}`,
        body: "Trade-offs práticos.",
        hashtags: ["Cloud", "IA"],
      }),
    },
    telegramClient: {
      sendDraftForApproval: async (draft) => {
        sent.push(draft);
        return 100 + sent.length;
      },
    },
    workflowsClient: {
      sendCallback: async (url, payload) => callbacks.push({ url, payload }),
    },
  });

  assert.equal(drafts.length, 2);
  assert.deepEqual(
    drafts.map((d) => d.article_title),
    ["Artigo 2", "Artigo 3"],
  );
  assert.ok(drafts.every((d) => d.status === DraftStatus.PENDING));
  assert.equal(sent.length, 2);
  assert.equal(callbacks.length, 0);
});

test("runCurationJob envia callback no_content quando não há artigos novos", async () => {
  const a1 = makeArticle("Artigo 1", "https://example.com/1");
  const repo = new InMemoryRepo([a1.urlId]);
  const callbacks = [];

  const config = loadConfig({
    MAX_DRAFTS_PER_RUN: "2",
    RUN_ID: "exec-2",
    CALLBACK_URL: "https://workflowexecutions.googleapis.com/callback/2",
  });

  const drafts = await runCurationJob({
    config,
    rssReader: { fetchArticles: async () => [a1] },
    repo,
    generator: { generateDraft: async () => { throw new Error("não deve chamar"); } },
    telegramClient: { sendDraftForApproval: async () => 1 },
    workflowsClient: {
      sendCallback: async (url, payload) => callbacks.push({ url, payload }),
    },
  });

  assert.equal(drafts.length, 0);
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].payload.decision, "no_content");
});
