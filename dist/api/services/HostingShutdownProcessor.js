"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.shutdownHostingFromPayload = shutdownHostingFromPayload;
exports.processPendingHostingShutdownEvents = processPendingHostingShutdownEvents;
const mongoose_1 = __importDefault(require("mongoose"));
const config_1 = require("../config");
const BotManager_1 = require("./BotManager");
const userBotStore_1 = require("../storage/userBotStore");
function getEventsCollection() {
    if (!mongoose_1.default.connection.db) {
        throw new Error("MongoDB nao esta conectado.");
    }
    return mongoose_1.default.connection.db.collection(config_1.apiConfig.hostingEventsCollection);
}
function describePayload(payload) {
    return {
        eventId: payload.eventId || "",
        accessKey: payload.hosting?.accessKey || "",
        userId: payload.client?.userId || "",
        client: payload.client?.userTag || payload.client?.userId || payload.client?.clientId || payload.clientId || "cliente_desconhecido",
        projectName: payload.hosting?.projectName || "projeto_desconhecido",
        actionType: payload.action?.type || "",
        dueAt: payload.hosting?.dueAt || "vencimento_desconhecido"
    };
}
function logShutdownResult(info, result, error) {
    console.log(`[orvitek/desligar] eventId=${info.eventId || "sem_eventId"} userId=${info.userId || "sem_userId"} projectName=${info.projectName} accessKey=${info.accessKey || "sem_accessKey"} action=${info.actionType || "sem_action"} resultado=${result}${error ? ` erro=${error}` : ""}`);
}
function isShutdownPayload(payload) {
    const actionType = payload.action?.type?.toLowerCase();
    const hostingStatus = payload.hosting?.status?.toLowerCase();
    const paymentStatus = payload.hosting?.paymentStatus?.toLowerCase();
    const clientStatus = payload.client?.status?.toLowerCase();
    return [
        actionType,
        hostingStatus,
        paymentStatus,
        clientStatus
    ].some((value) => value && [
        "shutdown_client_hosting",
        "overdue",
        "expired",
        "vencido",
        "atrasado",
        "suspended",
        "suspendido",
        "inactive",
        "inativo"
    ].includes(value));
}
async function shutdownHostingFromPayload(payload) {
    if (!isShutdownPayload(payload)) {
        throw new Error("Payload nao indica vencimento/desligamento.");
    }
    const info = describePayload(payload);
    const clientId = payload.client?.clientId || payload.clientId || "";
    if (!info.accessKey && !clientId) {
        throw new Error("Informe payload.hosting.accessKey ou clientId para desligar.");
    }
    const bot = info.accessKey
        ? await (0, userBotStore_1.findUserBotByHostingAccessKey)(info.accessKey)
        : await (0, userBotStore_1.findUserBotByClientId)(clientId);
    if (!bot) {
        logShutdownResult(info, "nao_encontrado");
        return { ...info, message: "Bot nao encontrado para essa accessKey", result: "nao_encontrado" };
    }
    if (bot.status === "offline") {
        await (0, userBotStore_1.updateUserBot)(bot.userId, bot.clientId, {
            status: "offline",
            planStatus: "overdue",
            planExpiresAt: new Date().toISOString(),
            hostingAccessGranted: false,
            projectName: payload.hosting?.projectName || bot.projectName,
            hostingAccessKey: info.accessKey || bot.hostingAccessKey
        });
        logShutdownResult(info, "desligado");
        return { ...info, message: "Bot desligado com sucesso", result: "desligado" };
    }
    await BotManager_1.botManager.stopBot(bot.userId, bot.clientId);
    await (0, userBotStore_1.updateUserBot)(bot.userId, bot.clientId, {
        status: "offline",
        planStatus: "overdue",
        planExpiresAt: new Date().toISOString(),
        hostingAccessGranted: false,
        projectName: payload.hosting?.projectName || bot.projectName,
        hostingAccessKey: info.accessKey || bot.hostingAccessKey
    });
    logShutdownResult(info, "desligado");
    return { ...info, message: "Bot desligado com sucesso", result: "desligado" };
}
async function processPendingHostingShutdownEvents(limit = 25) {
    const collection = getEventsCollection();
    let processedCount = 0;
    for (let index = 0; index < limit; index += 1) {
        const now = new Date().toISOString();
        const event = await collection.findOneAndUpdate({
            status: "pending",
            $or: [
                { "payload.action.type": "shutdown_client_hosting" },
                { "payload.action.type": "overdue" },
                { "payload.action.type": "expired" },
                { "payload.action.type": "vencido" },
                { "payload.hosting.status": "overdue" },
                { "payload.hosting.status": "expired" },
                { "payload.hosting.status": "vencido" },
                { "payload.hosting.paymentStatus": "overdue" },
                { "payload.hosting.paymentStatus": "expired" },
                { "payload.hosting.paymentStatus": "vencido" },
                { "payload.client.status": "overdue" },
                { "payload.client.status": "expired" },
                { "payload.client.status": "vencido" }
            ]
        }, {
            $set: {
                status: "processing",
                processingStartedAt: now,
                updatedAt: now
            }
        }, {
            sort: { createdAt: 1 },
            returnDocument: "after"
        });
        if (!event) {
            break;
        }
        processedCount += 1;
        await processClaimedEvent(collection, event);
    }
    return processedCount;
}
async function processClaimedEvent(collection, event) {
    const payload = event.payload || {};
    const info = describePayload(payload);
    try {
        const result = await shutdownHostingFromPayload(payload);
        const now = new Date().toISOString();
        await collection.updateOne({ _id: event._id }, {
            $set: {
                status: "processed",
                processedAt: now,
                updatedAt: now,
                processingError: null
            }
        });
        console.log(`[hosting-shutdown-event] processed eventId=${event.eventId} cliente=${result.client} projeto=${result.projectName} accessKey=${result.accessKey} vencimento=${result.dueAt} resultado=${result.message}`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        const now = new Date().toISOString();
        await collection.updateOne({ _id: event._id }, {
            $set: {
                status: "failed",
                failedAt: now,
                updatedAt: now,
                processingError: message
            }
        });
        console.error(`[hosting-shutdown-event] failed eventId=${event.eventId} cliente=${info.client} projeto=${info.projectName} accessKey=${info.accessKey} vencimento=${info.dueAt} erro=${message}`);
    }
}
