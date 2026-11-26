import test from "node:test";
import assert from "node:assert/strict";
import { escapeLinkedInCommentary, LinkedInClient } from "../src/clients/linkedinClient.js";

test("escapeLinkedInCommentary escapa parênteses preservando URLs e hashtags", () => {
  const input =
    "Impacto no Garbage Collector (GC) e [memória].\n\nFonte: https://example.com/my_post_(v2)\n\n#CloudArchitecture #IA";
  const escaped = escapeLinkedInCommentary(input);

  assert.match(escaped, /Garbage Collector \\\(GC\\\) e \\\[memória\\\]\./);
  assert.match(escaped, /Fonte: https:\/\/example\.com\/my_post_\(v2\)/);
  assert.match(escaped, /#CloudArchitecture #IA/);
});

test("LinkedInClient publica texto escapado e anexa imagem via Images API", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", options });
    if (url === "https://mermaid.ink/img/test.png") {
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (url === LinkedInClient.IMAGES_INIT_ENDPOINT) {
      return new Response(
        JSON.stringify({
          value: {
            uploadUrl: "https://api.linkedin.com/dmsUpload/abc",
            image: "urn:li:image:img-999",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === "https://api.linkedin.com/dmsUpload/abc") {
      return new Response(null, { status: 201 });
    }
    if (url === LinkedInClient.POSTS_ENDPOINT) {
      return new Response(null, {
        status: 201,
        headers: { "x-restli-id": "urn:li:share:123456789" },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const client = new LinkedInClient({
    accessToken: "oauth-token",
    authorUrn: "urn:li:person:abc123",
    apiVersion: "202610",
    fetchImpl,
  });

  const urn = await client.publishPost("Post técnico com (GC) e #Cloud", {
    imageUrl: "https://mermaid.ink/img/test.png",
    imageTitle: "Fluxo On-Device",
  });

  assert.equal(urn, "urn:li:share:123456789");
  const postCall = calls.find((c) => c.url === LinkedInClient.POSTS_ENDPOINT);
  const body = JSON.parse(postCall.options.body);
  assert.equal(postCall.options.headers["LinkedIn-Version"], "202610");
  assert.equal(body.commentary, "Post técnico com \\(GC\\) e #Cloud");
  assert.deepEqual(body.content, {
    media: { title: "Fluxo On-Device", id: "urn:li:image:img-999" },
  });
});

test("LinkedInClient valida formato do authorUrn", () => {
  assert.throws(
    () => new LinkedInClient({ accessToken: "token", authorUrn: "invalid-urn" }),
    /urn:li:person:/,
  );
});
