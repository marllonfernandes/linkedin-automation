import crypto from "node:crypto";
import zlib from "node:zlib";

export const DraftStatus = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  PUBLISHING: "publishing",
  PUBLISHED: "published",
  REJECTED: "rejected",
});

/**
 * Normaliza URL removendo fragmentos e barras finais para dedupe consistente.
 */
export function normalizeUrl(rawUrl) {
  const parsed = new URL(String(rawUrl).trim());
  parsed.hash = "";
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  const cleanPath = parsed.pathname.replace(/\/+$/, "") || "/";
  parsed.pathname = cleanPath;
  return parsed.toString();
}

/**
 * Hash SHA-256 determinístico usado como ID de documento no Firestore.
 */
export function urlHash(rawUrl) {
  return crypto.createHash("sha256").update(normalizeUrl(rawUrl)).digest("hex");
}

/**
 * Constrói um diagrama Mermaid 100% válido a partir de uma lista de etapas/componentes.
 */
export function buildMermaidFromSteps(steps = []) {
  const cleanSteps = (Array.isArray(steps) ? steps : [])
    .map((step) => String(step || "").replace(/["\r\n]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 6);

  if (cleanSteps.length < 2) {
    return "";
  }

  const lines = ["flowchart TD"];
  cleanSteps.forEach((label, idx) => {
    lines.push(`  N${idx}["${label}"]`);
  });
  for (let i = 0; i < cleanSteps.length - 1; i += 1) {
    lines.push(`  N${i} --> N${i + 1}`);
  }
  return lines.join("\n");
}

/**
 * Limpa cercas markdown (```mermaid ... ```) e gera URL PNG via Kroki (deflate + base64url).
 */
export function buildMermaidImageUrl(mermaidCode = "") {
  const clean = String(mermaidCode || "")
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  if (!clean) {
    return "";
  }

  const compressed = zlib.deflateSync(Buffer.from(clean, "utf-8"), { level: 9 });
  const encoded = compressed.toString("base64url");
  return `https://kroki.io/mermaid/png/${encoded}`;
}

/**
 * Formata o rascunho estruturado gerado pelo Gemini para publicação escaneável no LinkedIn.
 */
export function renderPost(generatedDraft, sourceUrl) {
  const hook = String(generatedDraft.hook || "").trim();
  const context = String(generatedDraft.context || generatedDraft.body || "").trim();

  const keyPoints = Array.isArray(generatedDraft.key_points)
    ? generatedDraft.key_points
        .map((point) => String(point).trim().replace(/^[-•▸*]\s*/, ""))
        .filter(Boolean)
        .map((point) => `▸ ${point}`)
        .join("\n")
    : "";

  const practicalExample = String(generatedDraft.practical_example || "").trim();
  const exampleBlock = practicalExample ? `Na prática:\n${practicalExample}` : "";

  const closingQuestion = String(generatedDraft.closing_question || "").trim();

  const hashtags = Array.isArray(generatedDraft.hashtags)
    ? generatedDraft.hashtags
        .map((tag) => String(tag).trim())
        .filter(Boolean)
        .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
        .join(" ")
    : "";

  return [
    hook,
    context,
    keyPoints,
    exampleBlock,
    closingQuestion,
    `Fonte: ${sourceUrl}`,
    hashtags,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function createDraftRecord({
  draftId,
  runId,
  articleTitle,
  articleUrl,
  articleSource = "",
  content,
  infographicBrief = "",
  diagramGcsObject = "",
  diagramMimeType = "image/png",
  callbackUrl = "",
  approvalToken = "",
  status = DraftStatus.PENDING,
}) {
  const now = new Date().toISOString();
  return {
    draft_id: draftId,
    run_id: runId,
    article_title: articleTitle,
    article_url: articleUrl,
    article_source: articleSource,
    content,
    infographic_brief: infographicBrief,
    diagram_gcs_object: diagramGcsObject,
    diagram_mime_type: diagramMimeType,
    include_diagram: Boolean(diagramGcsObject),
    status,
    callback_url: callbackUrl,
    approval_token: approvalToken,
    telegram_message_id: null,
    linkedin_post_urn: null,
    created_at: now,
    updated_at: now,
  };
}
