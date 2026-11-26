export const DEFAULT_RSS_FEEDS = [
  "https://blog.google/technology/ai/rss/",
  "https://aws.amazon.com/blogs/architecture/feed/",
  "https://cloudblog.withgoogle.com/rss/",
];

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseCsv(value, fallback) {
  if (!value || !String(value).trim()) {
    return [...fallback];
  }
  const parsed = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...fallback];
}

export function loadConfig(env = process.env) {
  const rawMaxDrafts = Number.parseInt(env.MAX_DRAFTS_PER_RUN || "2", 10);
  const maxDraftsPerRun = Number.isNaN(rawMaxDrafts)
    ? 2
    : Math.max(1, Math.min(rawMaxDrafts, 2));

  const rawMaxItems = Number.parseInt(env.MAX_ITEMS_PER_FEED || "5", 10);
  const maxItemsPerFeed = Number.isNaN(rawMaxItems) ? 5 : Math.max(1, rawMaxItems);

  return Object.freeze({
    port: Number.parseInt(env.PORT || "8080", 10) || 8080,
    gcpProjectId: (env.GCP_PROJECT_ID || "").trim(),
    gcpRegion: (env.GCP_REGION || "us-central1").trim(),
    firestoreDatabase: (env.FIRESTORE_DATABASE || "(default)").trim(),
    gcsBucket: (env.GCS_BUCKET || "").trim(),

    rssFeeds: parseCsv(env.RSS_FEEDS, DEFAULT_RSS_FEEDS),
    maxDraftsPerRun,
    maxItemsPerFeed,

    geminiApiKey: (env.GEMINI_API_KEY || "").trim(),
    geminiModel: (env.GEMINI_MODEL || "gemini-3-flash-preview").trim(),
    geminiImageModel: (env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview").trim(),

    telegramBotToken: (env.TELEGRAM_BOT_TOKEN || "").trim(),
    telegramChatId: (env.TELEGRAM_CHAT_ID || "").trim(),
    telegramWebhookSecret: (env.TELEGRAM_WEBHOOK_SECRET || "").trim(),

    linkedinAccessToken: (env.LINKEDIN_ACCESS_TOKEN || "").trim(),
    linkedinAuthorUrn: (env.LINKEDIN_AUTHOR_URN || "").trim(),
    linkedinApiVersion: (env.LINKEDIN_API_VERSION || "202610").trim(),
    linkedinClientId: (env.LINKEDIN_CLIENT_ID || "").trim(),
    linkedinClientSecret: (env.LINKEDIN_CLIENT_SECRET || "").trim(),
    linkedinTokenWarnDays: Number.parseInt(env.LINKEDIN_TOKEN_WARN_DAYS || "7", 10) || 7,

    approvalServiceUrl: (env.APPROVAL_SERVICE_URL || "").trim().replace(/\/+$/, ""),
    workflowsServiceAccount: (env.WORKFLOWS_SERVICE_ACCOUNT || "").trim(),

    runId: (env.RUN_ID || "").trim(),
    callbackUrl: (env.CALLBACK_URL || "").trim(),
    dryRun: parseBool(env.DRY_RUN, false),
  });
}
