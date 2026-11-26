import test from "node:test";
import assert from "node:assert/strict";
import { FirestoreRepository } from "../src/clients/firestoreRepo.js";
import { createDraftRecord, DraftStatus, normalizeUrl, urlHash } from "../src/models.js";

class FakeFirestoreClient {
  constructor() {
    this.collections = new Map();
  }

  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
    const store = this.collections.get(name);
    return {
      doc: (docId) => ({
        create: async (data) => {
          if (store.has(docId)) {
            const err = new Error("Already exists");
            err.code = 6;
            throw err;
          }
          store.set(docId, { ...data });
        },
        set: async (data) => {
          store.set(docId, { ...data });
        },
        get: async () => ({
          exists: store.has(docId),
          data: () => (store.has(docId) ? { ...store.get(docId) } : undefined),
        }),
        update: async (fields) => {
          store.set(docId, { ...store.get(docId), ...fields });
        },
        delete: async () => {
          store.delete(docId);
        },
      }),
    };
  }
}

test("tryClaimArticle garante idempotência atômica no Firestore", async () => {
  const repo = new FirestoreRepository({ client: new FakeFirestoreClient() });
  const article1 = {
    title: "Cloud Run Tips",
    normalizedUrl: normalizeUrl("https://example.com/cloud-run/"),
    urlId: urlHash("https://example.com/cloud-run/"),
    source: "Blog",
  };
  const article2 = {
    title: "Cloud Run Tips",
    normalizedUrl: normalizeUrl("https://EXAMPLE.com/cloud-run#top"),
    urlId: urlHash("https://EXAMPLE.com/cloud-run#top"),
    source: "Blog",
  };

  assert.equal(await repo.tryClaimArticle(article1, "run-1"), true);
  assert.equal(await repo.tryClaimArticle(article2, "run-2"), false);

  await repo.releaseArticleClaim(article1);
  assert.equal(await repo.tryClaimArticle(article1, "run-3"), true);
});

test("saveDraft, updateStatus e markPublished persistem ciclo de vida completo", async () => {
  const repo = new FirestoreRepository({ client: new FakeFirestoreClient() });
  const draft = createDraftRecord({
    draftId: "draft-123",
    runId: "run-1",
    articleTitle: "Arquitetura Serverless",
    articleUrl: "https://example.com/serverless",
    content: "Texto técnico.",
  });

  await repo.saveDraft(draft);
  const loaded = await repo.getDraft("draft-123");
  assert.equal(loaded.status, DraftStatus.PENDING);

  await repo.updateStatus("draft-123", DraftStatus.APPROVED);
  assert.equal((await repo.getDraft("draft-123")).status, DraftStatus.APPROVED);

  await repo.markPublished("draft-123", "urn:li:share:999");
  const published = await repo.getDraft("draft-123");
  assert.equal(published.status, DraftStatus.PUBLISHED);
  assert.equal(published.linkedin_post_urn, "urn:li:share:999");
});
