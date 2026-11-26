import { GoogleAuth } from "google-auth-library";

export class WorkflowsCallbackClient {
  static SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];

  constructor({ timeoutMs = 15000, fetchImpl = globalThis.fetch, tokenProvider } = {}) {
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.tokenProvider = tokenProvider;
    this._auth = tokenProvider ? null : new GoogleAuth({ scopes: WorkflowsCallbackClient.SCOPES });
  }

  async _getAccessToken() {
    if (this.tokenProvider) {
      return String(await this.tokenProvider());
    }
    const token = await this._auth.getAccessToken();
    if (!token) {
      throw new Error("Não foi possível obter access token GCP para o callback.");
    }
    return String(token);
  }

  async sendCallback(callbackUrl, payload) {
    if (!callbackUrl) {
      throw new Error("callbackUrl está vazio.");
    }
    const parsed = new URL(String(callbackUrl));
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".googleapis.com")) {
      throw new Error("callbackUrl inválido: esperado endpoint HTTPS do Google Cloud Workflows.");
    }
    const token = await this._getAccessToken();
    const response = await this.fetchImpl(callbackUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Workflows callback falhou (${response.status}): ${body}`);
    }
  }
}
