FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

# Instala somente dependências de produção (camada cacheável)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src

USER node

EXPOSE 8080

# Entrypoint padrão: Cloud Run Service (scale-to-zero).
# No Cloud Run Job, sobrescreva o comando para:
#   node src/job/main.js
CMD ["node", "src/service/server.js"]
