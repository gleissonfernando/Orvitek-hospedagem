"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HostingPayloadValidationError = void 0;
exports.isHostingPayloadValidationError = isHostingPayloadValidationError;
exports.shutdownHostingFromPayload = shutdownHostingFromPayload;
exports.restoreHostingFromPayload = restoreHostingFromPayload;
exports.processHostingEventPayload = processHostingEventPayload;
exports.processPendingHostingShutdownEvents = processPendingHostingShutdownEvents;
const mongoose_1 = __importDefault(require("mongoose"));
const config_1 = require("../config");
const userBotStore_1 = require("../storage/userBotStore");
const BotManager_1 = require("./BotManager");
const shutdownActions = new Set(["shutdown_client_hosting", "overdue", "expired", "vencido", "atrasado", "suspended", "suspendido", "inactive", "inativo"]);
const restoreActions = new Set(["restore_client_hosting", "payment_confirmed", "paid", "pago", "active", "ativo", "restored", "restaurado"]);
class HostingPayloadValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "HostingPayloadValidationError";
    }
}
exports.HostingPayloadValidationError = HostingPayloadValidationError;
function isHostingPayloadValidationError(error) {
    return error instanceof HostingPayloadValidationError;
}
function getEventsCollection() {
    if (!mongoose_1.default.connection.db) {
        throw new Error("MongoDB nao esta conectado.");
    }
    return mongoose_1.default.connection.db.collection(config_1.apiConfig.hostingEventsCollection);
}
function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
}
function isValidDateString(value) {
    return Boolean(value && !Number.isNaN(new Date(value).getTime()));
}
function parseDate(value) {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
function describePayload(payload) {
    return {
        eventId: cleanString(payload.eventId),
        accessKey: cleanString(payload.hosting?.accessKey),
        userId: cleanString(payload.client?.userId),
        clientId: cleanString(payload.client?.clientId || payload.clientId),
        client: cleanString(payload.client?.userTag || payload.client?.userId || payload.client?.clientId || payload.clientId) || "cliente_desconhecido",
        projectName: cleanString(payload.hosting?.projectName) || "projeto_desconhecido",
        actionType: cleanString(payload.action?.type),
        dueAt: cleanString(payload.hosting?.dueAt) || "vencimento_desconhecido"
    };
}
function logActionResult(info, result, error) {
    console.log(`[orvitek/hosting] eventId=${info.eventId || "sem_eventId"} userId=${info.userId || "sem_userId"} clientId=${info.clientId || "sem_clientId"} projectName=${info.projectName} accessKey=${info.accessKey || "sem_accessKey"} action=${info.actionType || "sem_action"} resultado=${result}${error ? ` erro=${error}` : ""}`);
}
function resolveActionKind(payload) {
    const actionType = cleanString(payload.action?.type).toLowerCase();
    const event = cleanString(payload.event).toLowerCase();
    const hostingStatus = cleanString(payload.hosting?.status).toLowerCase();
    const paymentStatus = cleanString(payload.hosting?.paymentStatus).toLowerCase();
    const clientStatus = cleanString(payload.client?.status).toLowerCase();
    if (actionType === "shutdown_client_hosting" || event === "hosting.payment_overdue.shutdown") {
        return "shutdown";
    }
    if (actionType === "restore_client_hosting" || event === "hosting.payment_confirmed.restore") {
        return "restore";
    }
    if ([actionType, hostingStatus, paymentStatus, clientStatus].some((value) => shutdownActions.has(value))) {
        return "shutdown";
    }
    if ([actionType, hostingStatus, paymentStatus].some((value) => restoreActions.has(value))) {
        return "restore";
    }
    return null;
}
function validatePayload(input, expectedKind) {
    const payload = asObject(input);
    if (!payload) {
        throw new HostingPayloadValidationError("Payload precisa ser um objeto JSON.");
    }
    if (payload.sentAt && !isValidDateString(payload.sentAt)) {
        throw new HostingPayloadValidationError("sentAt precisa ser uma data ISO valida.");
    }
    if (payload.hosting?.dueAt && !isValidDateString(payload.hosting.dueAt)) {
        throw new HostingPayloadValidationError("hosting.dueAt precisa ser uma data ISO valida.");
    }
    if (payload.hosting?.graceUntil && !isValidDateString(payload.hosting.graceUntil)) {
        throw new HostingPayloadValidationError("hosting.graceUntil precisa ser uma data ISO valida.");
    }
    const info = describePayload(payload);
    if (!info.accessKey && !info.clientId) {
        throw new HostingPayloadValidationError("Informe payload.hosting.accessKey ou clientId.");
    }
    const kind = resolveActionKind(payload);
    if (!kind || (expectedKind && kind !== expectedKind)) {
        const expected = expectedKind === "restore" ? "religamento" : expectedKind === "shutdown" ? "desligamento" : "acao valida";
        throw new HostingPayloadValidationError(`Payload nao indica ${expected}.`);
    }
    return { payload, info, kind };
}
async function findBotForPayload(info) {
    return info.accessKey
        ? (0, userBotStore_1.findUserBotByHostingAccessKey)(info.accessKey)
        : (0, userBotStore_1.findUserBotByClientId)(info.clientId);
}
function resolveRestoreExpiration(payload, bot) {
    const now = Date.now();
    const dueAt = parseDate(payload.hosting?.dueAt);
    const graceUntil = parseDate(payload.hosting?.graceUntil);
    const currentExpiration = parseDate(bot.planExpiresAt);
    if (dueAt && dueAt.getTime() > now) {
        return dueAt.toISOString();
    }
    if (graceUntil && graceUntil.getTime() > now) {
        return graceUntil.toISOString();
    }
    if (currentExpiration && currentExpiration.getTime() > now) {
        return currentExpiration.toISOString();
    }
    const nextExpiration = new Date(now);
    nextExpiration.setUTCDate(nextExpiration.getUTCDate() + 30);
    return nextExpiration.toISOString();
}
async function shutdownHostingFromPayload(input) {
    const { payload, info } = validatePayload(input, "shutdown");
    const bot = await findBotForPayload(info);
    if (!bot) {
        logActionResult(info, "nao_encontrado");
        return { ...info, message: "Bot nao encontrado para essa accessKey", result: "nao_encontrado" };
    }
    if (bot.status !== "offline") {
        await BotManager_1.botManager.stopBot(bot.userId, bot.clientId);
    }
    await (0, userBotStore_1.updateUserBot)(bot.userId, bot.clientId, {
        status: "offline",
        planStatus: "overdue",
        planExpiresAt: new Date().toISOString(),
        hostingAccessGranted: false,
        projectName: payload.hosting?.projectName || bot.projectName,
        hostingAccessKey: info.accessKey || bot.hostingAccessKey
    });
    logActionResult(info, "desligado");
    return { ...info, clientId: bot.clientId, message: "Bot desligado com sucesso", result: "desligado", botStatus: "offline" };
}
async function restoreHostingFromPayload(input) {
    const { payload, info } = validatePayload(input, "restore");
    const bot = await findBotForPayload(info);
    if (!bot) {
        logActionResult(info, "nao_encontrado");
        return { ...info, message: "Bot nao encontrado para essa accessKey", result: "nao_encontrado" };
    }
    const planExpiresAt = resolveRestoreExpiration(payload, bot);
    const paidAt = parseDate(payload.sentAt)?.toISOString() || new Date().toISOString();
    await (0, userBotStore_1.updateUserBot)(bot.userId, bot.clientId, {
        planStatus: "active",
        planExpiresAt,
        lastPaymentAt: paidAt,
        hostingAccessGranted: true,
        projectName: payload.hosting?.projectName || bot.projectName,
        hostingAccessKey: info.accessKey || bot.hostingAccessKey
    });
    const botStatus = bot.encryptedToken
        ? await BotManager_1.botManager.restartBot(bot.userId, bot.clientId)
        : "offline";
    if (!bot.encryptedToken) {
        await (0, userBotStore_1.updateUserBot)(bot.userId, bot.clientId, { status: "offline" });
    }
    logActionResult(info, "religado");
    return { ...info, clientId: bot.clientId, message: "Bot religado com sucesso", result: "religado", botStatus };
}
async function processHostingEventPayload(input) {
    const { kind } = validatePayload(input);
    return kind === "restore"
        ? restoreHostingFromPayload(input)
        : shutdownHostingFromPayload(input);
}
async function processPendingHostingShutdownEvents(limit = 25) {
    const collection = getEventsCollection();
    let processedCount = 0;
    for (let index = 0; index < limit; index += 1) {
        const now = new Date().toISOString();
        const event = await collection.findOneAndUpdate({
            status: "pending",
            $or: [
                { "payload.event": "hosting.payment_overdue.shutdown" },
                { "payload.event": "hosting.payment_confirmed.restore" },
                { "payload.action.type": "shutdown_client_hosting" },
                { "payload.action.type": "restore_client_hosting" },
                { "payload.action.type": "overdue" },
                { "payload.action.type": "expired" },
                { "payload.action.type": "vencido" },
                { "payload.action.type": "payment_confirmed" },
                { "payload.hosting.status": "overdue" },
                { "payload.hosting.status": "expired" },
                { "payload.hosting.status": "vencido" },
                { "payload.hosting.status": "active" },
                { "payload.hosting.status": "ativo" },
                { "payload.hosting.paymentStatus": "overdue" },
                { "payload.hosting.paymentStatus": "expired" },
                { "payload.hosting.paymentStatus": "vencido" },
                { "payload.hosting.paymentStatus": "paid" },
                { "payload.hosting.paymentStatus": "pago" },
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
        const result = await processHostingEventPayload(payload);
        if (result.result === "nao_encontrado") {
            throw new Error(result.message);
        }
        const now = new Date().toISOString();
        await collection.updateOne({ _id: event._id }, {
            $set: {
                status: "processed",
                processedAt: now,
                updatedAt: now,
                processingError: null
            }
        });
        console.log(`[hosting-event] processed eventId=${event.eventId} cliente=${result.client} projeto=${result.projectName} accessKey=${result.accessKey} acao=${result.actionType || result.result} resultado=${result.message}`);
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
        logActionResult(info, "erro", message);
        console.error(`[hosting-event] failed eventId=${event.eventId} cliente=${info.client} projeto=${info.projectName} accessKey=${info.accessKey} vencimento=${info.dueAt} erro=${message}`);
    }
}
