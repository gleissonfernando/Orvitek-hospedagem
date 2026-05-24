import { Router } from "express";
import { z } from "zod";
import { assertSnowflake } from "../config";
import { requireUser } from "../middleware/auth";
import { encryptToken } from "../security/tokenCrypto";
import { botManager } from "../services/BotManager";
import { validateBotToken } from "../services/discordToken";
import { notifyMainBotBotRegistered } from "../services/OrvitekMainBotNotifier";
import { checkHostingRegistrationPermission } from "../services/HostingRegistrationPermission";
import { deleteUserBot, findUserBot, listUserBots, updateUserBot, upsertUserBot, type LocalUserBot } from "../storage/userBotStore";

const router = Router();

const connectSchema = z.object({
  guildId: z.string().trim(),
  targetUserId: z.string().trim(),
  clientId: z.string().trim(),
  hostingAccessKey: z.string().trim().optional(),
  botToken: z.string().min(20)
});

const updateTokenSchema = z.object({
  clientId: z.string().trim(),
  botToken: z.string().min(20)
});

function publicBot(bot: {
  clientId: string;
  guildId: string;
  targetUserId: string;
  status: string;
  hostingAccessKey?: string;
  hostingAccessGranted?: boolean;
  projectName?: string;
  botUsername?: string;
  botId?: string;
  planStatus?: string;
  planExpiresAt?: string;
  lastPaymentAmountCents?: number;
  lastPaymentAt?: string;
}) {
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

async function hasPaidActiveAccess(bot: LocalUserBot | null, providedAccessKey?: string): Promise<{ allowed: boolean; accessKey?: string }> {
  const accessKey = providedAccessKey || bot?.hostingAccessKey;

  if (!accessKey) {
    return { allowed: false };
  }

  const permission = await checkHostingRegistrationPermission(accessKey);
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

router.use(requireUser);

router.post("/connect", async (req, res) => {
  const parsed = connectSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Dados invalidos" });
    return;
  }

  const { guildId, targetUserId, clientId, hostingAccessKey, botToken } = parsed.data;

  try {
    assertSnowflake(guildId, "guildId");
    assertSnowflake(targetUserId, "targetUserId");
    assertSnowflake(clientId, "clientId");
  } catch {
    res.status(400).json({ success: false, message: "Dados invalidos" });
    return;
  }

  try {
    const authorized = await findUserBot(req.userId, clientId);
    const access = await hasPaidActiveAccess(authorized, hostingAccessKey);

    if (!access.allowed) {
      res.status(403).json({
        success: false,
        message: "Pagamento não confirmado ou chave não liberada pela Orvitek."
      });
      return;
    }

    const discordUser = await validateBotToken(botToken);

    if (discordUser.id !== clientId) {
      res.status(400).json({ success: false, message: "Token invalido ou bot inacessivel" });
      return;
    }

    const encryptedToken = encryptToken(botToken);

    const saved = await upsertUserBot({
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

    const status = await botManager.restartBot(req.userId, clientId);

    if (status !== "online") {
      await deleteUserBot(req.userId, clientId);
      res.status(400).json({ success: false, message: "Token invalido ou bot inacessivel" });
      return;
    }

    notifyMainBotBotRegistered(saved, status);

    res.json({
      success: true,
      message: "Bot conectado com sucesso",
      bot: { clientId, guildId, targetUserId, status }
    });
  } catch (error) {
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
    assertSnowflake(clientId, "clientId");
  } catch {
    res.status(400).json({ success: false, message: "Dados invalidos" });
    return;
  }

  try {
    const existing = await findUserBot(req.userId, clientId);
    if (!existing) {
      res.status(404).json({ success: false, message: "Bot nao encontrado" });
      return;
    }

    const discordUser = await validateBotToken(botToken);
    if (discordUser.id !== clientId) {
      res.status(400).json({ success: false, message: "Token invalido ou bot inacessivel" });
      return;
    }

    const previousEncryptedToken = existing.encryptedToken;
    const previousBotUsername = existing.botUsername;
    const previousBotId = existing.botId;
    const previousStatus = existing.status;

    await updateUserBot(req.userId, clientId, {
      encryptedToken: encryptToken(botToken),
      botUsername: discordUser.username,
      botId: discordUser.id,
      status: "offline"
    });

    const status = await botManager.restartBot(req.userId, clientId);

    if (status !== "online") {
      await updateUserBot(req.userId, clientId, {
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
  } catch {
    res.status(400).json({ success: false, message: "Token invalido ou bot inacessivel" });
  }
});

router.delete("/:clientId/token", async (req, res) => {
  const { clientId } = req.params;

  try {
    assertSnowflake(clientId, "clientId");
    await botManager.stopBot(req.userId, clientId);
    await deleteUserBot(req.userId, clientId);

    res.json({ success: true, message: "Token removido com sucesso" });
  } catch {
    res.status(400).json({ success: false, message: "Dados invalidos" });
  }
});

router.get("/", async (req, res) => {
  const bots = await listUserBots(req.userId);

  res.json({
    success: true,
    bots: bots.map((bot) => publicBot({
      clientId: bot.clientId,
      guildId: bot.guildId,
      targetUserId: bot.targetUserId,
      status: botManager.getStatus(req.userId, bot.clientId) || bot.status,
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

export { router as userBotsRouter };
