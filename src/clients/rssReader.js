import Parser from "rss-parser";
import { normalizeUrl, urlHash } from "../models.js";

function stripHtml(text = "") {
  return String(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export class RSSReader {
  constructor({ timeoutMs = 15000, fetchImpl = globalThis.fetch, parser = new Parser() } = {}) {
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.parser = parser;
  }

  async fetchArticles(feedUrls, maxPerFeed = 5) {
    const articles = [];
    const seenUrls = new Set();

    for (const feedUrl of feedUrls) {
      let parsedFeedUrl;
      try {
        parsedFeedUrl = new URL(String(feedUrl));
      } catch {
        console.warn(`[RSSReader] URL de feed inválida ignorada: ${feedUrl}`);
        continue;
      }
      if (
        !["http:", "https:"].includes(parsedFeedUrl.protocol) ||
        ["169.254.169.254", "metadata.google.internal", "localhost", "127.0.0.1"].includes(
          parsedFeedUrl.hostname.toLowerCase(),
        )
      ) {
        console.warn(`[RSSReader] Host/protocolo não permitido ignorado: ${feedUrl}`);
        continue;
      }

      let xml;
      try {
        const response = await this.fetchImpl(feedUrl, {
          headers: { "User-Agent": "linkedin-automation-gcp/0.1 (+https://cloud.google.com)" },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
          console.warn(`[RSSReader] Falha HTTP ${response.status} ao buscar ${feedUrl}`);
          continue;
        }
        xml = await response.text();
      } catch (err) {
        console.warn(`[RSSReader] Erro ao buscar feed ${feedUrl}: ${err.message}`);
        continue;
      }

      const parsed = await this.parser.parseString(xml);
      const sourceTitle = parsed.title || feedUrl;

      for (const entry of (parsed.items || []).slice(0, maxPerFeed)) {
        const link = (entry.link || "").trim();
        const title = (entry.title || "").trim();
        if (!link || !title) continue;

        let normalized;
        try {
          normalized = normalizeUrl(link);
        } catch {
          continue;
        }

        if (seenUrls.has(normalized)) continue;
        seenUrls.add(normalized);

        const summaryRaw = entry.contentSnippet || entry.summary || entry.content || "";
        articles.push({
          title,
          url: link,
          normalizedUrl: normalized,
          urlId: urlHash(normalized),
          summary: stripHtml(summaryRaw).slice(0, 1000),
          source: sourceTitle,
          publishedAt: String(entry.isoDate || entry.pubDate || ""),
        });
      }
    }

    return articles;
  }
}
