# Projeto: Automação de Posts Técnicos no LinkedIn (GCP)

## Objetivo
Automatizar a curadoria de notícias de tecnologia (IA, Arquitetura de Soluções e Cloud), geração de rascunhos com tom técnico/prático e publicação no LinkedIn pessoal usando arquitetura serverless na GCP com aprovação humana (Human-in-the-Loop).

## Arquitetura definida (GCP)
- **Cloud Scheduler**: dispara o fluxo 3x por semana (cron).
- **Cloud Workflows**: orquestra o fluxo e usa callbacks HTTP nativos para pausar aguardando aprovação humana sem custo de compute.
- **Cloud Run Job**: lê feeds RSS, verifica duplicidade no Firestore (idempotência contra entregas at-least-once do Scheduler), gera 1–2 rascunhos via Gemini API e envia notificação para aprovação.
- **Cloud Run Service (scale-to-zero)**: recebe o webhook de aprovação (Telegram ou link autenticado) e dispara o callback do Cloud Workflows.
- **Firestore**: persiste URLs já processadas, rascunhos, status (`pending`, `approved`, `published`, `rejected`) e dados do callback.
- **Secret Manager**: armazena tokens OAuth 2.0 do LinkedIn, chave da Gemini API e token do bot de aprovação.
- **LinkedIn Posts API**: publicação oficial no perfil pessoal via OAuth 2.0 (produto Share on LinkedIn).

## Restrições e boas práticas
- Priorizar serviços dentro do Free Tier da GCP.
- Nunca publicar direto sem aprovação humana (sempre passar pela etapa de revisão).
- Não usar scraping de navegador nem automação de curtidas/comentários (apenas API oficial para publicação).
- Linguagem preferencial: Python (ou Node.js, se definido na sessão), containerizado com Dockerfile leve.
- Incluir testes unitários básicos e comandos `gcloud` claros para deploy.
