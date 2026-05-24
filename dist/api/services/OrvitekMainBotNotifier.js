"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyMainBotBotRegistered = notifyMainBotBotRegistered;
const config_1 = require("../config");
async function notifyMainBotBotRegistered(bot, status) {
    if (!config_1.apiConfig.orvitekMainBotNotifyUrl) {
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
            headers: {
                "content-type": "application/json",
                ...(config_1.apiConfig.orvitekMainBotNotifyToken
                    ? { authorization: `Bearer ${config_1.apiConfig.orvitekMainBotNotifyToken}` }
                    : {})
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            console.error(`Notificacao ao bot principal falhou: HTTP ${response.status}`);
        }
    }
    catch (error) {
        console.error("Nao foi possivel notificar o bot principal:", error instanceof Error ? error.message : error);
    }
}
