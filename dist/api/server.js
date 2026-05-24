"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
const db_1 = require("./db");
const devMockBots_1 = require("./routes/devMockBots");
const hostingPlans_1 = require("./routes/hostingPlans");
const orvitek_1 = require("./routes/orvitek");
const userBots_1 = require("./routes/userBots");
const BotManager_1 = require("./services/BotManager");
const HostingShutdownProcessor_1 = require("./services/HostingShutdownProcessor");
async function main() {
    const app = (0, express_1.default)();
    let ready = false;
    app.disable("x-powered-by");
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)({ origin: config_1.apiConfig.corsOrigin, credentials: true }));
    app.use(express_1.default.json({ limit: "32kb" }));
    app.use(express_1.default.static(node_path_1.default.join(process.cwd(), "src", "api", "public")));
    app.get("/health", (_req, res) => {
        res.json({
            ok: true,
            ready,
            storage: (0, db_1.isMongoConnected)() ? "mongodb" : "local-json",
            mongoConnected: (0, db_1.isMongoConnected)()
        });
    });
    app.use("/api/user-bots", userBots_1.userBotsRouter);
    app.use("/api/hosting-plans", hostingPlans_1.hostingPlansRouter);
    app.use("/api/orvitek", orvitek_1.orvitekRouter);
    app.use("/api/dev", devMockBots_1.devMockBotsRouter);
    app.use((_req, res) => {
        res.status(404).json({ success: false, message: "Rota nao encontrada" });
    });
    if (config_1.apiConfig.mongoUri) {
        await (0, db_1.connectMongo)();
        console.log("MongoDB connected.");
    }
    else if (config_1.apiConfig.nodeEnv === "production") {
        throw new Error("MONGODB_URI e obrigatorio em producao para evitar perda de dados e queda por concorrencia.");
    }
    else {
        console.log("Using local JSON storage. Use MongoDB for production.");
    }
    const server = app.listen(config_1.apiConfig.port, () => {
        ready = true;
        console.log(`API listening on port ${config_1.apiConfig.port}`);
    });
    BotManager_1.botManager.restoreOnlineBots().catch((error) => {
        console.error("Failed to restore user bots:", error.message);
    });
    BotManager_1.botManager.syncHierarchyCommandsForRegisteredBots()
        .then((results) => {
        const synced = results.filter((result) => result.ok).length;
        if (results.length > 0) {
            console.log(`${synced}/${results.length} bot(s) com /herarquia sincronizado(s).`);
        }
    })
        .catch((error) => {
        console.error("Failed to sync hierarchy commands:", error.message);
    });
    setInterval(() => {
        (0, hostingPlans_1.expireOverdueBots)()
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
        if (!(0, db_1.isMongoConnected)() || shutdownWorkerRunning) {
            return;
        }
        shutdownWorkerRunning = true;
        (0, HostingShutdownProcessor_1.processPendingHostingShutdownEvents)()
            .then((count) => {
            if (count > 0) {
                console.log(`${count} evento(s) de desligamento da Orvitek processado(s).`);
            }
        })
            .catch((error) => {
            console.error("Failed to process Orvitek shutdown events:", error.message);
        })
            .finally(() => {
            shutdownWorkerRunning = false;
        });
    }, 5 * 1000);
    function shutdown(signal) {
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
