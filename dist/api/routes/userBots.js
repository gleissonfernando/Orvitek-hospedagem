"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userBotsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const config_1 = require("../config");
const auth_1 = require("../middleware/auth");
const tokenCrypto_1 = require("../security/tokenCrypto");
const BotManager_1 = require("../services/BotManager");
const discordToken_1 = require("../services/discordToken");
const OrvitekMainBotNotifier_1 = require("../services/OrvitekMainBotNotifier");
const HostingRegistrationPermission_1 = require("../services/HostingRegistrationPermission");
const userBotStore_1 = require("../storage/userBotStore");
const router = (0, express_1.Router)();
exports.userBotsRouter = router;
const connectSchema = zod_1.z.object({
    guildId: zod_1.z.string().trim(),
    targetUserId: zod_1.z.string().trim(),
    clientId: zod_1.z.string().trim(),
    hostingAccessKey: zod_1.z.string().trim().optional(),
    botToken: zod_1.z.string().min(20)
});
const updateTokenSchema = zod_1.z.object({
    clientId: zod_1.z.string().trim(),
    botToken: zod_1.z.string().min(20)
});
function publicBot(bot) {
    return {
        clientId: bot.clientId,
        guildId: bot.guildId,
        targetUserId: bot.targetUserId,
        status: bot.status,
        hostingAccessKey: bot.hostingAccessKey,
        hostingAccessGranted: bot.hostingAccessGranted,
        projectName: bot.projectName,
        botUsername: bot.botUsername,
        botId: bot.botId,
        planStatus: bot.planStatus,
        planExpiresAt: bot.planExpiresAt,
        lastPaymentAmountCents: bot.lastPaymentAmountCents,
        lastPaymentAt: bot.lastPaymentAt,
        token: "************"
    };
}
async function hasPaidActiveAccess(bot, providedAccessKey) {
    const accessKey = providedAccessKey || bot?.hostingAccessKey;
    if (!accessKey) {
        return { allowed: false };
    }
    const permission = await (0, HostingRegistrationPermission_1.checkHostingRegistrationPermission)(accessKey);
    if (!permission.allowed) {
        return { allowed: false, accessKey };
    }
    if (!bot) {
        return { allowed: true, accessKey };
    }
    const expiresAt = bot.planExpiresAt ? new Date(bot.planExpiresAt).getTime() : 0;
    const hasActivePlan = bot.planStatus === "active" && expiresAt > Date.now();
    const hasPayment = Boolean(bot.lastPaymentAt && bot.lastPaymentAmountCents && bot.lastPaymentAmountCents > 0);
    const releasedByOrvitek = bot.hostingAccessGranted === true || Boolean(bot.hostingAccessKey);
    const legacyActiveRegistration = Boolean(bot.encryptedToken && bot.status === "online" && bot.planStatus !== "overdue" && !bot.planExpiresAt);
    return { allowed: legacyActiveRegistration || (hasActivePlan && hasPayment && releasedByOrvitek), accessKey };
}
router.use(auth_1.requireUser);
router.post("/connect", async (req, res) => {
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "Dados invalidos" });
        return;
    }
    const { guildId, targetUserId, clientId, hostingAccessKey, botToken } = parsed.data;
    try {
        (0, config_1.assertSnowflake)(guildId, "guildId");
        (0, config_1.assertSnowflake)(targetUserId, "targetUserId");
        (0, config_1.assertSnowflake)(clientId, "clientId");
    }
    catch {
        res.status(400).json({ success: false, message: "Dados invalidos" });
        return;
    }
    try {
        const authorized = await (0, userBotStore_1.findUserBot)(req.userId, clientId);
        const access = await hasPaidActiveAccess(authorized, hostingAccessKey);
        if (!access.allowed) {
            res.status(403).json({
                success: false,
                message: "Pagamento não confirmado ou chave não liberada pela Orvitek."
            });
            return;
        }
        const discordUser = await (0, discordToken_1.validateBotToken)(botToken);
        if (discordUser.id !== clientId) {
            res.status(400).json({ success: false, message: "Token invalido ou bot inacessivel" });
            return;
        }
        const encryptedToken = (0, tokenCrypto_1.encryptToken)(botToken);
        const saved = await (0, userBotStore_1.upsertUserBot)({
            userId: req.userId,
            guildId,
            targetUserId,
            clientId,
            hostingAccessKey: access.accessKey || authorized?.hostingAccessKey,
            hostingAccessGranted: true,
            projectName: authorized?.projectName,
            encryptedToken,
            botUsername: discordUser.username,
            botId: discordUser.id,
            status: "offline",
            planStatus: authorized?.planStatus || "active",
            planStartedAt: authorized?.planStartedAt || new Date().toISOString(),
            planExpiresAt: authorized?.planExpiresAt,
            lastPaymentAmountCents: authorized?.lastPaymentAmountCents,
            lastPaymentAt: authorized?.lastPaymentAt || new Date().toISOString()
        });
        const status = await BotManager_1.botManager.restartBot(req.userId, clientId);
        if (status !== "online") {
            await (0, userBotStore_1.deleteUserBot)(req.userId, clientId);
            res.status(400).json({ success: false, message: "Token invalido ou bot inacessivel" });
            return;
        }
        (0, OrvitekMainBotNotifier_1.notifyMainBotBotRegistered)(saved, status);
        res.json({
            success: true,
            message: "Bot conectado com sucesso",
            bot: { clientId, guildId, targetUserId, status }
        });
    }
    catch (error) {
        if (error instanceof Error && error.message.includes("MongoDB")) {
            res.status(503).json({ success: false, message: "Pagamento não confirmado ou chave não liberada pela Orvitek." });
            return;
        }
        res.status(400).json({ success: false, message: "Token invalido ou bot inacessivel" });
    }
});
router.post("/update-token", async (req, res) => {
    const parsed = updateTokenSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "Dados invalidos" });
        return;
    }
    const { clientId, botToken } = parsed.data;
    try {
        (0, config_1.assertSnowflake)(clientId, "clientId");
    }
    catch {
        res.status(400).json({ success: false, message: "Dados invalidos" });
        return;
    }
    try {
        const existing = await (0, userBotStore_1.findUserBot)(req.userId, clientId);
        if (!existing) {
            res.status(404).json({ success: false, message: "Bot nao encontrado" });
            return;
        }
        const discordUser = await (0, discordToken_1.validateBotToken)(botToken);
        if (discordUser.id !== clientId) {
            res.status(400).json({ success: false, message: "Token invalido ou bot inacessivel" });
            return;
        }
        const previousEncryptedToken = existing.encryptedToken;
        const previousBotUsername = existing.botUsername;
        const previousBotId = existing.botId;
        const previousStatus = existing.status;
        await (0, userBotStore_1.updateUserBot)(req.userId, clientId, {
            encryptedToken: (0, tokenCrypto_1.encryptToken)(botToken),
            botUsername: discordUser.username,
            botId: discordUser.id,
            status: "offline"
        });
        const status = await BotManager_1.botManager.restartBot(req.userId, clientId);
        if (status !== "online") {
            await (0, userBotStore_1.updateUserBot)(req.userId, clientId, {
                encryptedToken: previousEncryptedToken,
                botUsername: previousBotUsername,
                botId: previousBotId,
                status: previousStatus
            });
            res.status(400).json({ success: false, message: "Token invalido ou bot inacessivel" });
            return;
        }
        res.json({
            success: true,
            message: "Token atualizado com sucesso",
            bot: { clientId, guildId: existing.guildId, targetUserId: existing.targetUserId, status }
        });
    }
    catch {
        res.status(400).json({ success: false, message: "Token invalido ou bot inacessivel" });
    }
});
router.delete("/:clientId/token", async (req, res) => {
    const { clientId } = req.params;
    try {
        (0, config_1.assertSnowflake)(clientId, "clientId");
        await BotManager_1.botManager.stopBot(req.userId, clientId);
        await (0, userBotStore_1.deleteUserBot)(req.userId, clientId);
        res.json({ success: true, message: "Token removido com sucesso" });
    }
    catch {
        res.status(400).json({ success: false, message: "Dados invalidos" });
    }
});
router.get("/", async (req, res) => {
    const bots = await (0, userBotStore_1.listUserBots)(req.userId);
    res.json({
        success: true,
        bots: bots.map((bot) => publicBot({
            clientId: bot.clientId,
            guildId: bot.guildId,
            targetUserId: bot.targetUserId,
            status: BotManager_1.botManager.getStatus(req.userId, bot.clientId) || bot.status,
            hostingAccessKey: bot.hostingAccessKey,
            hostingAccessGranted: bot.hostingAccessGranted,
            projectName: bot.projectName,
            botUsername: bot.botUsername,
            botId: bot.botId,
            planStatus: bot.planStatus,
            planExpiresAt: bot.planExpiresAt,
            lastPaymentAmountCents: bot.lastPaymentAmountCents,
            lastPaymentAt: bot.lastPaymentAt
        }))
    });
});
