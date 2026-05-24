import fs from "node:fs";
import path from "node:path";

type FiveMTokenStatus = "available" | "used";

type FiveMTokenRecord = {
  status: FiveMTokenStatus;
  createdBy: string;
  createdAt: string;
  createdForUserId?: string | null;
  sourceGuildId?: string | null;
  usedBy: string | null;
  usedAt: string | null;
};

type FiveMPanelRecord = {
  channelId: string;
  channelName?: string;
  messageId: string;
  publishedAt?: string;
  activatedAt?: string;
};

type FiveMWelcomeConfig = Record<string, unknown> & {
  enabled?: boolean;
  confirmedAt?: string;
  entryChannelId?: string;
  entryChannelName?: string;
  exitChannelId?: string;
  exitChannelName?: string;
  entryTitle?: string;
  entryMessage?: string;
  dmMessage?: string;
  exitTitle?: string;
  exitMessage?: string;
  bannerUrl?: string;
  bannerName?: string;
  bannerLocalPath?: string;
  bannerAttachmentName?: string;
  bannerUpdatedAt?: string;
};

export type FiveMHierarchyLevel = {
  id: string;
  name: string;
  roleId: string | null;
};

export type FiveMHierarchyConfig = Record<string, unknown> & {
  levels: FiveMHierarchyLevel[];
  panel: FiveMPanelRecord | null;
  bannerUrl?: string;
  bannerName?: string;
  bannerLocalPath?: string;
  bannerAttachmentName?: string;
  bannerUpdatedAt?: string;
};

type FiveMUserRecord = {
  access: boolean;
  token: string;
  activatedAt: string;
  config: Record<string, unknown> & {
    welcome?: FiveMWelcomeConfig;
    hierarchy?: FiveMHierarchyConfig;
  };
};

type FiveMGuildStore = {
  tokens: Record<string, FiveMTokenRecord>;
  users: Record<string, FiveMUserRecord>;
  welcome?: FiveMWelcomeConfig;
  hierarchy?: FiveMHierarchyConfig;
};

type FiveMFacStore = {
  guilds: Record<string, FiveMGuildStore>;
};

type FiveMTokenEntry = {
  sourceGuildId: string;
  record: FiveMTokenRecord;
};

const dataDir = path.join(process.cwd(), "data");
const fivemFacPath = path.join(dataDir, "fivem-fac.json");

function ensureDataDir(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function readStore(): FiveMFacStore {
  ensureDataDir();

  if (!fs.existsSync(fivemFacPath)) {
    const initialStore: FiveMFacStore = { guilds: {} };
    fs.writeFileSync(fivemFacPath, `${JSON.stringify(initialStore, null, 2)}\n`, "utf8");
    return initialStore;
  }

  try {
    const store = JSON.parse(fs.readFileSync(fivemFacPath, "utf8")) as FiveMFacStore;
    if (!store.guilds || typeof store.guilds !== "object") {
      return { guilds: {} };
    }
    return store;
  } catch {
    return { guilds: {} };
  }
}

function writeStore(store: FiveMFacStore): void {
  ensureDataDir();
  fs.writeFileSync(fivemFacPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function getGuildStore(store: FiveMFacStore, guildId: string): FiveMGuildStore {
  if (!store.guilds[guildId]) {
    store.guilds[guildId] = {
      tokens: {},
      users: {}
    };
  }

  store.guilds[guildId].tokens ||= {};
  store.guilds[guildId].users ||= {};

  return store.guilds[guildId];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeUserConfig(userRecord: FiveMUserRecord): FiveMUserRecord["config"] {
  if (!isRecord(userRecord.config)) {
    userRecord.config = {};
  }

  return userRecord.config;
}

function ensureUserRecord(guildStore: FiveMGuildStore, userId: string): FiveMUserRecord {
  const now = new Date().toISOString();
  const previous = guildStore.users[userId];

  guildStore.users[userId] = {
    access: previous?.access === true,
    token: previous?.token || "",
    activatedAt: previous?.activatedAt || now,
    config: isRecord(previous?.config) ? previous.config : {}
  };

  return guildStore.users[userId];
}

function getUserWelcomeConfig(guildStore: FiveMGuildStore, userId: string): FiveMWelcomeConfig {
  const userRecord = guildStore.users[userId];
  if (!userRecord) {
    return {};
  }

  const config = normalizeUserConfig(userRecord);
  return isRecord(config.welcome) ? config.welcome as FiveMWelcomeConfig : {};
}

function getUserHierarchyConfig(guildStore: FiveMGuildStore, userId: string): FiveMHierarchyConfig | null {
  const userRecord = guildStore.users[userId];
  if (!userRecord) {
    return null;
  }

  const config = normalizeUserConfig(userRecord);
  return isRecord(config.hierarchy) ? config.hierarchy as FiveMHierarchyConfig : null;
}

function findFiveMFacTokenEntry(store: FiveMFacStore, guildId: string, token: string, userId: string): FiveMTokenEntry | null {
  const guildStore = getGuildStore(store, guildId);
  const localRecord = guildStore.tokens[token];

  if (localRecord) {
    return {
      sourceGuildId: guildId,
      record: localRecord
    };
  }

  const ownedAvailable: FiveMTokenEntry[] = [];
  const legacyAvailable: FiveMTokenEntry[] = [];
  const usedByUser: FiveMTokenEntry[] = [];

  for (const [candidateGuildId, candidateGuild] of Object.entries(store.guilds || {})) {
    if (candidateGuildId === guildId) {
      continue;
    }

    const candidateRecord = candidateGuild.tokens?.[token];
    if (!candidateRecord) {
      continue;
    }

    const entry = {
      sourceGuildId: candidateGuildId,
      record: candidateRecord
    };

    if (candidateRecord.status === "available" && candidateRecord.createdForUserId === userId) {
      ownedAvailable.push(entry);
      continue;
    }

    if (candidateRecord.status === "available" && !candidateRecord.createdForUserId) {
      legacyAvailable.push(entry);
      continue;
    }

    if (candidateRecord.status === "used" && candidateRecord.usedBy === userId) {
      usedByUser.push(entry);
    }
  }

  return ownedAvailable[0] || (legacyAvailable.length === 1 ? legacyAvailable[0] : null) || usedByUser[0] || null;
}

function isTokenActivatedForUser(entry: FiveMTokenEntry | null, guildId: string, token: string, userId: string, userRecord?: FiveMUserRecord): boolean {
  if (!entry?.record || entry.record.status !== "used" || entry.record.usedBy !== userId || userRecord?.access !== true) {
    return false;
  }

  return entry.sourceGuildId === guildId || userRecord.token === token;
}

function defaultHierarchyConfig(): FiveMHierarchyConfig {
  return {
    levels: [
      { id: "lider", name: "Lider", roleId: null },
      { id: "gerente", name: "Gerente", roleId: null },
      { id: "gerente-de-acao", name: "Gerente de Acao", roleId: null }
    ],
    panel: null
  };
}

export function createFiveMFacToken(input: {
  guildId: string;
  token: string;
  createdBy: string;
  userId?: string | null;
}): FiveMTokenRecord {
  const store = readStore();
  const guildStore = getGuildStore(store, input.guildId);
  const existing = guildStore.tokens[input.token];

  if (existing?.status === "available") {
    throw new Error("Token ja existe e ainda nao foi utilizado neste servidor.");
  }

  const record: FiveMTokenRecord = {
    status: "available",
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    createdForUserId: input.userId || null,
    usedBy: null,
    usedAt: null
  };

  guildStore.tokens[input.token] = record;
  writeStore(store);
  return record;
}

export function hasFiveMFacAccess(guildId: string, userId: string): boolean {
  const store = readStore();
  const guildStore = getGuildStore(store, guildId);
  return guildStore.users[userId]?.access === true;
}

export function checkFiveMFacToken(input: {
  guildId: string;
  token: string;
  userId: string;
}): { ok: boolean; message: string } {
  const store = readStore();
  const guildStore = getGuildStore(store, input.guildId);
  const tokenEntry = findFiveMFacTokenEntry(store, input.guildId, input.token, input.userId);
  const tokenRecord = tokenEntry?.record;
  const userRecord = guildStore.users[input.userId];

  if (isTokenActivatedForUser(tokenEntry || null, input.guildId, input.token, input.userId, userRecord)) {
    return {
      ok: true,
      message: "Painel fac ja liberado para este servidor."
    };
  }

  if (!tokenRecord || tokenRecord.status !== "available") {
    return {
      ok: false,
      message: "Codigo de ativacao invalido ou ja utilizado para este servidor."
    };
  }

  if (tokenRecord.createdForUserId && tokenRecord.createdForUserId !== input.userId) {
    return {
      ok: false,
      message: "Este codigo de ativacao pertence a outro usuario."
    };
  }

  return {
    ok: true,
    message: "Codigo de ativacao disponivel."
  };
}

export function useFiveMFacToken(input: {
  guildId: string;
  token: string;
  userId: string;
}): { ok: boolean; message: string } {
  const store = readStore();
  const guildStore = getGuildStore(store, input.guildId);
  const tokenEntry = findFiveMFacTokenEntry(store, input.guildId, input.token, input.userId);
  const tokenRecord = tokenEntry?.record;
  const userRecord = guildStore.users[input.userId];

  if (isTokenActivatedForUser(tokenEntry || null, input.guildId, input.token, input.userId, userRecord)) {
    return {
      ok: true,
      message: "Painel fac ja liberado para este servidor."
    };
  }

  if (!tokenRecord || tokenRecord.status !== "available") {
    return {
      ok: false,
      message: "Codigo de ativacao invalido ou ja utilizado para este servidor."
    };
  }

  if (tokenRecord.createdForUserId && tokenRecord.createdForUserId !== input.userId) {
    return {
      ok: false,
      message: "Este codigo de ativacao pertence a outro usuario."
    };
  }

  const now = new Date().toISOString();
  tokenRecord.status = "used";
  tokenRecord.usedBy = input.userId;
  tokenRecord.usedAt = now;

  if (tokenEntry?.sourceGuildId && tokenEntry.sourceGuildId !== input.guildId) {
    guildStore.tokens[input.token] = {
      ...tokenRecord,
      sourceGuildId: tokenEntry.sourceGuildId,
      usedBy: input.userId,
      usedAt: now
    };
  }

  guildStore.users[input.userId] = {
    access: true,
    token: input.token,
    activatedAt: now,
    config: guildStore.users[input.userId]?.config || {}
  };

  writeStore(store);
  return {
    ok: true,
    message: "Painel fac liberado com sucesso."
  };
}

export function saveFiveMFacPanelActivation(input: {
  guildId: string;
  userId: string;
  channelId: string;
  channelName?: string;
  messageId: string;
}): void {
  const store = readStore();
  const guildStore = getGuildStore(store, input.guildId);
  const previousUser = guildStore.users[input.userId];
  const now = new Date().toISOString();

  guildStore.users[input.userId] = {
    access: true,
    token: previousUser?.token || "",
    activatedAt: previousUser?.activatedAt || now,
    config: {
      ...(previousUser?.config || {}),
      panel: {
        channelId: input.channelId,
        channelName: input.channelName,
        messageId: input.messageId,
        activatedAt: now
      }
    }
  };

  writeStore(store);
}

export function getFiveMWelcomeConfig(guildId: string, userId?: string): FiveMWelcomeConfig {
  const store = readStore();
  const guildStore = getGuildStore(store, guildId);

  if (userId) {
    return getUserWelcomeConfig(guildStore, userId);
  }

  return guildStore.welcome || {};
}

export function saveFiveMWelcomeConfig(guildId: string, patch: FiveMWelcomeConfig, userId?: string): FiveMWelcomeConfig {
  const store = readStore();
  const guildStore = getGuildStore(store, guildId);

  if (userId) {
    const userRecord = ensureUserRecord(guildStore, userId);
    const userConfig = normalizeUserConfig(userRecord);
    const previous = isRecord(userConfig.welcome) ? userConfig.welcome as FiveMWelcomeConfig : {};

    userConfig.welcome = {
      ...previous,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    writeStore(store);
    return userConfig.welcome;
  }

  const previous = guildStore.welcome || {};

  guildStore.welcome = {
    ...previous,
    ...patch,
    updatedAt: new Date().toISOString()
  };

  writeStore(store);
  return guildStore.welcome;
}

export function createFiveMHierarchyLevelId(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || `nivel-${Date.now()}`;
}

export function getFiveMHierarchyConfig(guildId: string, userId?: string): FiveMHierarchyConfig {
  const store = readStore();
  const guildStore = getGuildStore(store, guildId);

  if (userId) {
    return getUserHierarchyConfig(guildStore, userId) || defaultHierarchyConfig();
  }

  if (!guildStore.hierarchy) {
    guildStore.hierarchy = defaultHierarchyConfig();
    writeStore(store);
  }

  return guildStore.hierarchy;
}

export function saveFiveMHierarchyConfig(guildId: string, patch: Partial<FiveMHierarchyConfig>, userId?: string): FiveMHierarchyConfig {
  const store = readStore();
  const guildStore = getGuildStore(store, guildId);

  if (userId) {
    const userRecord = ensureUserRecord(guildStore, userId);
    const userConfig = normalizeUserConfig(userRecord);
    const previous = getUserHierarchyConfig(guildStore, userId) || defaultHierarchyConfig();

    userConfig.hierarchy = {
      ...previous,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    writeStore(store);
    return userConfig.hierarchy;
  }

  const previous = guildStore.hierarchy || defaultHierarchyConfig();

  guildStore.hierarchy = {
    ...previous,
    ...patch,
    updatedAt: new Date().toISOString()
  };

  writeStore(store);
  return guildStore.hierarchy;
}

export function upsertFiveMHierarchyLevel(guildId: string, level: FiveMHierarchyLevel, userId?: string): FiveMHierarchyConfig {
  const config = getFiveMHierarchyConfig(guildId, userId);
  const levels = [...config.levels];
  const index = levels.findIndex((item) => item.id === level.id);

  if (index >= 0) {
    levels[index] = { ...levels[index], ...level };
  } else {
    levels.push(level);
  }

  return saveFiveMHierarchyConfig(guildId, { levels }, userId);
}
