import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { apiConfig, assertSnowflake } from "../config";
import { encryptToken } from "../security/tokenCrypto";
import { botManager } from "../services/BotManager";
import { validateBotToken } from "../services/discordToken";
import { notifyMainBotBotRegistered } from "../services/OrvitekMainBotNotifier";
import { findUserBotByClientId, listAllUserBots, listOverdueUserBots, updateUserBotByClientId, upsertUserBot } from "../storage/userBotStore";

const router = Router();
const planPriceCents = 1200;
const defaultPlanDays = 30;

const renewSchema = z.object({
  days: z.number().int().positive().max(365).optional(),
  amountCents: z.number().int().positive().optional()
});

const syncSchema = z.object({
  userId: z.string().trim(),
  guildId: z.string().trim(),
  targetUserId: z.string().trim(),
  clientId: z.string().trim(),
  hostingAccessKey: z.string().trim().optional(),
  hostingAccessGranted: z.boolean().optional(),
  projectName: z.string().trim().optional(),
  hosting: z.object({
    accessKey: z.string().trim().optional(),
    projectName: z.string().trim().optional()
  }).optional(),
  botToken: z.string().min(20).optional(),
  planStatus: z.enum(["active", "overdue"]).optional(),
  planStartedAt: z.string().datetime().optional(),
  planExpiresAt: z.string().datetime(),
  lastPaymentAmountCents: z.number().int().positive().optional(),
  lastPaymentAt: z.string().datetime().optional()
});

function requireOrvitek(req: Request, res: Response, next: NextFunction): void {
  if (!apiConfig.orvitekApiKey) {
    res.status(503).json({ success: false, message: "ORVITEK_API_KEY nao configurada na API de hospedagem" });
    return;
  }

  if (req.header("x-orvitek-api-key") !== apiConfig.orvitekApiKey) {
    res.status(401).json({ success: false, message: "Chave da Orvitek invalida" });
    return;
  }

  next();
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isOverdue(planExpiresAt?: string): boolean {
  return Boolean(planExpiresAt && new Date(planExpiresAt).getTime() <= Date.now());
}

function publicPlan(bot: Awaited<ReturnType<typeof findUserBotByClientId>>) {
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
  const overdueBots = await listOverdueUserBots();
  const expired = [];

  for (const bot of overdueBots) {
    await botManager.stopBot(bot.userId, bot.clientId);
    const updated = await updateUserBotByClientId(bot.clientId, {
      planStatus: "overdue",
      status: "offline"
    });

    expired.push(publicPlan(updated));
  }

  return expired.filter(Boolean);
}

router.use(requireOrvitek);

router.get("/", async (_req, res) => {
  const bots = await listAllUserBots();
  res.json({
    success: true,
    plans: bots.map((bot) => publicPlan(bot))
  });
});

router.get("/overdue", async (_req, res) => {
  const bots = await listOverdueUserBots();
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

router.post("/sync-client", async (req, res) => {
  const parsed = syncSchema.safeParse(req.body || {});

  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Dados invalidos" });
    return;
  }

  const {
    userId,
    guildId,
    targetUserId,
    clientId,
    hosting,
    hostingAccessKey,
    hostingAccessGranted,
    projectName,
    botToken,
    planStartedAt,
    planExpiresAt,
    lastPaymentAmountCents,
    lastPaymentAt
  } = parsed.data;

  try {
    assertSnowflake(userId, "userId");
    assertSnowflake(guildId, "guildId");
    assertSnowflake(targetUserId, "targetUserId");
    assertSnowflake(clientId, "clientId");
  } catch {
    res.status(400).json({ success: false, message: "IDs invalidos" });
    return;
  }

  const existing = await findUserBotByClientId(clientId);

  try {
    const discordUser = botToken ? await validateBotToken(botToken) : null;

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

    const saved = await upsertUserBot({
      userId,
      guildId,
      targetUserId,
      clientId,
      hostingAccessKey: resolvedAccessKey,
      hostingAccessGranted: resolvedAccessGranted,
      projectName: resolvedProjectName,
      encryptedToken: botToken ? encryptToken(botToken) : existing?.encryptedToken,
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
      await botManager.stopBot(userId, clientId);
      botStatus = "offline";
    } else if (!saved.encryptedToken) {
      botStatus = "offline";
    } else {
      botStatus = await botManager.restartBot(userId, clientId);
    }

    if (!existing) {
      notifyMainBotBotRegistered(saved, botStatus);
    }

    res.json({
      success: true,
      message: "Cliente sincronizado pela Orvitek",
      botStatus,
      plan: publicPlan({ ...saved, status: botStatus })
    });
  } catch {
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
    assertSnowflake(clientId, "clientId");
  } catch {
    res.status(400).json({ success: false, message: "Client ID invalido" });
    return;
  }

  const existing = await findUserBotByClientId(clientId);
  if (!existing) {
    res.status(404).json({ success: false, message: "Bot do cliente nao encontrado" });
    return;
  }

  const now = new Date();
  const currentExpiration = existing.planExpiresAt ? new Date(existing.planExpiresAt) : now;
  const startsFrom = currentExpiration.getTime() > now.getTime() ? currentExpiration : now;
  const planExpiresAt = addDays(startsFrom, parsed.data.days || defaultPlanDays).toISOString();

  const updated = await updateUserBotByClientId(clientId, {
    planStatus: "active",
    planStartedAt: existing.planStartedAt || now.toISOString(),
    planExpiresAt,
    lastPaymentAmountCents: parsed.data.amountCents || planPriceCents,
    lastPaymentAt: now.toISOString()
  });

  const status = await botManager.startBot(existing.userId, clientId);

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
    assertSnowflake(clientId, "clientId");
  } catch {
    res.status(400).json({ success: false, message: "Client ID invalido" });
    return;
  }

  const existing = await findUserBotByClientId(clientId);
  if (!existing) {
    res.status(404).json({ success: false, message: "Bot do cliente nao encontrado" });
    return;
  }

  await botManager.stopBot(existing.userId, clientId);
  const updated = await updateUserBotByClientId(clientId, {
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

export { expireOverdueBots, router as hostingPlansRouter };
