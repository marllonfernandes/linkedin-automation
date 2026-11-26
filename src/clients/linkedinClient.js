const URL_SPLIT_RE = /(https?:\/\/[^\s]+)/g;
const LITTLE_TEXT_RESERVED_RE = /[\\|{}[\]()<>*_~]/g;

/**
 * Escapa caracteres reservados da sintaxe Little Text da LinkedIn Posts API
 * preservando URLs intactas e mantendo #hashtags clicáveis.
 */
export function escapeLinkedInCommentary(text = "") {
  return String(text)
    .split(URL_SPLIT_RE)
    .map((segment, idx) => {
      if (idx % 2 === 1) {
        return segment;
      }
      return segment.replace(LITTLE_TEXT_RESERVED_RE, "\\$&");
    })
    .join("");
}

export class LinkedInClient {
  static POSTS_ENDPOINT = "https://api.linkedin.com/rest/posts";
  static IMAGES_INIT_ENDPOINT = "https://api.linkedin.com/rest/images?action=initializeUpload";

  constructor({
    accessToken,
    authorUrn,
    apiVersion = "202610",
    timeoutMs = 20000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (!accessToken) {
      throw new Error("LINKEDIN_ACCESS_TOKEN é obrigatório.");
    }
    if (!String(authorUrn || "").startsWith("urn:li:person:")) {
      throw new Error("LINKEDIN_AUTHOR_URN deve seguir o formato 'urn:li:person:<id>'.");
    }
    this.accessToken = accessToken;
    this.authorUrn = authorUrn;
    this.apiVersion = apiVersion;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  _defaultHeaders(contentType = "application/json") {
    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": this.apiVersion,
    };
    if (contentType) {
      headers["Content-Type"] = contentType;
    }
    return headers;
  }

  /**
   * Faz upload de um Buffer PNG/JPG via LinkedIn Images API e retorna o image URN.
   */
  async uploadImageBuffer(imageBytes, contentType = "image/png") {
    const initResponse = await this.fetchImpl(LinkedInClient.IMAGES_INIT_ENDPOINT, {
      method: "POST",
      headers: this._defaultHeaders("application/json"),
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: this.authorUrn,
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!initResponse.ok) {
      const errText = await initResponse.text();
      throw new Error(`LinkedIn Images initializeUpload falhou (${initResponse.status}): ${errText}`);
    }

    const initData = await initResponse.json();
    const uploadUrl = initData?.value?.uploadUrl;
    const imageUrn = initData?.value?.image;
    if (!uploadUrl || !imageUrn) {
      throw new Error("Resposta inválida do LinkedIn Images initializeUpload.");
    }

    const uploadResponse = await this.fetchImpl(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": contentType,
      },
      body: imageBytes,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      throw new Error(`Upload binário da imagem no LinkedIn falhou (${uploadResponse.status}): ${errText}`);
    }

    return String(imageUrn);
  }

  /**
   * Baixa uma imagem por URL e faz upload via LinkedIn Images API.
   */
  async uploadImageFromUrl(imageUrl) {
    const imgResponse = await this.fetchImpl(imageUrl, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!imgResponse.ok) {
      throw new Error(`Falha ao baixar imagem do diagrama (${imgResponse.status}).`);
    }
    const imageBytes = await imgResponse.arrayBuffer();
    const contentType = imgResponse.headers.get("content-type") || "image/png";
    return this.uploadImageBuffer(imageBytes, contentType);
  }

  async publishPost(
    commentary,
    { imageBuffer = null, imageMimeType = "image/png", imageUrl = "", imageTitle = "Infográfico Técnico" } = {},
  ) {
    let mediaContent = null;
    if (imageBuffer || imageUrl) {
      try {
        const imageUrn = imageBuffer
          ? await this.uploadImageBuffer(imageBuffer, imageMimeType)
          : await this.uploadImageFromUrl(imageUrl);
        mediaContent = {
          media: {
            title: imageTitle,
            id: imageUrn,
          },
        };
      } catch (err) {
        console.warn(`[LinkedInClient] Não foi possível anexar imagem, publicando texto: ${err.message}`);
      }
    }

    const payload = {
      author: this.authorUrn,
      commentary: escapeLinkedInCommentary(commentary),
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
      ...(mediaContent ? { content: mediaContent } : {}),
    };

    const response = await this.fetchImpl(LinkedInClient.POSTS_ENDPOINT, {
      method: "POST",
      headers: this._defaultHeaders("application/json"),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LinkedIn Posts API falhou (${response.status}): ${errorText}`);
    }

    const headerUrn = response.headers.get("x-restli-id");
    if (headerUrn) {
      return headerUrn;
    }

    const text = await response.text();
    if (text) {
      const body = JSON.parse(text);
      if (body.id) return String(body.id);
    }
    return "published";
  }
}
