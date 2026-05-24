import { apiConfig } from "../config";
import type { LocalUserBot } from "../storage/userBotStore";

type BotRegisteredNotification = {
  source: "orvitek-hosting-bot";
  event: "hosting.bot_registered";
  occurredAt: string;
  bot: {
    userId: string;
    guildId: string;
    targetUserId: string;
    clientId: string;
    botUsername: string;
    botId: string;
    status: string;
    hostingAccessKey?: string;
    projectName?: string;
    planStatus?: string;
    planExpiresAt?: string;
  };
};

export async function notifyMainBotBotRegistered(bot: LocalUserBot, status: string): Promise<void> {
  if (!apiConfig.orvitekMainBotNotifyUrl) {
    return;
  }

  const payload: BotRegisteredNotification = {
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
    const response = await fetch(apiConfig.orvitekMainBotNotifyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiConfig.orvitekMainBotNotifyToken
          ? { authorization: `Bearer ${apiConfig.orvitekMainBotNotifyToken}` }
          : {})
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(`Notificacao ao bot principal falhou: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error("Nao foi possivel notificar o bot principal:", error instanceof Error ? error.message : error);
  }
}
