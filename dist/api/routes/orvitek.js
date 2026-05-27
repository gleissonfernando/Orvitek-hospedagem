"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orvitekRouter = void 0;
const express_1 = require("express");
const config_1 = require("../config");
const FiveMFacTokenStore_1 = require("../services/FiveMFacTokenStore");
const HostingShutdownProcessor_1 = require("../services/HostingShutdownProcessor");
const router = (0, express_1.Router)();
exports.orvitekRouter = router;
function isAuthorized(authorization) {
    if (!config_1.apiConfig.orvitekHostingBotToken) {
        return false;
    }
    return authorization === `Bearer ${config_1.apiConfig.orvitekHostingBotToken}`;
}
function debug(scope, message) {
    if (config_1.apiConfig.orvitekHostingBotDebug) {
        console.log(`[orvitek/${scope}] ${message}`);
    }
}
function requireInternalAuth(req, res, scope) {
    if (isAuthorized(req.header("authorization"))) {
        debug(scope, "token validado");
        return true;
    }
    debug(scope, "token ausente ou invalido");
    res.status(401).json({
        ok: false,
        message: "Nao autorizado"
    });
    return false;
}
async function handleHostingAction(req, res, action) {
    debug(action, "POST recebido do bot principal");
    if (!requireInternalAuth(req, res, action)) {
        return;
    }
    debug(action, `eventId=${req.body?.eventId || "sem_eventId"} accessKey=${req.body?.hosting?.accessKey || "sem_accessKey"} action=${req.body?.action?.type || "sem_action"}`);
    try {
        const result = action === "desligar"
            ? await (0, HostingShutdownProcessor_1.shutdownHostingFromPayload)(req.body || {})
            : await (0, HostingShutdownProcessor_1.restoreHostingFromPayload)(req.body || {});
        if (result.result === "nao_encontrado") {
            res.status(404).json({
                ok: false,
                message: result.message,
                eventId: result.eventId,
                accessKey: result.accessKey
            });
            return;
        }
        res.json({
            ok: true,
            message: result.message,
            eventId: result.eventId,
            accessKey: result.accessKey,
            clientId: result.clientId,
            botStatus: result.botStatus
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        const statusCode = (0, HostingShutdownProcessor_1.isHostingPayloadValidationError)(error) ? 400 : 500;
        console.log(`[orvitek/${action}] eventId=${req.body?.eventId || "sem_eventId"} userId=${req.body?.client?.userId || "sem_userId"} projectName=${req.body?.hosting?.projectName || "sem_projectName"} accessKey=${req.body?.hosting?.accessKey || "sem_accessKey"} action=${req.body?.action?.type || "sem_action"} resultado=erro error=${message}`);
        res.status(statusCode).json({
            ok: false,
            message: statusCode === 400 ? "Payload invalido" : `Erro ao ${action} bot`,
            error: message
        });
    }
}
async function handleActivationCodeCreate(req, res) {
    const scope = req.path.includes("fivem-fac-token") ? "fivem-fac-token" : "activation-code";
    if (!requireInternalAuth(req, res, scope)) {
        return;
    }
    const guildId = String(req.body?.guildId || "").trim();
    const token = String(req.body?.token || "").trim();
    const createdBy = String(req.body?.createdBy || "orvitek-main-bot").trim();
    const userId = String(req.body?.userId || "").trim();
    if (!/^\d{17,20}$/.test(guildId)) {
        res.status(400).json({
            ok: false,
            message: "guildId invalido"
        });
        return;
    }
    if (userId && !/^\d{17,20}$/.test(userId)) {
        res.status(400).json({
            ok: false,
            message: "userId invalido"
        });
        return;
    }
    if (!/^\d{4}$/.test(token)) {
        res.status(400).json({
            ok: false,
            message: "token precisa ter exatamente 4 digitos"
        });
        return;
    }
    if (!createdBy) {
        res.status(400).json({
            ok: false,
            message: "createdBy invalido"
        });
        return;
    }
    try {
        const result = (0, FiveMFacTokenStore_1.createFiveMFacToken)({ guildId, token, createdBy, userId: userId || null });
        console.log(`[orvitek/${scope}] codigo ${result.created ? "criado" : "ja existente"} como available guildId=${guildId} userId=${userId || "n/a"} createdBy=${createdBy}`);
        res.status(result.created ? 201 : 200).json({
            ok: true,
            status: result.record.status,
            guildId,
            created: result.created
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Nao foi possivel registrar o token";
        const statusCode = error instanceof FiveMFacTokenStore_1.FiveMFacTokenConflictError ? 409 : 500;
        console.log(`[orvitek/${scope}] falha ao criar codigo guildId=${guildId} userId=${userId || "n/a"} error=${message}`);
        res.status(statusCode).json({
            ok: false,
            message
        });
    }
}
router.post("/desligar", (req, res) => {
    handleHostingAction(req, res, "desligar");
});
router.post("/religar", (req, res) => {
    handleHostingAction(req, res, "religar");
});
router.post("/fivem-fac-token", handleActivationCodeCreate);
router.post("/activation-code", handleActivationCodeCreate);
