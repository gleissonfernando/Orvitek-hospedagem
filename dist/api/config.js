"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiConfig = void 0;
exports.getApiIntegrationStatus = getApiIntegrationStatus;
exports.logApiIntegrationStatus = logApiIntegrationStatus;
exports.assertSnowflake = assertSnowflake;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const snowflakeRegex = /^\d{17,20}$/;
const defaultApiUrl = `http://localhost:${process.env.API_PORT || 3000}`;
const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required env var: ${name}`);
    }
    return value;
}
function trimTrailingSlash(value) {
    return value.replace(/\/+$/, "");
}
function optionalEnv(name) {
    return (process.env[name] || "").trim();
}
function parseUrl(value) {
    try {
        return new URL(value);
    }
    catch {
        return null;
    }
}
function isLocalUrl(value) {
    const parsed = parseUrl(value);
    return Boolean(parsed && localHosts.has(parsed.hostname));
}
function publicUrlInfo(value) {
    const parsed = parseUrl(value);
    return {
        configured: Boolean(value),
        valid: Boolean(parsed),
        host: parsed?.host || "",
        isLocal: Boolean(value && isLocalUrl(value))
    };
}
const publicApiUrl = trimTrailingSlash(optionalEnv("API_PUBLIC_URL") || optionalEnv("HOSTING_BOT_API_URL") || defaultApiUrl);
const hostingBotApiUrl = trimTrailingSlash(optionalEnv("HOSTING_BOT_API_URL") || publicApiUrl);
exports.apiConfig = {
    port: Number(process.env.API_PORT || 3000),
    mongoUri: process.env.MONGODB_URI || "",
    mongoDbName: process.env.MONGODB_DB_NAME || "orvitek",
    hostingEventsCollection: process.env.MONGODB_HOSTING_EVENTS_COLLECTION || "hosting_shutdown_events",
    hostingRegistrationPermissionsCollection: process.env.MONGODB_HOSTING_PERMISSIONS_COLLECTION || process.env.MONGODB_HOSTING_REGISTRATION_PERMISSIONS_COLLECTION || "hosting_registration_permissions",
    encryptionKey: requireEnv("BOT_TOKEN_ENCRYPTION_KEY"),
    publicApiUrl,
    hostingBotApiUrl,
    orvitekApiKey: process.env.ORVITEK_API_KEY || "",
    orvitekHostingBotUrl: trimTrailingSlash(optionalEnv("ORVITEK_HOSTING_BOT_URL") || `${hostingBotApiUrl}/api/orvitek/desligar`),
    orvitekHostingBotToken: optionalEnv("ORVITEK_HOSTING_BOT_TOKEN"),
    orvitekHostingBotDebug: process.env.ORVITEK_HOSTING_BOT_DEBUG === "true",
    orvitekMainBotNotifyUrl: optionalEnv("ORVITEK_MAIN_BOT_NOTIFY_URL"),
    orvitekMainBotNotifyToken: optionalEnv("ORVITEK_MAIN_BOT_NOTIFY_TOKEN"),
    corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
    hostedBotsEnableMemberEvents: process.env.HOSTED_BOTS_ENABLE_MEMBER_EVENTS === "true" || process.env.ENABLE_MEMBER_EVENTS === "true",
    enableDevMockBots: process.env.ENABLE_DEV_MOCK_BOTS === "true",
    nodeEnv: process.env.NODE_ENV || "development"
};
function getApiIntegrationStatus() {
    const warnings = [];
    const publicApi = publicUrlInfo(exports.apiConfig.publicApiUrl);
    const hostingBotApi = publicUrlInfo(exports.apiConfig.hostingBotApiUrl);
    const incomingWebhook = publicUrlInfo(exports.apiConfig.orvitekHostingBotUrl);
    const mainBotNotify = publicUrlInfo(exports.apiConfig.orvitekMainBotNotifyUrl);
    if (!publicApi.valid) {
        warnings.push("API_PUBLIC_URL/HOSTING_BOT_API_URL invalida.");
    }
    else if (publicApi.isLocal) {
        warnings.push("API_PUBLIC_URL/HOSTING_BOT_API_URL aponta para localhost; o Orvitek Vendas externo nao consegue chamar essa API hospedada.");
    }
    if (!hostingBotApi.valid) {
        warnings.push("HOSTING_BOT_API_URL invalida.");
    }
    else if (hostingBotApi.isLocal) {
        warnings.push("HOSTING_BOT_API_URL aponta para localhost; configure a URL publica HTTPS da hospedagem.");
    }
    if (!exports.apiConfig.orvitekApiKey) {
        warnings.push("ORVITEK_API_KEY vazia; /api/hosting-plans vai responder 503.");
    }
    if (!exports.apiConfig.orvitekHostingBotToken) {
        warnings.push("ORVITEK_HOSTING_BOT_TOKEN vazio; /api/orvitek/desligar, /api/orvitek/religar e /api/orvitek/fivem-fac-token vao negar o bot de vendas.");
    }
    if (!exports.apiConfig.orvitekMainBotNotifyUrl) {
        warnings.push("ORVITEK_MAIN_BOT_NOTIFY_URL vazia; a API nao vai avisar o bot de vendas quando cadastrar bot.");
    }
    else if (!mainBotNotify.valid) {
        warnings.push("ORVITEK_MAIN_BOT_NOTIFY_URL invalida.");
    }
    else if (mainBotNotify.isLocal) {
        warnings.push("ORVITEK_MAIN_BOT_NOTIFY_URL aponta para localhost; a API hospedada nao consegue chamar o bot de vendas fora da mesma maquina.");
    }
    if (exports.apiConfig.orvitekMainBotNotifyUrl && !exports.apiConfig.orvitekMainBotNotifyToken) {
        warnings.push("ORVITEK_MAIN_BOT_NOTIFY_TOKEN vazio; o bot de vendas pode recusar a notificacao.");
    }
    return {
        publicApi,
        hostingBotApi,
        incomingSalesBot: {
            hostingPlansApiKeyConfigured: Boolean(exports.apiConfig.orvitekApiKey),
            webhookTokenConfigured: Boolean(exports.apiConfig.orvitekHostingBotToken),
            webhookUrl: incomingWebhook,
            hostingPlansPath: "/api/hosting-plans/sync-client",
            shutdownPath: "/api/orvitek/desligar",
            restorePath: "/api/orvitek/religar",
            activationCodePath: "/api/orvitek/fivem-fac-token"
        },
        outgoingSalesBotNotification: {
            configured: Boolean(exports.apiConfig.orvitekMainBotNotifyUrl),
            url: mainBotNotify,
            tokenConfigured: Boolean(exports.apiConfig.orvitekMainBotNotifyToken)
        },
        warnings
    };
}
function logApiIntegrationStatus() {
    const status = getApiIntegrationStatus();
    console.log(`[config] API publica: ${status.publicApi.host || "nao configurada"}`);
    console.log(`[config] Bot de vendas -> hospedagem: apiKey=${status.incomingSalesBot.hostingPlansApiKeyConfigured ? "ok" : "faltando"} webhookToken=${status.incomingSalesBot.webhookTokenConfigured ? "ok" : "faltando"}`);
    console.log(`[config] Hospedagem -> bot de vendas: notifyUrl=${status.outgoingSalesBotNotification.configured ? "ok" : "faltando"} notifyToken=${status.outgoingSalesBotNotification.tokenConfigured ? "ok" : "faltando"}`);
    for (const warning of status.warnings) {
        console.warn(`[config] ${warning}`);
    }
}
function assertSnowflake(value, label) {
    if (!snowflakeRegex.test(value)) {
        throw new Error(`${label} invalido`);
    }
}
