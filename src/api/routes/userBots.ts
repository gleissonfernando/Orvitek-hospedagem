import { Router } from "express";
import { z } from "zod";
import { assertSnowflake } from "../config";
import { requireUser } from "../middleware/auth";
import { encryptToken } from "../security/tokenCrypto";
import { botManager } from "../services/BotManager";
import { validateBotToken } from "../services/discordToken";
import { notifyMainBotBotRegistered } from "../services/OrvitekMainBotNotifier";
import { checkHostingRegistrationPermission } from "../services/HostingRegistrationPermission";
import { checkFiveMFacToken, useFiveMFacToken } from "../services/FiveMFacTokenStore";
import { deleteUserBot, findUserBot, listUserBots, updateUserBot, upsertUserBot } from "../storage/userBotStore";

const router = Router();

const connectSchema = z.object({
  guildId: z.string().trim(),
  targetUserId: z.string().trim(),
  clientId: z.string().trim(),
  hostingAccessKey: z.string().trim().optional(),
  fivemFacToken: z.string().trim().regex(/^\d{4}$/).optional(),
  activationCode: z.string().trim().regex(/^\d{4}$/).optional(),
  botToken: z.string().min(20)
}).refine((data) => Boolean(data.activationCode || data.fivemFacToken), {
  message: "Codigo de ativacao obrigatorio",
  path: ["activationCode"]
});

const updateTokenSchema = z.object({
  clientId: z.string().trim(),
  botToken: z.string().min(20)
});

function inaccessibleBotMessage(guildId: string): string {
  return `Token validado, mas o bot nao conseguiu acessar o servidor ${guildId}. Convide esse bot no servidor informado com escopo bot/applications.commands e permissao Manage Messages.`;
}

async function restoreOrDeleteAttempt(userId: string, clientId: string, authorized: Awaited<ReturnType<typeof findUserBot>>): Promise<void> {
  if (!authorized) {
    await deleteUserBot(userId, clientId);
    return;
  }

  await updateUserBot(userId, clientId, {
    guildId: authorized.guildId,
    targetUserId: authorized.targetUserId,
    hostingAccessKey: authorized.hostingAccessKey,
    hostingAccessGranted: authorized.hostingAccessGranted,
    projectName: authorized.projectName,
    encryptedToken: authorized.encryptedToken,
    botUsername: authorized.botUsername,
    botId: authorized.botId,
    status: authorized.status,
    planStatus: authorized.planStatus,
    planStartedAt: authorized.planStartedAt,
    planExpiresAt: authorized.planExpiresAt,
    lastPaymentAmountCents: authorized.lastPaymentAmountCents,
    lastPaymentAt: authorized.lastPaymentAt
  });
}

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

async function hasPaidActiveAccess(providedAccessKey?: string): Promise<{ allowed: boolean; accessKey?: string }> {
  const accessKey = providedAccessKey;

  if (!accessKey) {
    console.log("[user-bots/connect] accessKey nao informada");
    return { allowed: false };
  }

  const permission = await checkHostingRegistrationPermission(accessKey);
  if (!permission.allowed) {
    return { allowed: false, accessKey };
  }

  return { allowed: true, accessKey };
}

router.use(requireUser);

router.post("/connect", async (req, res) => {
  const parsed = connectSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Dados invalidos" });
    return;
  }

  const { guildId, targetUserId, clientId, hostingAccessKey, botToken } = parsed.data;
  const activationCode = parsed.data.activationCode || parsed.data.fivemFacToken;

  if (!activationCode) {
    res.status(400).json({ success: false, message: "Codigo de ativacao obrigatorio" });
    return;
  }

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
    const access = await hasPaidActiveAccess(hostingAccessKey);

    if (!access.allowed) {
      res.status(403).json({
        success: false,
        message: "Pagamento não confirmado ou chave não liberada pela Orvitek."
      });
      return;
    }

    const facAvailability = checkFiveMFacToken({
      guildId,
      token: activationCode,
      userId: req.userId
    });

    if (!facAvailability.ok) {
      console.log(`[user-bots/connect] codigo de ativacao invalido/usado guildId=${guildId} userId=${req.userId} code=${activationCode} message=${facAvailability.message}`);
      res.status(400).json({ success: false, message: facAvailability.message });
      return;
    }

    const discordUser = await validateBotToken(botToken);

    if (discordUser.id !== clientId) {
      res.status(400).json({
        success: false,
        message: `O token pertence ao bot ${discordUser.id}, mas o Client ID informado foi ${clientId}.`
      });
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
      await restoreOrDeleteAttempt(req.userId, clientId, authorized);
      res.status(400).json({ success: false, message: inaccessibleBotMessage(guildId) });
      return;
    }

    const facActivation = useFiveMFacToken({
      guildId,
      token: activationCode,
      userId: req.userId
    });

    if (!facActivation.ok) {
      await botManager.stopBot(req.userId, clientId);
      await restoreOrDeleteAttempt(req.userId, clientId, authorized);
      console.log(`[user-bots/connect] codigo de ativacao invalido/usado guildId=${guildId} userId=${req.userId} code=${activationCode} message=${facActivation.message}`);
      res.status(400).json({ success: false, message: facActivation.message });
      return;
    }

    console.log(`[user-bots/connect] codigo de ativacao consumido com sucesso guildId=${guildId} userId=${req.userId} code=${activationCode}`);
    await botManager.restartBot(req.userId, clientId);
    notifyMainBotBotRegistered(saved, status);
    console.log(`[user-bots/connect] bot conectado com sucesso userId=${req.userId} clientId=${clientId} guildId=${guildId} accessKey=${access.accessKey}`);

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

    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Token invalido ou bot inacessivel" });
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
      res.status(400).json({
        success: false,
        message: `O token pertence ao bot ${discordUser.id}, mas o Client ID informado foi ${clientId}.`
      });
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
      res.status(400).json({ success: false, message: inaccessibleBotMessage(existing.guildId) });
      return;
    }

    res.json({
      success: true,
      message: "Token atualizado com sucesso",
      bot: { clientId, guildId: existing.guildId, targetUserId: existing.targetUserId, status }
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error instanceof Error ? error.message : "Token invalido ou bot inacessivel" });
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
