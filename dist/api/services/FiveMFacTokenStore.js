"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFiveMFacToken = createFiveMFacToken;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
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
function createFiveMFacToken(input) {
    const store = readStore();
    const guildStore = getGuildStore(store, input.guildId);
    const existing = guildStore.tokens[input.token];
    if (existing?.status === "available") {
        throw new Error("Token ja existe e ainda nao foi utilizado neste servidor.");
    }
    const record = {
        status: "available",
        createdBy: input.createdBy,
        createdAt: new Date().toISOString(),
        usedBy: null,
        usedAt: null
    };
    guildStore.tokens[input.token] = record;
    writeStore(store);
    return record;
}
