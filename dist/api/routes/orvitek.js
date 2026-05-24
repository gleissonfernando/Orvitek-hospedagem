"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orvitekRouter = void 0;
const express_1 = require("express");
const config_1 = require("../config");
const HostingShutdownProcessor_1 = require("../services/HostingShutdownProcessor");
const router = (0, express_1.Router)();
exports.orvitekRouter = router;
function isAuthorized(authorization) {
    if (!config_1.apiConfig.orvitekHostingBotToken) {
        return false;
    }
    return authorization === `Bearer ${config_1.apiConfig.orvitekHostingBotToken}`;
}
function debug(message) {
    if (config_1.apiConfig.orvitekHostingBotDebug) {
        console.log(`[orvitek/desligar] ${message}`);
    }
}
router.post("/desligar", async (req, res) => {
    debug("POST recebido do Orvitek Vendas");
    if (!isAuthorized(req.header("authorization"))) {
        debug("token invalido");
        res.status(401).json({
            ok: false,
            message: "Nao autorizado"
        });
        return;
    }
    debug("token validado");
    debug(`payload recebido=${JSON.stringify(req.body || {})}`);
    debug(`accessKey consultada=${req.body?.hosting?.accessKey || ""}`);
    try {
        const result = await (0, HostingShutdownProcessor_1.shutdownHostingFromPayload)(req.body || {});
        if (result.result === "nao_encontrado") {
            const body = {
                ok: false,
                message: "Bot não encontrado para essa accessKey",
                eventId: result.eventId,
                accessKey: result.accessKey
            };
            debug(`resposta enviada=${JSON.stringify(body)}`);
            res.status(404).json(body);
            return;
        }
        const body = {
            ok: true,
            message: "Bot desligado com sucesso",
            eventId: result.eventId,
            accessKey: result.accessKey
        };
        debug("bot desligado");
        debug(`resposta enviada=${JSON.stringify(body)}`);
        res.json(body);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        console.log(`[orvitek/desligar] eventId=${req.body?.eventId || "sem_eventId"} userId=${req.body?.client?.userId || "sem_userId"} projectName=${req.body?.hosting?.projectName || "sem_projectName"} accessKey=${req.body?.hosting?.accessKey || "sem_accessKey"} action=${req.body?.action?.type || "sem_action"} resultado=erro error=${message}`);
        const body = {
            ok: false,
            message: "Erro ao desligar bot",
            error: message
        };
        debug(`resposta enviada=${JSON.stringify(body)}`);
        res.status(500).json(body);
    }
});
