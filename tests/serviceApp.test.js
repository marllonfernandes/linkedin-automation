import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDraftRecord, DraftStatus } from "../src/models.js";
import { createApp } from "../src/service/app.js";

class FakeRepo {
  constructor(drafts = []) {
    this.drafts = new Map(drafts.map((d) => [d.draft_id, { ...d }]));
    this.oauthStates = new Map();
  }

  async getDraft(id) {
    return this.drafts.has(id) ? { ...this.drafts.get(id) } : null;
  }

  async updateStatus(id, status, extraFields = {}) {
    Object.assign(this.drafts.get(id), extraFields, { status });
  }

  async hasPendingDraftsForRun(runId) {
    return [...this.drafts.values()].some(
      (d) => d.run_id === runId && d.status === DraftStatus.PENDING,
    );
  }

  async markPublished(id, urn) {
    const draft = this.drafts.get(id);
    draft.status = DraftStatus.PUBLISHED;
    draft.linkedin_post_urn = urn;
  }

  async saveOAuthState(state, ttlMs = 60_000) {
    this.oauthStates.set(state, {
      state,
      used: false,
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
    });
  }

  async getOAuthState(state) {
    return this.oauthStates.get(state) || null;
  }

  async consumeOAuthState(state) {
    const item = this.oauthStates.get(state);
    if (!item || item.used) return null;
    item.used = true;
    return item;
  }
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeDraft(status = DraftStatus.PENDING) {
  return createDraftRecord({
    draftId: "d1",
    runId: "run-1",
    articleTitle: "Cloud Workflows",
    articleUrl: "https://example.com/workflows",
    content: "Conteúdo técnico aprovado.",
    status,
    callbackUrl: "https://workflows.callback/1",
    approvalToken: "secret-link-token",
  });
}

test("POST /webhook/telegram aprova rascunho e dispara callback do Cloud Workflows", async () => {
  const repo = new FakeRepo([makeDraft()]);
  const callbacks = [];
  const answered = [];
  const cleared = [];

  const app = createApp({
    config: loadConfig({ TELEGRAM_CHAT_ID: "999", TELEGRAM_WEBHOOK_SECRET: "my-secret" }),
    repo,
    telegramClient: {
      answerCallbackQuery: async (id, text) => answered.push({ id, text }),
      clearInlineButtons: async (chatId, msgId) => cleared.push({ chatId, msgId }),
    },
    workflowsClient: {
      sendCallback: async (url, payload) => callbacks.push({ url, payload }),
    },
  });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/webhook/telegram`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "my-secret",
      },
      body: JSON.stringify({
        callback_query: {
          id: "cb-1",
          data: "approve:d1",
          message: { message_id: 42, chat: { id: 999 } },
        },
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "approved");
    assert.equal((await repo.getDraft("d1")).status, DraftStatus.APPROVED);
    assert.equal(callbacks.length, 1);
    assert.deepEqual(callbacks[0].payload, {
      decision: "approved",
      draft_id: "d1",
      run_id: "run-1",
    });
    assert.equal(answered.length, 1);
    assert.deepEqual(cleared, [{ chatId: "999", msgId: 42 }]);
  });
});

test("POST /webhook/telegram rejeita secret token inválido", async () => {
  const app = createApp({
    config: loadConfig({ TELEGRAM_WEBHOOK_SECRET: "expected-secret" }),
    repo: new FakeRepo(),
  });

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/webhook/telegram`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "wrong",
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 401);
  });
});

test("GET /approve/:draftId valida token individual e processa rejeição", async () => {
  const repo = new FakeRepo([makeDraft()]);
  const callbacks = [];
  const app = createApp({
    config: loadConfig({}),
    repo,
    workflowsClient: {
      sendCallback: async (url, payload) => callbacks.push({ url, payload }),
    },
  });

  await withServer(app, async (baseUrl) => {
    const bad = await fetch(`${baseUrl}/approve/d1?action=reject&token=wrong`);
    assert.equal(bad.status, 403);

    const ok = await fetch(`${baseUrl}/approve/d1?action=reject&token=secret-link-token`);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).status, "rejected");
    assert.equal(callbacks[0].payload.decision, "rejected");
  });
});

test("POST /internal/publish bloqueia rascunho pendente e publica aprovado com OIDC", async () => {
  const repo = new FakeRepo([makeDraft(DraftStatus.PENDING)]);
  const publishedPosts = [];
  const telegramMsgs = [];

  const app = createApp({
    config: loadConfig({
      TELEGRAM_CHAT_ID: "999",
      WORKFLOWS_SERVICE_ACCOUNT: "sa@proj.iam.gserviceaccount.com",
    }),
    repo,
    linkedinClient: {
      publishPost: async (content) => {
        publishedPosts.push(content);
        return "urn:li:share:777";
      },
    },
    telegramClient: {
      sendMessage: async (text) => {
        telegramMsgs.push(text);
        return 1;
      },
    },
    oidcVerifier: async (token) => {
      if (token !== "valid-oidc") throw new Error("invalid");
      return { email: "sa@proj.iam.gserviceaccount.com" };
    },
  });

  await withServer(app, async (baseUrl) => {
    const noAuth = await fetch(`${baseUrl}/internal/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft_id: "d1" }),
    });
    assert.equal(noAuth.status, 401);

    const blocked = await fetch(`${baseUrl}/internal/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-oidc",
      },
      body: JSON.stringify({ draft_id: "d1" }),
    });
    assert.equal(blocked.status, 409);
    assert.equal(publishedPosts.length, 0);

    await repo.updateStatus("d1", DraftStatus.APPROVED);
    const ok = await fetch(`${baseUrl}/internal/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-oidc",
      },
      body: JSON.stringify({ draft_id: "d1" }),
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.linkedin_post_urn, "urn:li:share:777");
    assert.equal((await repo.getDraft("d1")).status, DraftStatus.PUBLISHED);
    assert.equal(publishedPosts.length, 1);
    assert.equal(telegramMsgs.length, 1);
  });
});

test("approve_text desativa infográfico na publicação enquanto approve_media baixa PNG do GCS", async () => {
  const dText = createDraftRecord({
    draftId: "d-text",
    runId: "run-2",
    articleTitle: "Arquitetura Event-Driven",
    articleUrl: "https://example.com/eda",
    content: "Texto técnico.",
    diagramGcsObject: "drafts/d-text.png",
    callbackUrl: "https://workflows.callback/2",
  });
  const dMedia = createDraftRecord({
    draftId: "d-media",
    runId: "run-3",
    articleTitle: "Pipeline Iceberg",
    articleUrl: "https://example.com/iceberg",
    content: "Texto com infográfico.",
    diagramGcsObject: "drafts/d-media.png",
    callbackUrl: "https://workflows.callback/3",
  });

  const repo = new FakeRepo([dText, dMedia]);
  const published = [];
  const fakePng = Buffer.from([137, 80, 78, 71]);
  const app = createApp({
    config: loadConfig({ TELEGRAM_CHAT_ID: "999", TELEGRAM_WEBHOOK_SECRET: "sec" }),
    repo,
    storageClient: {
      downloadObject: async (name) => ({ buffer: fakePng, contentType: "image/png", name }),
    },
    workflowsClient: { sendCallback: async () => {} },
    linkedinClient: {
      publishPost: async (content, opts) => {
        published.push({ content, opts });
        return "urn:li:share:ok";
      },
    },
  });

  await withServer(app, async (baseUrl) => {
    const r1 = await fetch(`${baseUrl}/webhook/telegram`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "sec",
      },
      body: JSON.stringify({
        callback_query: {
          id: "cb-t",
          data: "approve_text:d-text",
          message: { message_id: 1, chat: { id: 999 } },
        },
      }),
    });
    assert.equal(r1.status, 200);
    assert.equal((await repo.getDraft("d-text")).include_diagram, false);

    const p1 = await fetch(`${baseUrl}/internal/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft_id: "d-text" }),
    });
    assert.equal(p1.status, 200);
    assert.equal(published[0].opts.imageBuffer, null);

    const r2 = await fetch(`${baseUrl}/webhook/telegram`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "sec",
      },
      body: JSON.stringify({
        callback_query: {
          id: "cb-m",
          data: "approve_media:d-media",
          message: { message_id: 2, chat: { id: 999 } },
        },
      }),
    });
    assert.equal(r2.status, 200);
    assert.equal((await repo.getDraft("d-media")).include_diagram, true);

    const p2 = await fetch(`${baseUrl}/internal/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft_id: "d-media" }),
    });
    assert.equal(p2.status, 200);
    assert.deepEqual(published[1].opts.imageBuffer, fakePng);
  });
});

test("rejeitar 1 de 2 rascunhos da mesma execução não cancela o workflow até o 2º ser decidido", async () => {
  const d1 = createDraftRecord({
    draftId: "d-a",
    runId: "run-shared",
    articleTitle: "Tema A",
    articleUrl: "https://example.com/a",
    content: "Post A",
    callbackUrl: "https://workflows.callback/shared",
  });
  const d2 = createDraftRecord({
    draftId: "d-b",
    runId: "run-shared",
    articleTitle: "Tema B",
    articleUrl: "https://example.com/b",
    content: "Post B",
    callbackUrl: "https://workflows.callback/shared",
  });

  const repo = new FakeRepo([d1, d2]);
  const callbacks = [];
  const app = createApp({
    config: loadConfig({ TELEGRAM_CHAT_ID: "999", TELEGRAM_WEBHOOK_SECRET: "sec" }),
    repo,
    workflowsClient: {
      sendCallback: async (url, payload) => callbacks.push({ url, payload }),
    },
  });

  await withServer(app, async (baseUrl) => {
    const rej1 = await fetch(`${baseUrl}/webhook/telegram`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "sec",
      },
      body: JSON.stringify({
        callback_query: {
          id: "cb-r1",
          data: "reject:d-a",
          message: { message_id: 10, chat: { id: 999 } },
        },
      }),
    });
    assert.equal(rej1.status, 200);
    assert.equal((await rej1.json()).awaiting_other_drafts, true);
    assert.equal(callbacks.length, 0);

    const app2 = await fetch(`${baseUrl}/webhook/telegram`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "sec",
      },
      body: JSON.stringify({
        callback_query: {
          id: "cb-a2",
          data: "approve:d-b",
          message: { message_id: 11, chat: { id: 999 } },
        },
      }),
    });
    assert.equal(app2.status, 200);
    assert.equal(callbacks.length, 1);
    assert.deepEqual(callbacks[0].payload, {
      decision: "approved",
      draft_id: "d-b",
      run_id: "run-shared",
    });
  });
});

test("GET /auth/linkedin/start e /callback renovam token no Secret Manager e bloqueiam replay", async () => {
  const repo = new FakeRepo();
  const state = "valid_oauth_state_token_123456";
  await repo.saveOAuthState(state);

  const secretVersions = [];
  const telegramMsgs = [];

  const app = createApp({
    config: loadConfig({
      GCP_PROJECT_ID: "proj-test",
      APPROVAL_SERVICE_URL: "https://service.run.app",
      LINKEDIN_CLIENT_ID: "client-id-123",
      LINKEDIN_CLIENT_SECRET: "secret+with==chars",
      TELEGRAM_CHAT_ID: "999",
    }),
    repo,
    secretManagerClient: {
      isConfigured: true,
      addSecretVersion: async (name, value) => secretVersions.push({ name, value }),
    },
    telegramClient: {
      sendMessage: async (msg) => {
        telegramMsgs.push(msg);
        return 1;
      },
    },
    fetchImpl: async (url, opts) => {
      assert.equal(url, "https://www.linkedin.com/oauth/v2/accessToken");
      assert.match(opts.body, /client_secret=secret%2Bwith%3D%3Dchars/);
      return new Response(JSON.stringify({ access_token: "new-li-token", expires_in: 5184000 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await withServer(app, async (baseUrl) => {
    const startRes = await fetch(`${baseUrl}/auth/linkedin/start?state=${state}`, {
      redirect: "manual",
    });
    assert.equal(startRes.status, 302);
    assert.match(
      startRes.headers.get("location"),
      /^https:\/\/www\.linkedin\.com\/oauth\/v2\/authorization\?/,
    );

    const cbRes = await fetch(`${baseUrl}/auth/linkedin/callback?code=auth-code-1&state=${state}`);
    assert.equal(cbRes.status, 200);
    assert.deepEqual(secretVersions, [{ name: "linkedin-access-token", value: "new-li-token" }]);
    assert.equal(telegramMsgs.length, 1);

    // Replay do mesmo state deve ser bloqueado
    const replayRes = await fetch(`${baseUrl}/auth/linkedin/callback?code=auth-code-1&state=${state}`);
    assert.equal(replayRes.status, 403);
  });
});
