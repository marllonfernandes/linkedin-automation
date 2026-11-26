import { loadConfig } from "../config.js";
import { createApp } from "./app.js";

const config = loadConfig();
const app = createApp({ config });

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`[Service] linkedin-approval-service ouvindo na porta ${config.port}`);
});

function shutdown(signal) {
  console.log(`[Service] Recebido ${signal}, encerrando servidor graciosamente...`);
  server.close(() => {
    console.log("[Service] Servidor encerrado com sucesso.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[Service] Timeout no graceful shutdown, forçando saída.");
    process.exit(1);
  }, 9000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
