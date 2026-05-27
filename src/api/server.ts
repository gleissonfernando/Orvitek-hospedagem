import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { apiConfig, getApiIntegrationStatus, logApiIntegrationStatus } from "./config";
import { connectMongo, isMongoConnected } from "./db";
import { devMockBotsRouter } from "./routes/devMockBots";
import { expireOverdueBots, hostingPlansRouter } from "./routes/hostingPlans";
import { orvitekRouter } from "./routes/orvitek";
import { userBotsRouter } from "./routes/userBots";
import { botManager } from "./services/BotManager";
import { processPendingHostingShutdownEvents } from "./services/HostingShutdownProcessor";

async function main(): Promise<void> {
  const app = express();
  let ready = false;

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: apiConfig.corsOrigin, credentials: true }));
  app.use(express.json({ limit: "32kb" }));
  app.use(express.static(path.join(process.cwd(), "src", "api", "public")));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      ready,
      storage: isMongoConnected() ? "mongodb" : "local-json",
      mongoConnected: isMongoConnected(),
      integrations: getApiIntegrationStatus()
    });
  });

  app.use("/api/user-bots", userBotsRouter);
  app.use("/api/hosting-plans", hostingPlansRouter);
  app.use("/api/orvitek", orvitekRouter);
  app.use("/api/dev", devMockBotsRouter);

  app.use((_req, res) => {
    res.status(404).json({ success: false, message: "Rota nao encontrada" });
  });

  if (apiConfig.mongoUri) {
    await connectMongo();
    console.log("MongoDB connected.");
  } else if (apiConfig.nodeEnv === "production") {
    throw new Error("MONGODB_URI e obrigatorio em producao para evitar perda de dados e queda por concorrencia.");
  } else {
    console.log("Using local JSON storage. Use MongoDB for production.");
  }

  const server = app.listen(apiConfig.port, () => {
    ready = true;
    console.log(`API listening on port ${apiConfig.port}`);
    logApiIntegrationStatus();
  });

  botManager.restoreOnlineBots().catch((error) => {
    console.error("Failed to restore user bots:", error.message);
  });

  setInterval(() => {
    expireOverdueBots()
      .then((expired) => {
        if (expired.length > 0) {
          console.log(`${expired.length} bot(s) desligado(s) por plano vencido.`);
        }
      })
      .catch((error) => {
        console.error("Failed to expire overdue plans:", error.message);
      });
  }, 60 * 60 * 1000);

  let shutdownWorkerRunning = false;
  setInterval(() => {
    if (!isMongoConnected() || shutdownWorkerRunning) {
      return;
    }

    shutdownWorkerRunning = true;
    processPendingHostingShutdownEvents()
      .then((count) => {
        if (count > 0) {
          console.log(`${count} evento(s) internos da Orvitek processado(s).`);
        }
      })
      .catch((error) => {
        console.error("Failed to process Orvitek shutdown events:", error.message);
      })
      .finally(() => {
        shutdownWorkerRunning = false;
      });
  }, 5 * 1000);

  function shutdown(signal: string): void {
    ready = false;
    console.log(`${signal} recebido, encerrando API com seguranca.`);
    server.close(() => {
      process.exit(0);
    });

    setTimeout(() => {
      process.exit(1);
    }, 30000).unref();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("API failed to start:", error.message);
  process.exitCode = 1;
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exitCode = 1;
});
