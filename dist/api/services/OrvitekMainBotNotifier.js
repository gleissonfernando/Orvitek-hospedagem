"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyMainBotBotRegistered = notifyMainBotBotRegistered;
const config_1 = require("../config");
async function responsePreview(response) {
    const text = await response.text().catch(() => "");
    return text.slice(0, 500);
}
async function notifyMainBotBotRegistered(bot, status) {
    if (!config_1.apiConfig.orvitekMainBotNotifyUrl) {
        console.warn(`[orvitek-main-notify] pulada: ORVITEK_MAIN_BOT_NOTIFY_URL vazia clientId=${bot.clientId}`);
        return;
    }
    const payload = {
        source: "orvitek-hosting-bot",
        event: "hosting.bot_registered",
        occurredAt: new Date().toISOString(),
        bot: {
            userId: bot.userId,
            guildId: bot.guildId,
            targetUserId: bot.targetUserId,
            clientId: bot.clientId,
            botUsername: bot.botUsername,
            botId: bot.botId,
            status,
            hostingAccessKey: bot.hostingAccessKey,
            projectName: bot.projectName,
            planStatus: bot.planStatus,
            planExpiresAt: bot.planExpiresAt
        }
    };
    try {
        const response = await fetch(config_1.apiConfig.orvitekMainBotNotifyUrl, {
            method: "POST",
            signal: AbortSignal.timeout(10000),
            headers: {
                "content-type": "application/json",
                ...(config_1.apiConfig.orvitekMainBotNotifyToken
                    ? { authorization: `Bearer ${config_1.apiConfig.orvitekMainBotNotifyToken}` }
                    : {})
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            console.error(`Notificacao ao bot principal falhou: HTTP ${response.status} body=${await responsePreview(response)}`);
            return;
        }
        console.log(`[orvitek-main-notify] bot cadastrado notificado clientId=${bot.clientId} status=${status}`);
    }
    catch (error) {
        console.error("Nao foi possivel notificar o bot principal:", error instanceof Error ? error.message : error);
    }
}
