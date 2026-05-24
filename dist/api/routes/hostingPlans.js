"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hostingPlansRouter = void 0;
exports.expireOverdueBots = expireOverdueBots;
const express_1 = require("express");
const zod_1 = require("zod");
const config_1 = require("../config");
const tokenCrypto_1 = require("../security/tokenCrypto");
const BotManager_1 = require("../services/BotManager");
const discordToken_1 = require("../services/discordToken");
const OrvitekMainBotNotifier_1 = require("../services/OrvitekMainBotNotifier");
const userBotStore_1 = require("../storage/userBotStore");
const router = (0, express_1.Router)();
exports.hostingPlansRouter = router;
const planPriceCents = 1200;
const defaultPlanDays = 30;
const renewSchema = zod_1.z.object({
    days: zod_1.z.number().int().positive().max(365).optional(),
    amountCents: zod_1.z.number().int().positive().optional()
});
const syncCommandsSchema = zod_1.z.object({
    clientId: zod_1.z.string().trim().optional()
});
const syncSchema = zod_1.z.object({
    userId: zod_1.z.string().trim(),
    guildId: zod_1.z.string().trim(),
    targetUserId: zod_1.z.string().trim(),
    clientId: zod_1.z.string().trim(),
    hostingAccessKey: zod_1.z.string().trim().optional(),
    hostingAccessGranted: zod_1.z.boolean().optional(),
    projectName: zod_1.z.string().trim().optional(),
    hosting: zod_1.z.object({
        accessKey: zod_1.z.string().trim().optional(),
        projectName: zod_1.z.string().trim().optional()
    }).optional(),
    botToken: zod_1.z.string().min(20).optional(),
    planStatus: zod_1.z.enum(["active", "overdue"]).optional(),
    planStartedAt: zod_1.z.string().datetime().optional(),
    planExpiresAt: zod_1.z.string().datetime(),
    lastPaymentAmountCents: zod_1.z.number().int().positive().optional(),
    lastPaymentAt: zod_1.z.string().datetime().optional()
});
function requireOrvitek(req, res, next) {
    if (!config_1.apiConfig.orvitekApiKey) {
        res.status(503).json({ success: false, message: "ORVITEK_API_KEY nao configurada na API de hospedagem" });
        return;
    }
    if (req.header("x-orvitek-api-key") !== config_1.apiConfig.orvitekApiKey) {
        res.status(401).json({ success: false, message: "Chave da Orvitek invalida" });
        return;
    }
    next();
}
function addDays(date, days) {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}
function isOverdue(planExpiresAt) {
    return Boolean(planExpiresAt && new Date(planExpiresAt).getTime() <= Date.now());
}
function publicPlan(bot) {
    if (!bot) {
        return null;
    }
    return {
        userId: bot.userId,
        guildId: bot.guildId,
        targetUserId: bot.targetUserId,
        clientId: bot.clientId,
        hostingAccessKey: bot.hostingAccessKey,
        projectName: bot.projectName,
        botUsername: bot.botUsername,
        status: bot.status,
        planStatus: isOverdue(bot.planExpiresAt) ? "overdue" : bot.planStatus || "active",
        planExpiresAt: bot.planExpiresAt,
        lastPaymentAmountCents: bot.lastPaymentAmountCents,
        lastPaymentAt: bot.lastPaymentAt
    };
}
async function expireOverdueBots() {
    const overdueBots = await (0, userBotStore_1.listOverdueUserBots)();
    const expired = [];
    for (const bot of overdueBots) {
        await BotManager_1.botManager.stopBot(bot.userId, bot.clientId);
        const updated = await (0, userBotStore_1.updateUserBotByClientId)(bot.clientId, {
            planStatus: "overdue",
            status: "offline"
        });
        expired.push(publicPlan(updated));
    }
    return expired.filter(Boolean);
}
router.use(requireOrvitek);
router.get("/", async (_req, res) => {
    const bots = await (0, userBotStore_1.listAllUserBots)();
    res.json({
        success: true,
        plans: bots.map((bot) => publicPlan(bot))
    });
});
router.get("/overdue", async (_req, res) => {
    const bots = await (0, userBotStore_1.listOverdueUserBots)();
    res.json({
        success: true,
        plans: bots.map((bot) => publicPlan(bot))
    });
});
router.post("/expire-overdue", async (_req, res) => {
    const expired = await expireOverdueBots();
    res.json({
        success: true,
        message: `${expired.length} bot(s) atrasado(s) desligado(s)`,
        plans: expired
    });
});
router.post("/sync-hierarchy-commands", async (req, res) => {
    const parsed = syncCommandsSchema.safeParse(req.body || {});
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "Dados invalidos" });
        return;
    }
    const { clientId } = parsed.data;
    if (clientId) {
        try {
            (0, config_1.assertSnowflake)(clientId, "clientId");
        }
        catch {
            res.status(400).json({ success: false, message: "Client ID invalido" });
            return;
        }
        const result = await BotManager_1.botManager.syncHierarchyCommandsByClientId(clientId);
        res.status(result.ok ? 200 : 400).json({
            success: result.ok,
            message: result.message,
            result
        });
        return;
    }
    const results = await BotManager_1.botManager.syncHierarchyCommandsForRegisteredBots();
    const synced = results.filter((result) => result.ok).length;
    res.json({
        success: true,
        message: `${synced}/${results.length} bot(s) com /herarquia sincronizado(s)`,
        results
    });
});
router.post("/sync-client", async (req, res) => {
    const parsed = syncSchema.safeParse(req.body || {});
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "Dados invalidos" });
        return;
    }
    const { userId, guildId, targetUserId, clientId, hosting, hostingAccessKey, hostingAccessGranted, projectName, botToken, planStartedAt, planExpiresAt, lastPaymentAmountCents, lastPaymentAt } = parsed.data;
    try {
        (0, config_1.assertSnowflake)(userId, "userId");
        (0, config_1.assertSnowflake)(guildId, "guildId");
        (0, config_1.assertSnowflake)(targetUserId, "targetUserId");
        (0, config_1.assertSnowflake)(clientId, "clientId");
    }
    catch {
        res.status(400).json({ success: false, message: "IDs invalidos" });
        return;
    }
    const existing = await (0, userBotStore_1.findUserBotByClientId)(clientId);
    try {
        const discordUser = botToken ? await (0, discordToken_1.validateBotToken)(botToken) : null;
        if (discordUser && discordUser.id !== clientId) {
            res.status(400).json({ success: false, message: "Token nao pertence ao clientId informado" });
            return;
        }
        const expired = isOverdue(planExpiresAt);
        const planStatus = expired ? "overdue" : parsed.data.planStatus || "active";
        const resolvedAccessKey = hosting?.accessKey || hostingAccessKey || existing?.hostingAccessKey;
        const resolvedPaymentAmountCents = lastPaymentAmountCents || existing?.lastPaymentAmountCents || planPriceCents;
        const resolvedPaymentAt = lastPaymentAt || existing?.lastPaymentAt;
        const resolvedAccessGranted = hostingAccessGranted ?? existing?.hostingAccessGranted ?? Boolean(!expired && resolvedPaymentAt && resolvedPaymentAmountCents > 0);
        const resolvedProjectName = hosting?.projectName || projectName || existing?.projectName;
        const saved = await (0, userBotStore_1.upsertUserBot)({
            userId,
            guildId,
            targetUserId,
            clientId,
            hostingAccessKey: resolvedAccessKey,
            hostingAccessGranted: resolvedAccessGranted,
            projectName: resolvedProjectName,
            encryptedToken: botToken ? (0, tokenCrypto_1.encryptToken)(botToken) : existing?.encryptedToken,
            botUsername: discordUser?.username || existing?.botUsername || clientId,
            botId: discordUser?.id || existing?.botId || clientId,
            status: expired ? "offline" : existing?.status || "offline",
            planStatus,
            planStartedAt: planStartedAt || existing?.planStartedAt || new Date().toISOString(),
            planExpiresAt,
            lastPaymentAmountCents: resolvedPaymentAmountCents,
            lastPaymentAt: resolvedPaymentAt
        });
        let botStatus = saved.status;
        if (expired || planStatus === "overdue") {
            await BotManager_1.botManager.stopBot(userId, clientId);
            botStatus = "offline";
        }
        else if (!saved.encryptedToken) {
            botStatus = "offline";
        }
        else {
            botStatus = await BotManager_1.botManager.restartBot(userId, clientId);
            await BotManager_1.botManager.syncHierarchyCommandsForBot(saved);
        }
        if (!existing) {
            (0, OrvitekMainBotNotifier_1.notifyMainBotBotRegistered)(saved, botStatus);
        }
        res.json({
            success: true,
            message: "Cliente sincronizado pela Orvitek",
            botStatus,
            plan: publicPlan({ ...saved, status: botStatus })
        });
    }
    catch {
        res.status(400).json({ success: false, message: "Token invalido ou bot inacessivel" });
    }
});
router.post("/:clientId/renew", async (req, res) => {
    const { clientId } = req.params;
    const parsed = renewSchema.safeParse(req.body || {});
    if (!parsed.success) {
        res.status(400).json({ success: false, message: "Dados invalidos" });
        return;
    }
    try {
        (0, config_1.assertSnowflake)(clientId, "clientId");
    }
    catch {
        res.status(400).json({ success: false, message: "Client ID invalido" });
        return;
    }
    const existing = await (0, userBotStore_1.findUserBotByClientId)(clientId);
    if (!existing) {
        res.status(404).json({ success: false, message: "Bot do cliente nao encontrado" });
        return;
    }
    const now = new Date();
    const currentExpiration = existing.planExpiresAt ? new Date(existing.planExpiresAt) : now;
    const startsFrom = currentExpiration.getTime() > now.getTime() ? currentExpiration : now;
    const planExpiresAt = addDays(startsFrom, parsed.data.days || defaultPlanDays).toISOString();
    const updated = await (0, userBotStore_1.updateUserBotByClientId)(clientId, {
        planStatus: "active",
        planStartedAt: existing.planStartedAt || now.toISOString(),
        planExpiresAt,
        lastPaymentAmountCents: parsed.data.amountCents || planPriceCents,
        lastPaymentAt: now.toISOString()
    });
    const status = await BotManager_1.botManager.startBot(existing.userId, clientId);
    await BotManager_1.botManager.syncHierarchyCommandsByClientId(clientId);
    res.json({
        success: true,
        message: `Plano renovado por ${parsed.data.days || defaultPlanDays} dias`,
        botStatus: status,
        plan: publicPlan(updated)
    });
});
router.post("/:clientId/suspend", async (req, res) => {
    const { clientId } = req.params;
    try {
        (0, config_1.assertSnowflake)(clientId, "clientId");
    }
    catch {
        res.status(400).json({ success: false, message: "Client ID invalido" });
        return;
    }
    const existing = await (0, userBotStore_1.findUserBotByClientId)(clientId);
    if (!existing) {
        res.status(404).json({ success: false, message: "Bot do cliente nao encontrado" });
        return;
    }
    await BotManager_1.botManager.stopBot(existing.userId, clientId);
    const updated = await (0, userBotStore_1.updateUserBotByClientId)(clientId, {
        planStatus: "overdue",
        planExpiresAt: new Date().toISOString(),
        status: "offline"
    });
    res.json({
        success: true,
        message: "Bot do cliente desligado por atraso no plano",
        plan: publicPlan(updated)
    });
});
