"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBotToken = validateBotToken;
async function validateBotToken(botToken) {
    const response = await fetch("https://discord.com/api/v10/users/@me", {
        headers: {
            Authorization: `Bot ${botToken}`
        }
    });
    if (!response.ok) {
        throw new Error(`Token recusado pelo Discord (HTTP ${response.status}). Confira se voce copiou o token do bot, sem "Bot " antes e sem espacos.`);
    }
    const user = (await response.json());
    if (!user.bot) {
        throw new Error("Esse token nao pertence a um bot do Discord.");
    }
    return user;
}
