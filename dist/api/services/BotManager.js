"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.botManager = void 0;
const discord_js_1 = require("discord.js");
const HierarchyManager_1 = require("./HierarchyManager");
const tokenCrypto_1 = require("../security/tokenCrypto");
const userBotStore_1 = require("../storage/userBotStore");
class BotManager {
    clients = new Map();
    statuses = new Map();
    key(userId, clientId) {
        return `${userId}:${clientId}`;
    }
    async startBot(userId, clientId) {
        const key = this.key(userId, clientId);
        const existing = this.clients.get(key);
        if (existing?.isReady()) {
            return "online";
        }
        const userBot = await (0, userBotStore_1.findUserBot)(userId, clientId);
        if (!userBot) {
            return "offline";
        }
        if (userBot.planExpiresAt && new Date(userBot.planExpiresAt).getTime() <= Date.now()) {
            await (0, userBotStore_1.updateUserBot)(userId, clientId, { planStatus: "overdue", status: "offline" });
            this.statuses.set(key, "offline");
            return "offline";
        }
        if (!userBot.encryptedToken) {
            this.statuses.set(key, "offline");
            await (0, userBotStore_1.updateUserBot)(userId, clientId, { status: "offline" });
            return "offline";
        }
        const token = (0, tokenCrypto_1.decryptToken)(userBot.encryptedToken);
        const client = new discord_js_1.Client({
            intents: [
                discord_js_1.GatewayIntentBits.Guilds,
                discord_js_1.GatewayIntentBits.GuildMessages,
                discord_js_1.GatewayIntentBits.GuildMembers
            ]
        });
        (0, HierarchyManager_1.attachHierarchySystem)(client, clientId, userBot.guildId, token);
        client.once(discord_js_1.Events.ClientReady, async () => {
            const guild = client.guilds.cache.get(userBot.guildId);
            const status = guild ? "online" : "error";
            this.statuses.set(key, status);
            await (0, userBotStore_1.updateUserBot)(userId, clientId, { status });
        });
        client.on(discord_js_1.Events.Error, async () => {
            this.statuses.set(key, "error");
            await (0, userBotStore_1.updateUserBot)(userId, clientId, { status: "error" });
        });
        client.on(discord_js_1.Events.MessageCreate, async (message) => {
            if (!message.guild || message.guild.id !== userBot.guildId) {
                return;
            }
            if (message.author.id !== userBot.targetUserId || message.author.id === client.user?.id) {
                return;
            }
            const botMember = message.guild.members.me;
            if (!botMember?.permissionsIn(message.channelId).has(discord_js_1.PermissionFlagsBits.ManageMessages)) {
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
                await (0, userBotStore_1.updateUserBot)(userId, clientId, { status: "error" });
                return "error";
            }
            const guild = await client.guilds.fetch(userBot.guildId).catch(() => null);
            if (!guild) {
                await client.destroy();
                this.clients.delete(key);
                this.statuses.set(key, "error");
                await (0, userBotStore_1.updateUserBot)(userId, clientId, { status: "error" });
                return "error";
            }
            this.clients.set(key, client);
            this.statuses.set(key, "online");
            await (0, userBotStore_1.updateUserBot)(userId, clientId, { status: "online" });
            return "online";
        }
        catch {
            this.clients.delete(key);
            this.statuses.set(key, "error");
            await (0, userBotStore_1.updateUserBot)(userId, clientId, { status: "error" });
            return "error";
        }
    }
    async stopBot(userId, clientId) {
        const key = this.key(userId, clientId);
        const client = this.clients.get(key);
        if (client) {
            await client.destroy();
            this.clients.delete(key);
        }
        this.statuses.set(key, "offline");
        await (0, userBotStore_1.updateUserBot)(userId, clientId, { status: "offline" });
    }
    async restartBot(userId, clientId) {
        await this.stopBot(userId, clientId);
        return this.startBot(userId, clientId);
    }
    async syncHierarchyCommandsForBot(bot) {
        if (!bot.encryptedToken) {
            return { clientId: bot.clientId, ok: false, message: "Bot sem token cadastrado" };
        }
        if (bot.planExpiresAt && new Date(bot.planExpiresAt).getTime() <= Date.now()) {
            return { clientId: bot.clientId, ok: false, message: "Plano vencido" };
        }
        try {
            await (0, HierarchyManager_1.registerHierarchyCommands)(bot.clientId, bot.guildId, (0, tokenCrypto_1.decryptToken)(bot.encryptedToken));
            return { clientId: bot.clientId, ok: true, message: "Comandos sincronizados" };
        }
        catch (error) {
            return {
                clientId: bot.clientId,
                ok: false,
                message: error instanceof Error ? error.message : "Falha ao sincronizar comandos"
            };
        }
    }
    async syncHierarchyCommandsByClientId(clientId) {
        const bot = await (0, userBotStore_1.findUserBotByClientId)(clientId);
        if (!bot) {
            return { clientId, ok: false, message: "Bot nao encontrado" };
        }
        return this.syncHierarchyCommandsForBot(bot);
    }
    async syncHierarchyCommandsForRegisteredBots() {
        const bots = await (0, userBotStore_1.listAllUserBots)();
        const eligibleBots = bots.filter((bot) => bot.encryptedToken && bot.planStatus !== "overdue");
        const results = [];
        for (const bot of eligibleBots) {
            results.push(await this.syncHierarchyCommandsForBot(bot));
        }
        return results;
    }
    async restoreOnlineBots() {
        const now = Date.now();
        const expiredBots = await (0, userBotStore_1.listOverdueUserBots)(new Date(now));
        for (const bot of expiredBots) {
            await this.stopBot(bot.userId, bot.clientId);
            await (0, userBotStore_1.updateUserBot)(bot.userId, bot.clientId, { planStatus: "overdue", status: "offline" });
            console.log(`Plano vencido, bot desligado: ${bot.clientId}`);
        }
        const onlineBots = await (0, userBotStore_1.listOnlineUserBots)();
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
    getStatus(userId, clientId) {
        return this.statuses.get(this.key(userId, clientId)) || "offline";
    }
}
exports.botManager = new BotManager();
