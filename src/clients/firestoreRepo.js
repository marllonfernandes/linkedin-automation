import { Firestore } from "@google-cloud/firestore";
import { DraftStatus } from "../models.js";

const ALREADY_EXISTS_GRPC_CODE = 6;

export class FirestoreRepository {
  static PROCESSED_URLS_COLLECTION = "processed_urls";
  static DRAFTS_COLLECTION = "drafts";
  static OAUTH_STATES_COLLECTION = "oauth_states";

  constructor({ projectId, database = "(default)", client } = {}) {
    this.client =
      client ||
      new Firestore({
        projectId: projectId || undefined,
        databaseId: database || "(default)",
      });
  }

  /**
   * Reserva uma URL de forma atômica via `create()`.
   * Retorna true se a URL é nova; false se já foi processada (idempotência).
   */
  async tryClaimArticle(article, runId) {
    const docRef = this.client
      .collection(FirestoreRepository.PROCESSED_URLS_COLLECTION)
      .doc(article.urlId);

    try {
      await docRef.create({
        url: article.normalizedUrl,
        title: article.title,
        source: article.source,
        run_id: runId,
        claimed_at: new Date().toISOString(),
      });
      return true;
    } catch (err) {
      if (err?.code === ALREADY_EXISTS_GRPC_CODE || err?.code === "ALREADY_EXISTS") {
        return false;
      }
      throw err;
    }
  }

  async releaseArticleClaim(article) {
    const docRef = this.client
      .collection(FirestoreRepository.PROCESSED_URLS_COLLECTION)
      .doc(article.urlId);
    await docRef.delete();
  }

  async saveDraft(draft) {
    const docRef = this.client
      .collection(FirestoreRepository.DRAFTS_COLLECTION)
      .doc(draft.draft_id);
    await docRef.set(draft);
  }

  async getDraft(draftId) {
    const docRef = this.client
      .collection(FirestoreRepository.DRAFTS_COLLECTION)
      .doc(draftId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      return null;
    }
    return snapshot.data();
  }

  async updateTelegramMessageId(draftId, messageId) {
    const docRef = this.client
      .collection(FirestoreRepository.DRAFTS_COLLECTION)
      .doc(draftId);
    await docRef.update({
      telegram_message_id: messageId,
      updated_at: new Date().toISOString(),
    });
  }

  async updateStatus(draftId, status, extraFields = {}) {
    const docRef = this.client
      .collection(FirestoreRepository.DRAFTS_COLLECTION)
      .doc(draftId);
    await docRef.update({
      ...extraFields,
      status,
      updated_at: new Date().toISOString(),
    });
  }

  async hasPendingDraftsForRun(runId) {
    if (!runId) return false;
    const snapshot = await this.client
      .collection(FirestoreRepository.DRAFTS_COLLECTION)
      .where("run_id", "==", runId)
      .get();

    return snapshot.docs.some((doc) => doc.data()?.status === DraftStatus.PENDING);
  }

  /**
   * Transição atômica `approved` -> `publishing` via transação Firestore.
   * Evita publicação duplicada no LinkedIn em caso de retries concorrentes.
   */
  async claimForPublish(draftId) {
    const docRef = this.client
      .collection(FirestoreRepository.DRAFTS_COLLECTION)
      .doc(draftId);

    if (typeof this.client.runTransaction !== "function") {
      const draft = await this.getDraft(draftId);
      if (!draft) return { state: "not_found" };
      if (draft.status === DraftStatus.PUBLISHED) return { state: "already_published", draft };
      if (draft.status !== DraftStatus.APPROVED) return { state: "conflict", draft };
      await this.updateStatus(draftId, DraftStatus.PUBLISHING);
      return { state: "claimed", draft: { ...draft, status: DraftStatus.PUBLISHING } };
    }

    return this.client.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        return { state: "not_found" };
      }
      const draft = snap.data();
      if (draft.status === DraftStatus.PUBLISHED) {
        return { state: "already_published", draft };
      }
      if (draft.status !== DraftStatus.APPROVED) {
        return { state: "conflict", draft };
      }
      tx.update(docRef, {
        status: DraftStatus.PUBLISHING,
        updated_at: new Date().toISOString(),
      });
      return { state: "claimed", draft: { ...draft, status: DraftStatus.PUBLISHING } };
    });
  }

  async markPublished(draftId, linkedinPostUrn) {
    const docRef = this.client
      .collection(FirestoreRepository.DRAFTS_COLLECTION)
      .doc(draftId);
    await docRef.update({
      status: DraftStatus.PUBLISHED,
      linkedin_post_urn: linkedinPostUrn,
      updated_at: new Date().toISOString(),
    });
  }

  async saveOAuthState(state, ttlMs = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    const docRef = this.client
      .collection(FirestoreRepository.OAUTH_STATES_COLLECTION)
      .doc(state);
    await docRef.set({
      state,
      used: false,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + ttlMs).toISOString(),
    });
  }

  async getOAuthState(state) {
    const docRef = this.client
      .collection(FirestoreRepository.OAUTH_STATES_COLLECTION)
      .doc(state);
    const snap = await docRef.get();
    return snap.exists ? snap.data() : null;
  }

  async consumeOAuthState(state) {
    const docRef = this.client
      .collection(FirestoreRepository.OAUTH_STATES_COLLECTION)
      .doc(state);

    const isExpired = (data) => {
      const expiresMs = Date.parse(data?.expires_at || "");
      return !Number.isNaN(expiresMs) && Date.now() > expiresMs;
    };

    if (typeof this.client.runTransaction !== "function") {
      const snap = await docRef.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (data.used || isExpired(data)) return null;
      await docRef.update({ used: true, used_at: new Date().toISOString() });
      return data;
    }

    return this.client.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) return null;
      const data = snap.data();
      if (data.used || isExpired(data)) return null;
      tx.update(docRef, { used: true, used_at: new Date().toISOString() });
      return data;
    });
  }
}
