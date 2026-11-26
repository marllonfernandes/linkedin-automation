import { GoogleGenAI, Type } from "@google/genai";

export const SYSTEM_PROMPT = `
Você é um arquiteto de soluções sênior escrevendo posts técnicos em português (pt-BR) para o LinkedIn.

Regras de estilo e formatação:
- Tom técnico, prático, direto e sem jargões vazios de marketing.
- Escreva para leitura escaneável no feed do LinkedIn (nada de blocão de texto).
- hook: 1 a 2 linhas fortes que despertem curiosidade técnica real.
- context: 1 parágrafo curto (2 a 3 linhas) contextualizando a novidade e o problema real.
- key_points: exatamente 3 a 4 pontos objetivos sobre trade-offs reais de arquitetura (latência, custo, memória, observabilidade ou resiliência). Cada ponto com 1 a 2 linhas.
- practical_example: um exemplo concreto e realista de cenário em produção (ex.: como aplicar, o que muda na arquitetura ou qual armadilha evitar), em 2 a 4 linhas.
- closing_question: 1 pergunta técnica genuína para estimular comentários de outros engenheiros/arquitetos.
- needs_diagram: true APENAS quando a notícia envolver arquitetura concreta, pipeline de dados, integrações, fluxo de inferência ou componentes cloud que fiquem mais claros visualmente; false para entrevistas, anúncios institucionais ou artigos de opinião.
- infographic_brief: se needs_diagram for true, descreva de forma estruturada e concisa (em português) o infográfico técnico a ser desenhado: título curto no topo, 3 a 5 blocos/nós com rótulos curtos, setas de fluxo e 1 destaque de trade-off/benefício em verde. Se needs_diagram for false, retorne string vazia "".
- hashtags: 4 a 5 hashtags técnicas relevantes.
- Não invente números, benchmarks ou fatos que não estejam no resumo da notícia.
`.trim();

const INFOGRAPHIC_STYLE_GUIDE = `
Crie um infográfico técnico minimalista de arquitetura de software em DARK MODE, em português do Brasil (pt-BR), seguindo rigorosamente este estilo visual:
- Fundo escuro fosco azul-grafite (#161925), limpo e sem textura ruidosa.
- Cards/nós com bordas arredondadas e contorno neon sutil (ciano #38bdf8, roxo #a78bfa, coral/rosa #f472b6, âmbar #fbbf24) contendo ícones vetoriais limpos (servidor, banco de dados, nuvem, cache, IA/CPU, seta).
- Fluxos conectados por linhas pontilhadas/tracejadas com pequenos pontos luminosos e setas direcionais claras.
- Título principal discreto e centralizado no topo; subtítulos em branco limpo; anotações técnicas curtas e conclusões/boas práticas destacadas em verde menta (#4ade80).
- Tipografia sans-serif moderna, legível e sem erros de ortografia em português.
- Layout equilibrado e espaçoso em formato 1:1 (quadrado) para feed do LinkedIn, sem poluição visual, sem marcas d'água e sem parágrafos longos.
`.trim();

const DRAFT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    hook: { type: Type.STRING, description: "Frase inicial de impacto técnico (1-2 linhas)." },
    context: { type: Type.STRING, description: "Contexto curto da notícia e problema técnico (2-3 linhas)." },
    key_points: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "3 a 4 pontos objetivos sobre trade-offs reais de arquitetura.",
    },
    practical_example: {
      type: Type.STRING,
      description: "Cenário prático concreto de aplicação ou armadilha em produção (2-4 linhas).",
    },
    closing_question: {
      type: Type.STRING,
      description: "Pergunta técnica genuína para gerar discussão nos comentários.",
    },
    needs_diagram: {
      type: Type.BOOLEAN,
      description: "True somente se um infográfico/diagrama arquitetural agregar valor real ao post.",
    },
    infographic_brief: {
      type: Type.STRING,
      description: "Especificação curta em pt-BR dos blocos, fluxo e destaques do infográfico (vazio se needs_diagram=false).",
    },
    hashtags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "4 a 5 hashtags técnicas.",
    },
  },
  required: [
    "hook",
    "context",
    "key_points",
    "practical_example",
    "closing_question",
    "needs_diagram",
    "infographic_brief",
    "hashtags",
  ],
};

export class GeminiDraftGenerator {
  constructor({
    apiKey,
    model = "gemini-3-flash-preview",
    imageModel = "gemini-3-pro-image-preview",
    client,
  } = {}) {
    if (!client && !apiKey) {
      throw new Error("GEMINI_API_KEY é obrigatória para inicializar o GeminiDraftGenerator.");
    }
    this.model = model;
    this.imageModel = imageModel;
    this.client = client || new GoogleGenAI({ apiKey });
  }

  async generateDraft(article) {
    const prompt = [
      "Crie um rascunho de post técnico bem formatado para o LinkedIn com exemplo prático e, se agregar valor arquitetural, um brief para infográfico visual baseado na notícia abaixo.",
      "",
      `Título: ${article.title}`,
      `Fonte: ${article.source}`,
      `URL: ${article.normalizedUrl || article.url}`,
      `Resumo: ${article.summary || "Sem resumo adicional."}`,
    ].join("\n");

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: DRAFT_RESPONSE_SCHEMA,
        temperature: 0.4,
      },
    });

    if (!response?.text) {
      throw new Error("Resposta vazia da Gemini API ao gerar rascunho.");
    }

    const parsed = JSON.parse(response.text);
    if (!parsed.hook || (!parsed.context && !parsed.body)) {
      throw new Error("Resposta JSON da Gemini API sem campos obrigatórios.");
    }

    return {
      hook: String(parsed.hook),
      context: String(parsed.context || parsed.body || ""),
      key_points: Array.isArray(parsed.key_points) ? parsed.key_points.map(String) : [],
      practical_example: String(parsed.practical_example || ""),
      closing_question: String(parsed.closing_question || ""),
      needs_diagram: Boolean(parsed.needs_diagram),
      infographic_brief: String(parsed.infographic_brief || "").trim(),
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : [],
    };
  }

  async generateInfographic(infographicBrief) {
    if (!infographicBrief || !String(infographicBrief).trim()) {
      return null;
    }

    const prompt = `${INFOGRAPHIC_STYLE_GUIDE}\n\nConteúdo técnico para ilustrar:\n${infographicBrief}`;

    const response = await this.client.models.generateContent({
      model: this.imageModel,
      contents: prompt,
      config: {
        responseModalities: ["IMAGE"],
      },
    });

    const parts = response?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((part) => part?.inlineData?.data);
    if (!imagePart) {
      throw new Error("Gemini Image API não retornou imagem inline.");
    }

    return {
      buffer: Buffer.from(imagePart.inlineData.data, "base64"),
      mimeType: imagePart.inlineData.mimeType || "image/png",
    };
  }
}
