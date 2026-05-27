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

async function responsePreview(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.slice(0, 500);
}

export async function notifyMainBotBotRegistered(bot: LocalUserBot, status: string): Promise<void> {
  if (!apiConfig.orvitekMainBotNotifyUrl) {
    console.warn(`[orvitek-main-notify] pulada: ORVITEK_MAIN_BOT_NOTIFY_URL vazia clientId=${bot.clientId}`);
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
      signal: AbortSignal.timeout(10000),
      headers: {
        "content-type": "application/json",
        ...(apiConfig.orvitekMainBotNotifyToken
          ? { authorization: `Bearer ${apiConfig.orvitekMainBotNotifyToken}` }
          : {})
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error(`Notificacao ao bot principal falhou: HTTP ${response.status} body=${await responsePreview(response)}`);
      return;
    }

    console.log(`[orvitek-main-notify] bot cadastrado notificado clientId=${bot.clientId} status=${status}`);
  } catch (error) {
    console.error("Nao foi possivel notificar o bot principal:", error instanceof Error ? error.message : error);
  }
}
