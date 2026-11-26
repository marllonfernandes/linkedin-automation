<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:0f172a,50:1e293b,100:0ea5e9&height=210&section=header&text=LinkedIn%20Automation%20GCP&fontSize=42&fontColor=f8fafc&animation=fadeIn&fontAlignY=38&desc=Curadoria%20Tech%20%E2%80%A2%20Gemini%20API%20%E2%80%A2%20Human-in-the-Loop%20Serverless&descAlignY=58&descSize=16" alt="LinkedIn Automation GCP Banner" width="100%" />

  <p>
    <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=500&size=18&duration=3000&pause=1000&color=38BDF8&center=true&vCenter=true&width=720&lines=Curadoria+autom%C3%A1tica+de+IA%2C+Arquitetura+e+Cloud;Rascunhos+%2B+Infogr%C3%A1ficos+Dark-Mode+via+Gemini+API;Aprova%C3%A7%C3%A3o+Human-in-the-Loop+no+Telegram+em+1+clique;100%25+Serverless+na+GCP+com+custo+ocioso+zero" alt="Typing SVG" />
  </p>

  <p>
    <img src="https://img.shields.io/badge/Node.js-22%20ESM-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 22" />
    <img src="https://img.shields.io/badge/Google%20Cloud-Serverless-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white" alt="Google Cloud" />
    <img src="https://img.shields.io/badge/Gemini%20API-Flash%20%2B%20Image-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white" alt="Gemini API" />
    <img src="https://img.shields.io/badge/Telegram-HITL%20Approval-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram Bot" />
    <img src="https://img.shields.io/badge/LinkedIn-Posts%20%26%20Images%20API-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn API" />
  </p>
</div>

# Automação de Posts Técnicos no LinkedIn (GCP Serverless + Node.js)

MVP completo em **Node.js 22 (ESM)** para curadoria automatizada de notícias de tecnologia (**IA, Arquitetura de Soluções e Cloud**), geração de rascunhos técnicos estruturados + infográficos dark-mode com **Gemini API (`@google/genai`)** e publicação no perfil pessoal via **LinkedIn Posts API & Images API oficiais** com **aprovação humana obrigatória (Human-in-the-Loop)**.

## Arquitetura (Free Tier friendly)

### Arquitetura Cloud (`architecture-beta`)

```mermaid
architecture-beta
    group gcp(cloud)[Google Cloud Platform Serverless]
    group ext(internet)[APIs Externas]

    service scheduler(server)[Cloud Scheduler] in gcp
    service workflows(server)[Cloud Workflows] in gcp
    service job(server)[Cloud Run Jobs] in gcp
    service service_api(server)[Cloud Run Service] in gcp
    service firestore(database)[Firestore] in gcp
    service gcs(disk)[Cloud Storage] in gcp
    service secrets(disk)[Secret Manager] in gcp

    service rss(internet)[Feeds RSS] in ext
    service gemini(cloud)[Gemini API] in ext
    service telegram(internet)[Telegram Bot] in ext
    service linkedin(internet)[LinkedIn API] in ext

    junction j_ext in ext

    scheduler:R --> L:workflows
    workflows:R --> L:job
    workflows:B --> T:service_api

    job:T --> B:gcs
    job:B --> T:firestore
    service_api:R --> L:firestore
    service_api:L --> R:secrets

    job:R --> L:j_ext
    j_ext:T --> B:rss
    j_ext:R --> L:gemini
    j_ext:B --> T:telegram
    service_api:B --> T:linkedin
```

### C4 Model — Nível 1: Contexto (`C4Context`)

```mermaid
%%{init: {'c4': {'diagramMarginX': 50, 'diagramMarginY': 30, 'c4ShapeMargin': 70, 'c4ShapePadding': 25}}}%%
C4Context
  title Diagrama de Contexto — Automação de Posts Técnicos no LinkedIn

  Person(author, "Autor / Revisor", "Revisa rascunhos, aprova publicações e renova OAuth.")
  System(system, "LinkedIn Automation GCP", "Curadoria RSS, geração via Gemini e publicação Human-in-the-Loop.")

  System_Ext(rss, "Feeds RSS / Atom", "Blogs de IA, Arquitetura e Cloud.")
  System_Ext(gemini, "Gemini API", "Texto estruturado (Flash) + Infográficos (Image).")
  System_Ext(telegram, "Telegram Bot API", "Prévias com botões inline e webhook.")
  System_Ext(linkedin, "LinkedIn Official API", "Posts API, Images API e OAuth 2.0.")

  Rel(author, telegram, "Aprova ou rejeita rascunhos", "Telegram")
  Rel(author, system, "Renova OAuth em 1 clique", "HTTPS")
  BiRel(system, telegram, "Prévias, alertas e webhook", "HTTPS")
  Rel(system, rss, "Coleta artigos", "RSS / HTTPS")
  Rel(system, gemini, "Gera posts e PNG", "HTTPS / JSON")
  Rel(system, linkedin, "Publica post e imagem", "REST OAuth 2.0")

  UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")
```

### C4 Model — Nível 2: Containers (`C4Container`)

```mermaid
%%{init: {'c4': {'diagramMarginX': 50, 'diagramMarginY': 30, 'c4ShapeMargin': 80, 'c4ShapePadding': 25}}}%%
C4Container
  title Diagrama de Containers — LinkedIn Automation GCP (Serverless)

  Person(author, "Autor / Revisor", "Aprova no Telegram e renova OAuth.")

  System_Boundary(gcp, "Google Cloud Platform (Free Tier)") {
    Container(schedCurator, "Scheduler Curadoria", "Cloud Scheduler", "Seg/Qua/Sex 09:00 BRT")
    Container(workflows, "Orquestrador", "Cloud Workflows", "Pausa até 48h via callback")
    Container(jobCurator, "Curator Job", "Cloud Run Job / Node 22", "RSS + Gemini + GCS + Telegram")

    Container(schedToken, "Scheduler Token", "Cloud Scheduler", "Seg 08:30 BRT")
    Container(jobToken, "Token Check Job", "Cloud Run Job / Node 22", "Checa expiração do token")
    Container(approvalSvc, "Approval & Publish", "Cloud Run Service", "Webhook, OAuth e /internal/publish")

    ContainerDb(firestore, "Cloud Firestore", "NoSQL Native", "processed_urls, drafts, oauth_states")
    ContainerDb(gcs, "Cloud Storage", "Bucket Privado", "Infográficos PNG")
    ContainerDb(secrets, "Secret Manager", "Cofre", "API keys e OAuth tokens")
  }

  System_Ext(rss, "Feeds RSS", "Notícias Tech")
  System_Ext(gemini, "Gemini API", "Flash + Pro Image")
  System_Ext(telegram, "Telegram Bot", "Botões e Webhook")
  System_Ext(linkedin, "LinkedIn API", "Posts + Images + OAuth")

  Rel(schedCurator, workflows, "Dispara", "OAuth2")
  Rel(workflows, jobCurator, "Executa", "Run API v2")
  Rel(jobCurator, rss, "Lê feeds", "HTTPS")
  Rel(jobCurator, gemini, "Gera texto/PNG", "HTTPS")
  Rel(jobCurator, gcs, "Salva PNG", "GCS API")
  Rel(jobCurator, firestore, "Dedupe e draft", "gRPC")
  Rel(jobCurator, telegram, "Envia prévia", "HTTPS")

  Rel(author, telegram, "Aprova / Rejeita", "App")
  Rel(telegram, approvalSvc, "Webhook", "HTTPS")
  BiRel(approvalSvc, workflows, "Callback / Publish", "OAuth2 / OIDC")
  Rel(approvalSvc, firestore, "Transações", "gRPC")
  Rel(approvalSvc, gcs, "Lê PNG", "GCS API")
  Rel(approvalSvc, linkedin, "Publica", "REST")

  Rel(schedToken, jobToken, "Checagem semanal", "Run API v2")
  Rel(jobToken, secrets, "Lê metadata", "HTTPS")
  Rel(jobToken, telegram, "Link 1-clique", "HTTPS")
  Rel(author, approvalSvc, "Renova OAuth", "HTTPS")
  Rel(approvalSvc, secrets, "Grava versão", "HTTPS")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

### Visão Geral de Componentes (Fluxo Detalhado)

```mermaid
flowchart TB
  User["👤 Autor / Revisor<br/>(Human-in-the-Loop)"]

  subgraph GCP["☁️ Google Cloud Platform (Serverless / Free Tier)"]
    direction TB
    Sched1["⏱️ Cloud Scheduler<br/>Curadoria (Seg/Qua/Sex 09:00)"]
    Sched2["⏱️ Cloud Scheduler<br/>Token Check (Seg 08:30)"]
    WF["🔀 Cloud Workflows<br/>linkedin-publish-workflow<br/>(Callback HTTP nativo, zero custo ocioso)"]
    JobCurator["⚙️ Cloud Run Job<br/>linkedin-curator-job<br/>(Node.js 22)"]
    JobToken["⚙️ Cloud Run Job<br/>linkedin-token-check-job<br/>(Node.js 22)"]
    Service["🌐 Cloud Run Service (scale-to-zero)<br/>linkedin-approval-service<br/>(Express / OIDC / Webhook)"]
    FS[("🗄️ Cloud Firestore<br/>processed_urls, drafts, oauth_states")]
    GCS[("🪣 Cloud Storage (Privado)<br/>Infográficos PNG")]
    SM[("🔐 Secret Manager<br/>API Keys & OAuth Tokens")]
  end

  RSS["📰 Feeds RSS/Atom<br/>(IA, Arquitetura, Cloud)"]
  Gemini["✨ Gemini API<br/>Flash (texto) + Pro Image (infográfico)"]
  TG["💬 Telegram Bot API<br/>Prévia + Botões Inline"]
  LI["💼 LinkedIn Official API<br/>Posts API + Images API + OAuth 2.0"]

  Sched1 -->|OAuth2 POST| WF
  WF -->|Executa Job| JobCurator
  JobCurator -->|Lê artigos| RSS
  JobCurator -->|Dedupe atômico + salva rascunho| FS
  JobCurator -->|Gera post + infográfico| Gemini
  JobCurator -->|Salva PNG| GCS
  JobCurator -->|Lê segredos| SM
  JobCurator -->|Envia prévia + botões| TG

  User -->|Aprova / Rejeita / Renova| TG
  TG -->|Webhook + Secret Token| Service
  User -->|OAuth 1-clique| Service
  Service -->|Atualiza status / Transação| FS
  Service -->|Callback autenticado| WF
  WF -->|POST /internal/publish OIDC| Service
  Service -->|Baixa PNG| GCS
  Service -->|Lê / Atualiza token| SM
  Service -->|Publica post + imagem| LI

  Sched2 -->|OAuth2 POST| JobToken
  JobToken -->|Verifica idade do token| SM
  JobToken -->|Valida /v2/userinfo| LI
  JobToken -->|Salva OAuth state| FS
  JobToken -->|Envia link 1-clique| TG
```

### Sequence Diagram — Fluxo Completo (Curadoria → Aprovação → Publicação)

```mermaid
sequenceDiagram
  autonumber
  participant CS as Cloud Scheduler
  participant WF as Cloud Workflows
  participant Job as Cloud Run Job (Curator)
  participant RSS as Feeds RSS
  participant FS as Firestore
  participant AI as Gemini API (Flash + Image)
  participant GCS as Cloud Storage
  participant TG as Telegram
  participant Human as Autor (Você)
  participant Svc as Cloud Run Service
  participant LI as LinkedIn API

  CS->>WF: Dispara execução (Seg/Qua/Sex 09:00)
  WF->>WF: Cria callback HTTP nativo (callback_url)
  WF->>Job: Executa Job (RUN_ID, CALLBACK_URL)
  Job->>RSS: Coleta artigos recentes (IA, Arquitetura, Cloud)

  loop Até MAX_DRAFTS_PER_RUN (1-2 rascunhos)
    Job->>FS: tryClaimArticle() via create() atômico (SHA-256)
    alt Artigo novo
      Job->>AI: Gera rascunho estruturado + needs_diagram (Gemini Flash)
      opt needs_diagram == true
        Job->>AI: Gera infográfico dark-mode PNG (Gemini Image)
        Job->>GCS: Salva PNG privado (drafts/<id>.png)
      end
      Job->>FS: Salva rascunho (status = pending)
      Job->>TG: Envia imagem PNG + texto + botões inline
    end
  end

  WF->>WF: await_callback (pausa até 48h sem custo de compute)

  Human->>TG: Clica em "✅ Publicar com imagem", "📝 Só texto" ou "❌ Rejeitar"
  TG->>Svc: POST /webhook/telegram (X-Telegram-Bot-Api-Secret-Token)
  Svc->>FS: Atualiza status (approved / rejected) + include_diagram

  alt Rejeitou 1 de 2 rascunhos (outro ainda pending)
    Svc->>TG: "Rascunho rejeitado. Você ainda pode aprovar o outro!"
    Note over WF: Permanece pausado aguardando decisão no 2º rascunho
  else Aprovou ou rejeitou todos
    Svc->>WF: POST callback_url (decision + draft_id)
  end

  opt decision == "approved"
    WF->>Svc: POST /internal/publish (Token OIDC da Service Account)
    Svc->>FS: claimForPublish() transacional (approved → publishing)
    opt include_diagram == true
      Svc->>GCS: Baixa PNG do infográfico
      Svc->>LI: POST /rest/images?action=initializeUpload + PUT binário
    end
    Svc->>LI: POST /rest/posts (Little Text escapado + media URN)
    LI-->>Svc: 201 Created (linkedin_post_urn)
    Svc->>FS: markPublished (status = published)
    Svc->>TG: Envia confirmação com URN publicado
  end
```

### Sequence Diagram — Renovação do Token LinkedIn em 1 Clique

```mermaid
sequenceDiagram
  autonumber
  participant CS as Cloud Scheduler (Seg 08:30)
  participant Job as Cloud Run Job (Token Check)
  participant SM as Secret Manager
  participant FS as Firestore
  participant TG as Telegram
  participant Human as Autor (Você)
  participant Svc as Cloud Run Service
  participant LI as LinkedIn OAuth 2.0

  CS->>Job: Executa checagem semanal
  Job->>SM: Lê metadata da versão :latest (createTime)
  Job->>LI: GET /v2/userinfo (valida token ativo)

  opt Faltam <= 7 dias ou token inválido
    Job->>FS: Salva oauth_state de uso único (TTL 48h)
    Job->>TG: Envia alerta + link /auth/linkedin/start?state=...
    Human->>Svc: Clica no link (GET /auth/linkedin/start)
    Svc->>FS: Valida state ativo
    Svc-->>Human: 302 Redirect para tela oficial de consentimento LinkedIn
    Human->>LI: Clica em "Permitir"
    LI-->>Svc: GET /auth/linkedin/callback?code=...&state=...
    Svc->>FS: consumeOAuthState() via transação (bloqueia replay)
    Svc->>LI: POST /oauth/v2/accessToken (troca code por novo token)
    Svc->>LI: GET /v2/userinfo (confirma LINKEDIN_AUTHOR_URN)
    Svc->>SM: addSecretVersion("linkedin-access-token", novo_token)
    Svc->>TG: "✅ Token renovado por mais 60 dias!"
  end
```

### Garantias de segurança e boas práticas
- **Human-in-the-Loop estrito**: `/internal/publish` recusa (`409 Conflict`) qualquer rascunho fora do status `approved` no Firestore e valida token **OIDC** da Service Account do Cloud Workflows (fail-closed em produção).
- **Webhook protegido**: `/webhook/telegram` valida `X-Telegram-Bot-Api-Secret-Token` em tempo constante (`timingSafeEqual`) e restringe aprovações ao `TELEGRAM_CHAT_ID` configurado.
- **Rejeição independente**: rejeitar 1 dos 2 rascunhos da execução não cancela o outro no Cloud Workflows — o workflow só encerra como `rejected` se todos os rascunhos da execução forem rejeitados.
- **Hardening HTTP & validação de entrada**: limite de payload (`64kb`), `x-powered-by` desabilitado, headers defensivos (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cache-Control: no-store`), validação estrita de `draftId`, objeto GCS (`drafts/*.png|jpg`) e host do callback (`*.googleapis.com`).
- **Idempotência**: URLs normalizadas e reservadas no Firestore via `create()` atômico (`SHA-256` como ID do documento), evitando duplicidade em entregas *at-least-once* do Cloud Scheduler.
- **Zero custo ocioso**: Cloud Workflows aguarda o callback sem compute ativo; Cloud Run Service roda com `--min-instances=0`; bucket GCS privado com uniform bucket-level access.
- **Somente API oficial**: usa `POST https://api.linkedin.com/rest/posts` e `POST https://api.linkedin.com/rest/images?action=initializeUpload` com escape *Little Text* (sem scraping nem automação de engajamento).

---

## Estrutura de pastas

```text
linkedin-automation-gcp/
├── README.md
├── package.json                     # Node.js 22 ESM + scripts start/job/token-check/test
├── Dockerfile                       # Imagem leve node:22-slim (usuário não-root)
├── .dockerignore
├── .env.example
├── .gitignore
├── src/
│   ├── config.js
│   ├── models.js
│   ├── clients/
│   │   ├── firestoreRepo.js         # Idempotência + ciclo de vida dos rascunhos
│   │   ├── gcsClient.js             # Upload/download autenticado de infográficos no GCS
│   │   ├── geminiClient.js          # Rascunho estruturado + infográfico dark-mode
│   │   ├── linkedinClient.js        # Posts API (com escape Little Text) + Images API
│   │   ├── rssReader.js             # Curadoria de feeds RSS/Atom
│   │   ├── secretManagerClient.js   # Metadados e rotação de versões no Secret Manager
│   │   ├── telegramClient.js        # Envio de PNG + rascunho com botões inline
│   │   └── workflowsClient.js       # Callback HTTP autenticado do Cloud Workflows
│   ├── job/
│   │   ├── main.js                  # Cloud Run Job (curadoria + geração)
│   │   └── tokenCheck.js            # Cloud Run Job (checagem semanal do token LinkedIn)
│   └── service/
│       ├── app.js                   # Express app (webhook, OAuth 1-clique, publish OIDC)
│       └── server.js                # Entrypoint HTTP com graceful shutdown (PORT=8080)
├── workflows/
│   └── linkedin_publish_workflow.yaml
└── tests/
    ├── firestoreRepo.test.js
    ├── geminiClient.test.js
    ├── jobMain.test.js
    ├── linkedinClient.test.js
    ├── rssReader.test.js
    ├── serviceApp.test.js
    └── tokenCheck.test.js
```

---

## Desenvolvimento local e testes

```bash
npm install
npm test

cp .env.example .env
# Preencha o .env (sem aspas nos valores)
npm start                    # Sobe o Express na porta 8080
DRY_RUN=true npm run job     # Executa o Cloud Run Job localmente
```

---

## Deploy na GCP (`gcloud`)

<details open>
<summary><strong>Comandos passo a passo</strong></summary>

#### 1. Carregar variáveis de ambiente
```bash
set -a && source .env && set +a
export SA_NAME="linkedin-automation-sa"
export SA_EMAIL="${SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
export IMAGE_URI="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/linkedin-automation/linkedin-automation:latest"
```

#### 2. Habilitar APIs, criar Firestore, Service Account, IAM, Artifact Registry e Bucket GCS
```bash
gcloud auth login
gcloud config set project "${GCP_PROJECT_ID}"

gcloud services enable \
  run.googleapis.com \
  workflows.googleapis.com \
  cloudscheduler.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com

gcloud firestore databases create --location="${GCP_REGION}" --type=firestore-native

gcloud iam service-accounts create "${SA_NAME}" \
  --display-name="LinkedIn Automation Serverless SA"

for ROLE in \
  roles/datastore.user \
  roles/secretmanager.secretAccessor \
  roles/storage.objectAdmin \
  roles/run.invoker \
  roles/run.developer \
  roles/workflows.invoker \
  roles/workflows.editor \
  roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet
done

gcloud artifacts repositories create linkedin-automation \
  --repository-format=docker \
  --location="${GCP_REGION}"

gcloud storage buckets create "gs://${GCS_BUCKET}" \
  --location="${GCP_REGION}" \
  --uniform-bucket-level-access
```

#### 3. Criar os segredos no Secret Manager
```bash
printf "%s" "${GEMINI_API_KEY}" | gcloud secrets create gemini-api-key --data-file=-
printf "%s" "${TELEGRAM_BOT_TOKEN}" | gcloud secrets create telegram-bot-token --data-file=-
printf "%s" "${TELEGRAM_WEBHOOK_SECRET}" | gcloud secrets create telegram-webhook-secret --data-file=-
printf "%s" "${LINKEDIN_ACCESS_TOKEN}" | gcloud secrets create linkedin-access-token --data-file=-
```

#### 4. Build da imagem Docker (Cloud Build)
```bash
gcloud builds submit --tag "${IMAGE_URI}" .
```

#### 5. Deploy do Cloud Run Service (scale-to-zero)
```bash
gcloud run deploy linkedin-approval-service \
  --image="${IMAGE_URI}" \
  --region="${GCP_REGION}" \
  --service-account="${SA_EMAIL}" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=2 \
  --memory=512Mi \
  --cpu=1 \
  --set-env-vars="GCP_PROJECT_ID=${GCP_PROJECT_ID},GCP_REGION=${GCP_REGION},GCS_BUCKET=${GCS_BUCKET},TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID},LINKEDIN_AUTHOR_URN=${LINKEDIN_AUTHOR_URN},LINKEDIN_API_VERSION=${LINKEDIN_API_VERSION},WORKFLOWS_SERVICE_ACCOUNT=${SA_EMAIL}" \
  --set-secrets="TELEGRAM_BOT_TOKEN=telegram-bot-token:latest,TELEGRAM_WEBHOOK_SECRET=telegram-webhook-secret:latest,LINKEDIN_ACCESS_TOKEN=linkedin-access-token:latest"

SERVICE_URL="$(gcloud run services describe linkedin-approval-service --region="${GCP_REGION}" --format='value(status.url)')"

gcloud run services update linkedin-approval-service \
  --region="${GCP_REGION}" \
  --update-env-vars="APPROVAL_SERVICE_URL=${SERVICE_URL}"
```

#### 6. Deploy do Cloud Run Job (curadoria RSS + Gemini)
```bash
gcloud run jobs deploy linkedin-curator-job \
  --image="${IMAGE_URI}" \
  --region="${GCP_REGION}" \
  --service-account="${SA_EMAIL}" \
  --command="node" \
  --args="src/job/main.js" \
  --tasks=1 \
  --max-retries=1 \
  --task-timeout=300s \
  --memory=512Mi \
  --cpu=1 \
  --set-env-vars="^|^GCP_PROJECT_ID=${GCP_PROJECT_ID}|GCP_REGION=${GCP_REGION}|GCS_BUCKET=${GCS_BUCKET}|TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}|APPROVAL_SERVICE_URL=${SERVICE_URL}|RSS_FEEDS=${RSS_FEEDS}|MAX_DRAFTS_PER_RUN=${MAX_DRAFTS_PER_RUN}|GEMINI_MODEL=${GEMINI_MODEL}|GEMINI_IMAGE_MODEL=${GEMINI_IMAGE_MODEL}" \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest,TELEGRAM_BOT_TOKEN=telegram-bot-token:latest"
```

#### 7. Deploy do Cloud Workflows e Cloud Scheduler
```bash
gcloud workflows deploy linkedin-publish-workflow \
  --location="${GCP_REGION}" \
  --source="workflows/linkedin_publish_workflow.yaml" \
  --service-account="${SA_EMAIL}"

gcloud scheduler jobs create http linkedin-curator-schedule \
  --location="${GCP_REGION}" \
  --schedule="0 9 * * 1,3,5" \
  --time-zone="America/Sao_Paulo" \
  --uri="https://workflowexecutions.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_REGION}/workflows/linkedin-publish-workflow/executions" \
  --http-method=POST \
  --oauth-service-account-email="${SA_EMAIL}" \
  --headers="Content-Type=application/json" \
  --message-body="{\"argument\":\"{\\\"project_id\\\":\\\"${GCP_PROJECT_ID}\\\",\\\"region\\\":\\\"${GCP_REGION}\\\",\\\"job_name\\\":\\\"linkedin-curator-job\\\",\\\"approval_service_url\\\":\\\"${SERVICE_URL}\\\",\\\"approval_timeout_seconds\\\":172800}\"}"
```

#### 8. Registrar webhook do Telegram e executar teste manual
```bash
curl -fsS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"${SERVICE_URL}/webhook/telegram\",\"secret_token\":\"${TELEGRAM_WEBHOOK_SECRET}\",\"allowed_updates\":[\"callback_query\"]}"

gcloud workflows run linkedin-publish-workflow \
  --location="${GCP_REGION}" \
  --data="{\"project_id\":\"${GCP_PROJECT_ID}\",\"region\":\"${GCP_REGION}\",\"job_name\":\"linkedin-curator-job\",\"approval_service_url\":\"${SERVICE_URL}\",\"approval_timeout_seconds\":172800}"
```

</details>

---

### Renovação do token do LinkedIn (alerta automático + 1 clique)
O token OAuth 2.0 do LinkedIn dura **60 dias** (o LinkedIn não libera `refresh_token` automático para apps pessoais). Para evitar expiração surpresa:

1. Um **Cloud Scheduler semanal** (`linkedin-token-check-schedule`, segundas às 08:30 `America/Sao_Paulo`) executa o **Cloud Run Job** `linkedin-token-check-job` ([tokenCheck.js](src/job/tokenCheck.js)).
2. Quando faltarem **≤ 7 dias** para expirar (ou se o token estiver inválido), o bot envia automaticamente um **link único de renovação** no Telegram.
3. Ao clicar no link, você autoriza na tela oficial do LinkedIn e o **Cloud Run Service** (`/auth/linkedin/callback`) salva automaticamente a nova versão de `linkedin-access-token` no Secret Manager — **sem abrir terminal**.

**Pré-requisito no LinkedIn Developer Portal** (aba **Auth → OAuth 2.0 settings → Authorized redirect URLs**):
adicione `https://<SUA_SERVICE_URL>/auth/linkedin/callback` e configure `LINKEDIN_CLIENT_ID` e o segredo `linkedin-client-secret` no Secret Manager.

*(Caso prefira renovar manualmente: `printf "%s" "NOVO_TOKEN" | gcloud secrets versions add linkedin-access-token --data-file=-`.)*

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0ea5e9,50:1e293b,100:0f172a&height=110&section=footer" alt="Footer wave" width="100%" />
