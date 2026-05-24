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
        throw new Error("Token invalido ou bot inacessivel");
    }
    const user = (await response.json());
    if (!user.bot) {
        throw new Error("Token invalido ou bot inacessivel");
    }
    return user;
}
