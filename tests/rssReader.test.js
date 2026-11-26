import test from "node:test";
import assert from "node:assert/strict";
import { RSSReader } from "../src/clients/rssReader.js";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Cloud Architecture Blog</title>
    <item>
      <title>Designing Event-Driven Systems on GCP</title>
      <link>https://example.com/posts/event-driven/</link>
      <description>&lt;p&gt;Practical patterns for &lt;b&gt;Cloud Workflows&lt;/b&gt; and Cloud Run.&lt;/p&gt;</description>
      <pubDate>Mon, 24 Nov 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Duplicate URL with Fragment</title>
      <link>https://example.com/posts/event-driven#section-2</link>
      <description>Should be deduplicated in-memory.</description>
    </item>
    <item>
      <title>LLM Observability in Production</title>
      <link>https://example.com/posts/llm-obs</link>
      <description>Latency, cost, and structured outputs.</description>
    </item>
  </channel>
</rss>`;

test("RSSReader faz parse, limpa HTML, ignora feed com erro e deduplica URLs", async () => {
  const fetchImpl = async (url) => {
    if (url === "https://feeds.example.com/ok.xml") {
      return new Response(SAMPLE_RSS, { status: 200 });
    }
    return new Response("server error", { status: 500 });
  };

  const reader = new RSSReader({ fetchImpl });
  const articles = await reader.fetchArticles(
    ["https://feeds.example.com/ok.xml", "https://feeds.example.com/fail.xml"],
    5,
  );

  assert.equal(articles.length, 2);
  assert.equal(articles[0].title, "Designing Event-Driven Systems on GCP");
  assert.equal(articles[0].summary, "Practical patterns for Cloud Workflows and Cloud Run.");
  assert.equal(articles[0].source, "Cloud Architecture Blog");
  assert.equal(articles[1].title, "LLM Observability in Production");
});
