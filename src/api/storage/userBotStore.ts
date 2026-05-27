import fs from "node:fs/promises";
import path from "node:path";
import { isMongoConnected } from "../db";
import { UserBot } from "../models/UserBot";

export type BotStatus = "online" | "offline" | "error";

export type LocalUserBot = {
  userId: string;
  guildId: string;
  targetUserId: string;
  clientId: string;
  hostingAccessKey?: string;
  hostingAccessGranted?: boolean;
  projectName?: string;
  encryptedToken?: string;
  botUsername: string;
  botId: string;
  status: BotStatus;
  planStatus?: "active" | "overdue";
  planStartedAt?: string;
  planExpiresAt?: string;
  lastPaymentAmountCents?: number;
  lastPaymentAt?: string;
  createdAt: string;
  updatedAt: string;
};

const dataDir = path.join(process.cwd(), "data");
const storePath = path.join(dataDir, "api-user-bots.json");

type UserBotPatch = Partial<Omit<LocalUserBot, "userId" | "clientId" | "createdAt" | "updatedAt">>;

function usesMongo(): boolean {
  return isMongoConnected();
}

function toLocalUserBot(bot: Record<string, unknown>): LocalUserBot {
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
    status: bot.status as BotStatus,
    planStatus: bot.planStatus as LocalUserBot["planStatus"],
    planStartedAt: bot.planStartedAt ? new Date(bot.planStartedAt as string | Date).toISOString() : undefined,
    planExpiresAt: bot.planExpiresAt ? new Date(bot.planExpiresAt as string | Date).toISOString() : undefined,
    lastPaymentAmountCents: typeof bot.lastPaymentAmountCents === "number" ? bot.lastPaymentAmountCents : undefined,
    lastPaymentAt: bot.lastPaymentAt ? new Date(bot.lastPaymentAt as string | Date).toISOString() : undefined,
    createdAt: bot.createdAt ? new Date(bot.createdAt as string | Date).toISOString() : new Date().toISOString(),
    updatedAt: bot.updatedAt ? new Date(bot.updatedAt as string | Date).toISOString() : new Date().toISOString()
  };
}

async function ensureStore(): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, "[]\n", "utf8");
  }
}

function normalizeForMongo(input: Omit<LocalUserBot, "createdAt" | "updatedAt"> | UserBotPatch) {
  return {
    ...input,
    planStartedAt: input.planStartedAt ? new Date(input.planStartedAt) : undefined,
    planExpiresAt: input.planExpiresAt ? new Date(input.planExpiresAt) : undefined,
    lastPaymentAt: input.lastPaymentAt ? new Date(input.lastPaymentAt) : undefined
  };
}

async function readAll(): Promise<LocalUserBot[]> {
  await ensureStore();

  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as LocalUserBot[] : [];
  } catch {
    return [];
  }
}

async function writeAll(bots: LocalUserBot[]): Promise<void> {
  await ensureStore();
  await fs.writeFile(storePath, `${JSON.stringify(bots, null, 2)}\n`, "utf8");
}

export async function upsertUserBot(input: Omit<LocalUserBot, "createdAt" | "updatedAt">): Promise<LocalUserBot> {
  if (usesMongo()) {
    const updated = await UserBot.findOneAndUpdate(
      { userId: input.userId, clientId: input.clientId },
      { $set: normalizeForMongo(input) },
      { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
    ).select("+encryptedToken").lean();

    if (!updated) {
      throw new Error("Nao foi possivel salvar o bot do usuario.");
    }

    return toLocalUserBot(updated);
  }

  const bots = await readAll();
  const now = new Date().toISOString();
  const index = bots.findIndex((bot) => bot.userId === input.userId && bot.clientId === input.clientId);
  const next: LocalUserBot = {
    ...input,
    createdAt: index >= 0 ? bots[index].createdAt : now,
    updatedAt: now
  };

  if (index >= 0) {
    bots[index] = next;
  } else {
    bots.push(next);
  }

  await writeAll(bots);
  return next;
}

export async function findUserBot(userId: string, clientId: string): Promise<LocalUserBot | null> {
  if (usesMongo()) {
    const bot = await UserBot.findOne({ userId, clientId }).select("+encryptedToken").lean();
    return bot ? toLocalUserBot(bot) : null;
  }

  const bots = await readAll();
  return bots.find((bot) => bot.userId === userId && bot.clientId === clientId) || null;
}

export async function findUserBotByClientId(clientId: string): Promise<LocalUserBot | null> {
  if (usesMongo()) {
    const bot = await UserBot.findOne({ clientId }).select("+encryptedToken").lean();
    return bot ? toLocalUserBot(bot) : null;
  }

  const bots = await readAll();
  return bots.find((bot) => bot.clientId === clientId) || null;
}

export async function findUserBotByHostingAccessKey(hostingAccessKey: string): Promise<LocalUserBot | null> {
  if (usesMongo()) {
    const bot = await UserBot.findOne({ hostingAccessKey }).select("+encryptedToken").lean();
    return bot ? toLocalUserBot(bot) : null;
  }

  const bots = await readAll();
  return bots.find((bot) => bot.hostingAccessKey === hostingAccessKey) || null;
}

export async function listUserBots(userId: string): Promise<LocalUserBot[]> {
  if (usesMongo()) {
    const bots = await UserBot.find({ userId }).select("+encryptedToken").sort({ updatedAt: -1 }).lean();
    return bots.map((bot) => toLocalUserBot(bot));
  }

  const bots = await readAll();
  return bots
    .filter((bot) => bot.userId === userId)
    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}

export async function listAllUserBots(): Promise<LocalUserBot[]> {
  if (usesMongo()) {
    const bots = await UserBot.find({}).select("+encryptedToken").sort({ updatedAt: -1 }).lean();
    return bots.map((bot) => toLocalUserBot(bot));
  }

  const bots = await readAll();
  return bots.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}

export async function listOnlineUserBots(): Promise<LocalUserBot[]> {
  if (usesMongo()) {
    const bots = await UserBot.find({ status: "online" }).select("+encryptedToken").sort({ updatedAt: -1 }).lean();
    return bots.map((bot) => toLocalUserBot(bot));
  }

  const bots = await readAll();
  return bots.filter((bot) => bot.status === "online").sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}

export async function listOverdueUserBots(now = new Date()): Promise<LocalUserBot[]> {
  if (usesMongo()) {
    const bots = await UserBot.find({ planExpiresAt: { $lte: now } }).select("+encryptedToken").sort({ planExpiresAt: 1 }).lean();
    return bots.map((bot) => toLocalUserBot(bot));
  }

  const nowMs = now.getTime();
  const bots = await readAll();
  return bots
    .filter((bot) => bot.planExpiresAt && new Date(bot.planExpiresAt).getTime() <= nowMs)
    .sort((first, second) => (first.planExpiresAt || "").localeCompare(second.planExpiresAt || ""));
}

export async function deleteUserBot(userId: string, clientId: string): Promise<void> {
  if (usesMongo()) {
    await UserBot.deleteOne({ userId, clientId });
    return;
  }

  const bots = await readAll();
  await writeAll(bots.filter((bot) => !(bot.userId === userId && bot.clientId === clientId)));
}

export async function updateUserBot(
  userId: string,
  clientId: string,
  patch: UserBotPatch
): Promise<LocalUserBot | null> {
  if (usesMongo()) {
    const updated = await UserBot.findOneAndUpdate(
      { userId, clientId },
      { $set: normalizeForMongo(patch) },
      { returnDocument: "after" }
    ).select("+encryptedToken").lean();

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

export async function updateUserBotByClientId(
  clientId: string,
  patch: UserBotPatch
): Promise<LocalUserBot | null> {
  const existing = await findUserBotByClientId(clientId);

  if (!existing) {
    return null;
  }

  return updateUserBot(existing.userId, clientId, patch);
}
