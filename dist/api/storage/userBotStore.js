"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertUserBot = upsertUserBot;
exports.findUserBot = findUserBot;
exports.findUserBotByClientId = findUserBotByClientId;
exports.findUserBotByHostingAccessKey = findUserBotByHostingAccessKey;
exports.listUserBots = listUserBots;
exports.listAllUserBots = listAllUserBots;
exports.listOnlineUserBots = listOnlineUserBots;
exports.listOverdueUserBots = listOverdueUserBots;
exports.deleteUserBot = deleteUserBot;
exports.updateUserBot = updateUserBot;
exports.updateUserBotByClientId = updateUserBotByClientId;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("../db");
const UserBot_1 = require("../models/UserBot");
const dataDir = node_path_1.default.join(process.cwd(), "data");
const storePath = node_path_1.default.join(dataDir, "api-user-bots.json");
function usesMongo() {
    return (0, db_1.isMongoConnected)();
}
function toLocalUserBot(bot) {
    return {
        userId: String(bot.userId),
        guildId: String(bot.guildId),
        targetUserId: String(bot.targetUserId),
        clientId: String(bot.clientId),
        hostingAccessKey: bot.hostingAccessKey ? String(bot.hostingAccessKey) : undefined,
        hostingAccessGranted: Boolean(bot.hostingAccessGranted),
        projectName: bot.projectName ? String(bot.projectName) : undefined,
        encryptedToken: bot.encryptedToken ? String(bot.encryptedToken) : undefined,
        botUsername: String(bot.botUsername),
        botId: String(bot.botId),
        status: bot.status,
        planStatus: bot.planStatus,
        planStartedAt: bot.planStartedAt ? new Date(bot.planStartedAt).toISOString() : undefined,
        planExpiresAt: bot.planExpiresAt ? new Date(bot.planExpiresAt).toISOString() : undefined,
        lastPaymentAmountCents: typeof bot.lastPaymentAmountCents === "number" ? bot.lastPaymentAmountCents : undefined,
        lastPaymentAt: bot.lastPaymentAt ? new Date(bot.lastPaymentAt).toISOString() : undefined,
        createdAt: bot.createdAt ? new Date(bot.createdAt).toISOString() : new Date().toISOString(),
        updatedAt: bot.updatedAt ? new Date(bot.updatedAt).toISOString() : new Date().toISOString()
    };
}
async function ensureStore() {
    await promises_1.default.mkdir(dataDir, { recursive: true });
    try {
        await promises_1.default.access(storePath);
    }
    catch {
        await promises_1.default.writeFile(storePath, "[]\n", "utf8");
    }
}
function normalizeForMongo(input) {
    return {
        ...input,
        planStartedAt: input.planStartedAt ? new Date(input.planStartedAt) : undefined,
        planExpiresAt: input.planExpiresAt ? new Date(input.planExpiresAt) : undefined,
        lastPaymentAt: input.lastPaymentAt ? new Date(input.lastPaymentAt) : undefined
    };
}
async function readAll() {
    await ensureStore();
    try {
        const raw = await promises_1.default.readFile(storePath, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
async function writeAll(bots) {
    await ensureStore();
    await promises_1.default.writeFile(storePath, `${JSON.stringify(bots, null, 2)}\n`, "utf8");
}
async function upsertUserBot(input) {
    if (usesMongo()) {
        const updated = await UserBot_1.UserBot.findOneAndUpdate({ userId: input.userId, clientId: input.clientId }, { $set: normalizeForMongo(input) }, { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }).select("+encryptedToken").lean();
        if (!updated) {
            throw new Error("Nao foi possivel salvar o bot do usuario.");
        }
        return toLocalUserBot(updated);
    }
    const bots = await readAll();
    const now = new Date().toISOString();
    const index = bots.findIndex((bot) => bot.userId === input.userId && bot.clientId === input.clientId);
    const next = {
        ...input,
        createdAt: index >= 0 ? bots[index].createdAt : now,
        updatedAt: now
    };
    if (index >= 0) {
        bots[index] = next;
    }
    else {
        bots.push(next);
    }
    await writeAll(bots);
    return next;
}
async function findUserBot(userId, clientId) {
    if (usesMongo()) {
        const bot = await UserBot_1.UserBot.findOne({ userId, clientId }).select("+encryptedToken").lean();
        return bot ? toLocalUserBot(bot) : null;
    }
    const bots = await readAll();
    return bots.find((bot) => bot.userId === userId && bot.clientId === clientId) || null;
}
async function findUserBotByClientId(clientId) {
    if (usesMongo()) {
        const bot = await UserBot_1.UserBot.findOne({ clientId }).select("+encryptedToken").lean();
        return bot ? toLocalUserBot(bot) : null;
    }
    const bots = await readAll();
    return bots.find((bot) => bot.clientId === clientId) || null;
}
async function findUserBotByHostingAccessKey(hostingAccessKey) {
    if (usesMongo()) {
        const bot = await UserBot_1.UserBot.findOne({ hostingAccessKey }).select("+encryptedToken").lean();
        return bot ? toLocalUserBot(bot) : null;
    }
    const bots = await readAll();
    return bots.find((bot) => bot.hostingAccessKey === hostingAccessKey) || null;
}
async function listUserBots(userId) {
    if (usesMongo()) {
        const bots = await UserBot_1.UserBot.find({ userId }).select("+encryptedToken").sort({ updatedAt: -1 }).lean();
        return bots.map((bot) => toLocalUserBot(bot));
    }
    const bots = await readAll();
    return bots
        .filter((bot) => bot.userId === userId)
        .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}
async function listAllUserBots() {
    if (usesMongo()) {
        const bots = await UserBot_1.UserBot.find({}).select("+encryptedToken").sort({ updatedAt: -1 }).lean();
        return bots.map((bot) => toLocalUserBot(bot));
    }
    const bots = await readAll();
    return bots.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}
async function listOnlineUserBots() {
    if (usesMongo()) {
        const bots = await UserBot_1.UserBot.find({ status: "online" }).select("+encryptedToken").sort({ updatedAt: -1 }).lean();
        return bots.map((bot) => toLocalUserBot(bot));
    }
    const bots = await readAll();
    return bots.filter((bot) => bot.status === "online").sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}
async function listOverdueUserBots(now = new Date()) {
    if (usesMongo()) {
        const bots = await UserBot_1.UserBot.find({ planExpiresAt: { $lte: now } }).select("+encryptedToken").sort({ planExpiresAt: 1 }).lean();
        return bots.map((bot) => toLocalUserBot(bot));
    }
    const nowMs = now.getTime();
    const bots = await readAll();
    return bots
        .filter((bot) => bot.planExpiresAt && new Date(bot.planExpiresAt).getTime() <= nowMs)
        .sort((first, second) => (first.planExpiresAt || "").localeCompare(second.planExpiresAt || ""));
}
async function deleteUserBot(userId, clientId) {
    if (usesMongo()) {
        await UserBot_1.UserBot.deleteOne({ userId, clientId });
        return;
    }
    const bots = await readAll();
    await writeAll(bots.filter((bot) => !(bot.userId === userId && bot.clientId === clientId)));
}
async function updateUserBot(userId, clientId, patch) {
    if (usesMongo()) {
        const updated = await UserBot_1.UserBot.findOneAndUpdate({ userId, clientId }, { $set: normalizeForMongo(patch) }, { returnDocument: "after" }).select("+encryptedToken").lean();
        return updated ? toLocalUserBot(updated) : null;
    }
    const existing = await findUserBot(userId, clientId);
    if (!existing) {
        return null;
    }
    return upsertUserBot({
        ...existing,
        ...patch,
        userId,
        clientId
    });
}
async function updateUserBotByClientId(clientId, patch) {
    const existing = await findUserBotByClientId(clientId);
    if (!existing) {
        return null;
    }
    return updateUserBot(existing.userId, clientId, patch);
}
