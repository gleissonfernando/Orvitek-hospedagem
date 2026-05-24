"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.devMockBotsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const config_1 = require("../config");
const auth_1 = require("../middleware/auth");
const tokenCrypto_1 = require("../security/tokenCrypto");
const userBotStore_1 = require("../storage/userBotStore");
const router = (0, express_1.Router)();
exports.devMockBotsRouter = router;
const mockSchema = zod_1.z.object({
    guildId: zod_1.z.string().trim(),
    targetUserId: zod_1.z.string().trim(),
    clientId: zod_1.z.string().trim()
});
router.use(auth_1.requireUser);
router.post("/mock-user-bot", async (req, res) => {
    if (config_1.apiConfig.nodeEnv === "production" || !config_1.apiConfig.enableDevMockBots) {
        res.status(404).json({ success: false, message: "Rota nao encontrada" });
        return;
    }
    const parsed = mockSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "Dados invalidos" });
        return;
    }
    const { guildId, targetUserId, clientId } = parsed.data;
    try {
        (0, config_1.assertSnowflake)(guildId, "guildId");
        (0, config_1.assertSnowflake)(targetUserId, "targetUserId");
        (0, config_1.assertSnowflake)(clientId, "clientId");
    }
    catch {
        res.status(400).json({ success: false, message: "Dados invalidos" });
        return;
    }
    await (0, userBotStore_1.upsertUserBot)({
        userId: req.userId,
        guildId,
        targetUserId,
        clientId,
        encryptedToken: (0, tokenCrypto_1.encryptToken)("TOKEN_FALSO_DE_DESENVOLVIMENTO"),
        botUsername: "bot-mock",
        botId: clientId,
        status: "offline"
    });
    res.json({
        success: true,
        message: "Bot mock cadastrado com sucesso",
        bot: {
            clientId,
            guildId,
            targetUserId,
            status: "offline"
        }
    });
});
