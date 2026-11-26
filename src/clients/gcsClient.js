import { GoogleAuth } from "google-auth-library";

export class GCSStorageClient {
  static SCOPES = ["https://www.googleapis.com/auth/devstorage.read_write"];

  constructor({ bucket, timeoutMs = 20000, fetchImpl = globalThis.fetch, tokenProvider } = {}) {
    this.bucket = String(bucket || "").trim();
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.tokenProvider = tokenProvider;
    this._auth = tokenProvider ? null : new GoogleAuth({ scopes: GCSStorageClient.SCOPES });
  }

  get isConfigured() {
    return Boolean(this.bucket);
  }

  async _getAccessToken() {
    if (this.tokenProvider) {
      return String(await this.tokenProvider());
    }
    const token = await this._auth.getAccessToken();
    if (!token) {
      throw new Error("Não foi possível obter access token GCP para o Cloud Storage.");
    }
    return String(token);
  }

  async uploadObject(objectName, buffer, contentType = "image/png") {
    if (!this.bucket) {
      throw new Error("GCS_BUCKET não configurado.");
    }
    const token = await this._getAccessToken();
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
      },
      body: buffer,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`GCS upload falhou (${response.status}): ${errText}`);
    }
    return objectName;
  }

  async downloadObject(objectName) {
    if (!this.bucket) {
      throw new Error("GCS_BUCKET não configurado.");
    }
    const token = await this._getAccessToken();
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(objectName)}?alt=media`;

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`GCS download falhou (${response.status}): ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get("content-type") || "image/png",
    };
  }
}
