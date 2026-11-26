import test from "node:test";
import assert from "node:assert/strict";
import { GeminiDraftGenerator } from "../src/clients/geminiClient.js";
import { renderPost } from "../src/models.js";

test("GeminiDraftGenerator gera rascunho formatado e infográfico PNG via Gemini Image", async () => {
  const calls = [];
  const fakePngBase64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

  const fakeClient = {
    models: {
      generateContent: async (args) => {
        calls.push(args);
        if (args.model === "gemini-3-pro-image-preview") {
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: fakePngBase64,
                      },
                    },
                  ],
                },
              },
            ],
          };
        }
        return {
          text: JSON.stringify({
            hook: "Callbacks HTTP no Cloud Workflows eliminam custo de espera.",
            context: "Orquestrar aprovações humanas sem manter containers ligados reduz custo a zero.",
            key_points: [
              "Zero compute ocioso durante a pausa do workflow.",
              "Idempotência garantida no Firestore com create() atômico.",
              "Aprovação segura via webhook autenticado.",
            ],
            practical_example:
              "Em pipelines de publicação, o workflow cria um callback URL, executa o Job e pausa até o clique no Telegram.",
            closing_question: "Como vocês orquestram etapas manuais em fluxos serverless?",
            needs_diagram: true,
            infographic_brief:
              "Título: Fluxo Human-in-the-Loop na GCP. Blocos: Cloud Scheduler -> Cloud Workflows -> Cloud Run Job -> Telegram -> LinkedIn API.",
            hashtags: ["GCP", "#CloudArchitecture", "Serverless"],
          }),
        };
      },
    },
  };

  const generator = new GeminiDraftGenerator({
    apiKey: "test-key",
    model: "gemini-3-flash-preview",
    imageModel: "gemini-3-pro-image-preview",
    client: fakeClient,
  });

  const draft = await generator.generateDraft({
    title: "Serverless Human-in-the-Loop",
    normalizedUrl: "https://example.com/hitl",
    summary: "Using callbacks in Cloud Workflows.",
    source: "GCP Blog",
  });

  const rendered = renderPost(draft, "https://example.com/hitl");
  const infographic = await generator.generateInfographic(draft.infographic_brief);

  assert.equal(calls[0].model, "gemini-3-flash-preview");
  assert.equal(calls[1].model, "gemini-3-pro-image-preview");
  assert.equal(draft.needs_diagram, true);
  assert.match(rendered, /▸ Zero compute ocioso/);
  assert.match(rendered, /Na prática:\nEm pipelines de publicação/);
  assert.match(rendered, /Fonte: https:\/\/example\.com\/hitl/);
  assert.match(rendered, /#GCP #CloudArchitecture #Serverless/);
  assert.equal(infographic.mimeType, "image/png");
  assert.equal(infographic.buffer.length, 8);
});
