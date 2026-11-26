function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export class TelegramClient {
  static API_BASE = "https://api.telegram.org";

  constructor({ botToken, chatId, timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
    if (!botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN é obrigatório.");
    }
    this.botToken = botToken;
    this.chatId = chatId;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async _post(method, payload) {
    const url = `${TelegramClient.API_BASE}/bot${this.botToken}/${method}`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Telegram API ${method} falhou (${response.status}): ${text}`);
    }
    return response.json();
  }

  async sendPhotoBuffer(buffer, mimeType = "image/png", caption = "") {
    const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
    const form = new FormData();
    form.append("chat_id", String(this.chatId));
    if (caption) {
      form.append("caption", String(caption).slice(0, 1024));
    }
    form.append("photo", new Blob([buffer], { type: mimeType }), `infografico.${ext}`);

    const url = `${TelegramClient.API_BASE}/bot${this.botToken}/sendPhoto`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Telegram API sendPhoto falhou (${response.status}): ${text}`);
    }
    return response.json();
  }

  async sendDraftForApproval(draft, approvalServiceUrl = "", imageAsset = null) {
    let hasImage = Boolean(draft.diagram_gcs_object);
    if (imageAsset?.buffer) {
      try {
        await this.sendPhotoBuffer(
          imageAsset.buffer,
          imageAsset.mimeType || "image/png",
          `Infográfico do rascunho ${draft.draft_id}: ${draft.article_title}`,
        );
        hasImage = true;
      } catch (err) {
        console.warn(`[TelegramClient] Falha ao enviar prévia do infográfico (${draft.draft_id}): ${err.message}`);
      }
    }

    let text =
      `<b>Novo rascunho para o LinkedIn</b>\n` +
      `<b>Fonte:</b> ${escapeHtml(draft.article_source || "RSS")}\n` +
      `<b>Artigo:</b> ${escapeHtml(draft.article_title)}\n` +
      `<b>ID:</b> <code>${escapeHtml(draft.draft_id)}</code>\n\n` +
      `${escapeHtml(draft.content)}`;

    if (approvalServiceUrl && draft.approval_token) {
      const approveLink = `${approvalServiceUrl}/approve/${draft.draft_id}?action=approve&token=${draft.approval_token}`;
      const rejectLink = `${approvalServiceUrl}/approve/${draft.draft_id}?action=reject&token=${draft.approval_token}`;
      text +=
        `\n\n<a href="${escapeHtml(approveLink)}">Link Aprovar</a> | ` +
        `<a href="${escapeHtml(rejectLink)}">Link Rejeitar</a>`;
    }

    const inlineKeyboard = hasImage
      ? [
          [
            { text: "✅ Publicar com imagem", callback_data: `approve_media:${draft.draft_id}` },
            { text: "📝 Publicar só texto", callback_data: `approve_text:${draft.draft_id}` },
          ],
          [{ text: "❌ Rejeitar", callback_data: `reject:${draft.draft_id}` }],
        ]
      : [
          [
            { text: "✅ Aprovar e Publicar", callback_data: `approve:${draft.draft_id}` },
            { text: "❌ Rejeitar", callback_data: `reject:${draft.draft_id}` },
          ],
        ];

    const data = await this._post("sendMessage", {
      chat_id: this.chatId,
      text: text.slice(0, 4096),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: inlineKeyboard,
      },
    });
    return Number(data.result.message_id);
  }

  async sendMessage(text, chatId = this.chatId) {
    const data = await this._post("sendMessage", {
      chat_id: chatId,
      text: String(text).slice(0, 4096),
      disable_web_page_preview: true,
    });
    return Number(data.result.message_id);
  }

  async answerCallbackQuery(callbackQueryId, text) {
    await this._post("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: String(text).slice(0, 200),
    });
  }

  async clearInlineButtons(chatId, messageId) {
    await this._post("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  }
}
