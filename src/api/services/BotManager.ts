import { Client, Events, GatewayIntentBits, PermissionFlagsBits } from "discord.js";
import { attachHierarchySystem, registerHierarchyCommands } from "./HierarchyManager";
import { decryptToken } from "../security/tokenCrypto";
import { findUserBot, findUserBotByClientId, listAllUserBots, listOnlineUserBots, listOverdueUserBots, updateUserBot, type LocalUserBot } from "../storage/userBotStore";

type BotStatus = "online" | "offline" | "error";

class BotManager {
  private clients = new Map<string, Client>();
  private statuses = new Map<string, BotStatus>();

  private key(userId: string, clientId: string): string {
    return `${userId}:${clientId}`;
  }

  async startBot(userId: string, clientId: string): Promise<BotStatus> {
    const key = this.key(userId, clientId);
    const existing = this.clients.get(key);

    if (existing?.isReady()) {
      return "online";
    }

    const userBot = await findUserBot(userId, clientId);
    if (!userBot) {
      return "offline";
    }

    if (userBot.planExpiresAt && new Date(userBot.planExpiresAt).getTime() <= Date.now()) {
      await updateUserBot(userId, clientId, { planStatus: "overdue", status: "offline" });
      this.statuses.set(key, "offline");
      return "offline";
    }

    if (!userBot.encryptedToken) {
      this.statuses.set(key, "offline");
      await updateUserBot(userId, clientId, { status: "offline" });
      return "offline";
    }

    const token = decryptToken(userBot.encryptedToken);
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers
      ]
    });

    attachHierarchySystem(client, clientId, userBot.guildId, token);

    client.once(Events.ClientReady, async () => {
      const guild = client.guilds.cache.get(userBot.guildId);
      const status: BotStatus = guild ? "online" : "error";
      this.statuses.set(key, status);
      await updateUserBot(userId, clientId, { status });
    });

    client.on(Events.Error, async () => {
      this.statuses.set(key, "error");
      await updateUserBot(userId, clientId, { status: "error" });
    });

    client.on(Events.MessageCreate, async (message) => {
      if (!message.guild || message.guild.id !== userBot.guildId) {
        return;
      }

      if (message.author.id !== userBot.targetUserId || message.author.id === client.user?.id) {
        return;
      }

      const botMember = message.guild.members.me;
      if (!botMember?.permissionsIn(message.channelId).has(PermissionFlagsBits.ManageMessages)) {
        return;
      }

      await message.delete().catch(() => undefined);
    });

    try {
      await client.login(token);

      if (client.user?.id !== clientId) {
        await client.destroy();
        this.clients.delete(key);
        this.statuses.set(key, "error");
        await updateUserBot(userId, clientId, { status: "error" });
        return "error";
      }

      const guild = await client.guilds.fetch(userBot.guildId).catch(() => null);
      if (!guild) {
        await client.destroy();
        this.clients.delete(key);
        this.statuses.set(key, "error");
        await updateUserBot(userId, clientId, { status: "error" });
        return "error";
      }

      this.clients.set(key, client);
      this.statuses.set(key, "online");
      await updateUserBot(userId, clientId, { status: "online" });
      return "online";
    } catch {
      this.clients.delete(key);
      this.statuses.set(key, "error");
      await updateUserBot(userId, clientId, { status: "error" });
      return "error";
    }
  }

  async stopBot(userId: string, clientId: string): Promise<void> {
    const key = this.key(userId, clientId);
    const client = this.clients.get(key);

    if (client) {
      await client.destroy();
      this.clients.delete(key);
    }

    this.statuses.set(key, "offline");
    await updateUserBot(userId, clientId, { status: "offline" });
  }

  async restartBot(userId: string, clientId: string): Promise<BotStatus> {
    await this.stopBot(userId, clientId);
    return this.startBot(userId, clientId);
  }

  async syncHierarchyCommandsForBot(bot: LocalUserBot): Promise<{ clientId: string; ok: boolean; message: string }> {
    if (!bot.encryptedToken) {
      return { clientId: bot.clientId, ok: false, message: "Bot sem token cadastrado" };
    }

    if (bot.planExpiresAt && new Date(bot.planExpiresAt).getTime() <= Date.now()) {
      return { clientId: bot.clientId, ok: false, message: "Plano vencido" };
    }

    try {
      await registerHierarchyCommands(bot.clientId, bot.guildId, decryptToken(bot.encryptedToken));
      return { clientId: bot.clientId, ok: true, message: "Comandos sincronizados" };
    } catch (error) {
      return {
        clientId: bot.clientId,
        ok: false,
        message: error instanceof Error ? error.message : "Falha ao sincronizar comandos"
      };
    }
  }

  async syncHierarchyCommandsByClientId(clientId: string): Promise<{ clientId: string; ok: boolean; message: string }> {
    const bot = await findUserBotByClientId(clientId);

    if (!bot) {
      return { clientId, ok: false, message: "Bot nao encontrado" };
    }

    return this.syncHierarchyCommandsForBot(bot);
  }

  async syncHierarchyCommandsForRegisteredBots(): Promise<{ clientId: string; ok: boolean; message: string }[]> {
    const bots = await listAllUserBots();
    const eligibleBots = bots.filter((bot) => bot.encryptedToken && bot.planStatus !== "overdue");
    const results = [];

    for (const bot of eligibleBots) {
      results.push(await this.syncHierarchyCommandsForBot(bot));
    }

    return results;
  }

  async restoreOnlineBots(): Promise<void> {
    const now = Date.now();
    const expiredBots = await listOverdueUserBots(new Date(now));

    for (const bot of expiredBots) {
      await this.stopBot(bot.userId, bot.clientId);
      await updateUserBot(bot.userId, bot.clientId, { planStatus: "overdue", status: "offline" });
      console.log(`Plano vencido, bot desligado: ${bot.clientId}`);
    }

    const onlineBots = await listOnlineUserBots();
    const botsToRestore = onlineBots.filter((bot) => {
      const activePlan = !bot.planExpiresAt || new Date(bot.planExpiresAt).getTime() > now;
      return bot.status === "online" && activePlan;
    });

    if (botsToRestore.length === 0) {
      console.log("No user bots to restore.");
      return;
    }

    console.log(`Restoring ${botsToRestore.length} user bot(s).`);

    for (const bot of botsToRestore) {
      const status = await this.startBot(bot.userId, bot.clientId);
      console.log(`Restore ${bot.clientId}: ${status}`);
    }
  }

  getStatus(userId: string, clientId: string): BotStatus {
    return this.statuses.get(this.key(userId, clientId)) || "offline";
  }
}

export const botManager = new BotManager();
