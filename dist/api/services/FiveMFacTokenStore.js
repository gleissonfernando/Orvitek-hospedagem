"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FiveMFacTokenConflictError = void 0;
exports.createFiveMFacToken = createFiveMFacToken;
exports.hasFiveMFacAccess = hasFiveMFacAccess;
exports.checkFiveMFacToken = checkFiveMFacToken;
exports.useFiveMFacToken = useFiveMFacToken;
exports.saveFiveMFacPanelActivation = saveFiveMFacPanelActivation;
exports.getFiveMWelcomeConfig = getFiveMWelcomeConfig;
exports.saveFiveMWelcomeConfig = saveFiveMWelcomeConfig;
exports.createFiveMHierarchyLevelId = createFiveMHierarchyLevelId;
exports.getFiveMHierarchyConfig = getFiveMHierarchyConfig;
exports.saveFiveMHierarchyConfig = saveFiveMHierarchyConfig;
exports.upsertFiveMHierarchyLevel = upsertFiveMHierarchyLevel;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
class FiveMFacTokenConflictError extends Error {
    constructor(message) {
        super(message);
        this.name = "FiveMFacTokenConflictError";
    }
}
exports.FiveMFacTokenConflictError = FiveMFacTokenConflictError;
const dataDir = node_path_1.default.join(process.cwd(), "data");
const fivemFacPath = node_path_1.default.join(dataDir, "fivem-fac.json");
function ensureDataDir() {
    if (!node_fs_1.default.existsSync(dataDir)) {
        node_fs_1.default.mkdirSync(dataDir, { recursive: true });
    }
}
function readStore() {
    ensureDataDir();
    if (!node_fs_1.default.existsSync(fivemFacPath)) {
        const initialStore = { guilds: {} };
        node_fs_1.default.writeFileSync(fivemFacPath, `${JSON.stringify(initialStore, null, 2)}\n`, "utf8");
        return initialStore;
    }
    try {
        const store = JSON.parse(node_fs_1.default.readFileSync(fivemFacPath, "utf8"));
        if (!store.guilds || typeof store.guilds !== "object") {
            return { guilds: {} };
        }
        return store;
    }
    catch {
        return { guilds: {} };
    }
}
function writeStore(store) {
    ensureDataDir();
    node_fs_1.default.writeFileSync(fivemFacPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}
function getGuildStore(store, guildId) {
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
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function normalizeUserConfig(userRecord) {
    if (!isRecord(userRecord.config)) {
        userRecord.config = {};
    }
    return userRecord.config;
}
function ensureUserRecord(guildStore, userId) {
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
function getUserWelcomeConfig(guildStore, userId) {
    const userRecord = guildStore.users[userId];
    if (!userRecord) {
        return {};
    }
    const config = normalizeUserConfig(userRecord);
    return isRecord(config.welcome) ? config.welcome : {};
}
function getUserHierarchyConfig(guildStore, userId) {
    const userRecord = guildStore.users[userId];
    if (!userRecord) {
        return null;
    }
    const config = normalizeUserConfig(userRecord);
    return isRecord(config.hierarchy) ? config.hierarchy : null;
}
function findFiveMFacTokenEntry(store, guildId, token, userId) {
    const guildStore = getGuildStore(store, guildId);
    const localRecord = guildStore.tokens[token];
    if (localRecord) {
        return {
            sourceGuildId: guildId,
            record: localRecord
        };
    }
    const ownedAvailable = [];
    const legacyAvailable = [];
    const usedByUser = [];
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
function isTokenActivatedForUser(entry, guildId, token, userId, userRecord) {
    if (!entry?.record || entry.record.status !== "used" || entry.record.usedBy !== userId || userRecord?.access !== true) {
        return false;
    }
    return entry.sourceGuildId === guildId || userRecord.token === token;
}
function defaultHierarchyConfig() {
    return {
        levels: [
            { id: "lider", name: "Lider", roleId: null },
            { id: "gerente", name: "Gerente", roleId: null },
            { id: "gerente-de-acao", name: "Gerente de Acao", roleId: null }
        ],
        panel: null
    };
}
function createFiveMFacToken(input) {
    const store = readStore();
    const guildStore = getGuildStore(store, input.guildId);
    const existing = guildStore.tokens[input.token];
    if (existing) {
        const sameOwner = (existing.createdForUserId || null) === (input.userId || null);
        const sameCreator = existing.createdBy === input.createdBy;
        if (existing.status === "available" && sameOwner && sameCreator) {
            return { record: existing, created: false };
        }
        throw new FiveMFacTokenConflictError(existing.status === "used"
            ? "Token ja foi utilizado neste servidor."
            : "Token ja existe e esta associado a outro cliente neste servidor.");
    }
    const record = {
        status: "available",
        createdBy: input.createdBy,
        createdAt: new Date().toISOString(),
        createdForUserId: input.userId || null,
        usedBy: null,
        usedAt: null
    };
    guildStore.tokens[input.token] = record;
    writeStore(store);
    return { record, created: true };
}
function hasFiveMFacAccess(guildId, userId) {
    const store = readStore();
    const guildStore = getGuildStore(store, guildId);
    return guildStore.users[userId]?.access === true;
}
function checkFiveMFacToken(input) {
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
function useFiveMFacToken(input) {
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
function saveFiveMFacPanelActivation(input) {
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
function getFiveMWelcomeConfig(guildId, userId) {
    const store = readStore();
    const guildStore = getGuildStore(store, guildId);
    if (userId) {
        return getUserWelcomeConfig(guildStore, userId);
    }
    return guildStore.welcome || {};
}
function saveFiveMWelcomeConfig(guildId, patch, userId) {
    const store = readStore();
    const guildStore = getGuildStore(store, guildId);
    if (userId) {
        const userRecord = ensureUserRecord(guildStore, userId);
        const userConfig = normalizeUserConfig(userRecord);
        const previous = isRecord(userConfig.welcome) ? userConfig.welcome : {};
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
function createFiveMHierarchyLevelId(name) {
    return name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || `nivel-${Date.now()}`;
}
function getFiveMHierarchyConfig(guildId, userId) {
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
function saveFiveMHierarchyConfig(guildId, patch, userId) {
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
function upsertFiveMHierarchyLevel(guildId, level, userId) {
    const config = getFiveMHierarchyConfig(guildId, userId);
    const levels = [...config.levels];
    const index = levels.findIndex((item) => item.id === level.id);
    if (index >= 0) {
        levels[index] = { ...levels[index], ...level };
    }
    else {
        levels.push(level);
    }
    return saveFiveMHierarchyConfig(guildId, { levels }, userId);
}
