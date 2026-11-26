import { GoogleAuth } from "google-auth-library";

const VALID_SECRET_NAME_RE = /^[a-zA-Z0-9_-]{1,255}$/;

export class SecretManagerClient {
  static SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];

  constructor({ projectId, timeoutMs = 15000, fetchImpl = globalThis.fetch, tokenProvider } = {}) {
    this.projectId = String(projectId || "").trim();
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.tokenProvider = tokenProvider;
    this._auth = tokenProvider ? null : new GoogleAuth({ scopes: SecretManagerClient.SCOPES });
  }

  get isConfigured() {
    return Boolean(this.projectId);
  }

  async _getAccessToken() {
    if (this.tokenProvider) {
      return String(await this.tokenProvider());
    }
    const token = await this._auth.getAccessToken();
    if (!token) {
      throw new Error("Não foi possível obter access token GCP para o Secret Manager.");
    }
    return String(token);
  }

  async getLatestVersionMetadata(secretName) {
    if (!this.projectId) {
      throw new Error("GCP_PROJECT_ID não configurado para SecretManagerClient.");
    }
    if (!VALID_SECRET_NAME_RE.test(String(secretName || ""))) {
      throw new Error("Nome de segredo inválido.");
    }
    const token = await this._getAccessToken();
    const url = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/secrets/${encodeURIComponent(secretName)}/versions/latest`;

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Secret Manager metadata falhou (${response.status}): ${errText}`);
    }
    return response.json();
  }

  async addSecretVersion(secretName, secretValue) {
    if (!this.projectId) {
      throw new Error("GCP_PROJECT_ID não configurado para SecretManagerClient.");
    }
    if (!VALID_SECRET_NAME_RE.test(String(secretName || ""))) {
      throw new Error("Nome de segredo inválido.");
    }
    const token = await this._getAccessToken();
    const url = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/secrets/${encodeURIComponent(secretName)}:addVersion`;

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payload: {
          data: Buffer.from(String(secretValue), "utf-8").toString("base64"),
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Secret Manager addVersion falhou (${response.status}): ${errText}`);
    }
    return response.json();
  }
}
