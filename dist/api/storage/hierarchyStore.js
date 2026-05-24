"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHierarchyConfig = getHierarchyConfig;
exports.saveHierarchyConfig = saveHierarchyConfig;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const dataDir = node_path_1.default.join(process.cwd(), "data");
const storePath = node_path_1.default.join(dataDir, "hierarchies.json");
async function ensureStore() {
    await promises_1.default.mkdir(dataDir, { recursive: true });
    try {
        await promises_1.default.access(storePath);
    }
    catch {
        await promises_1.default.writeFile(storePath, "[]\n", "utf8");
    }
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
async function writeAll(configs) {
    await ensureStore();
    await promises_1.default.writeFile(storePath, `${JSON.stringify(configs, null, 2)}\n`, "utf8");
}
async function getHierarchyConfig(clientId, guildId) {
    const configs = await readAll();
    const existing = configs.find((config) => config.clientId === clientId && config.guildId === guildId);
    return existing || {
        clientId,
        guildId,
        levels: [],
        autoRoleIds: [],
        updatedAt: new Date().toISOString()
    };
}
async function saveHierarchyConfig(config) {
    const configs = await readAll();
    const now = new Date().toISOString();
    const next = { ...config, updatedAt: now };
    const index = configs.findIndex((item) => item.clientId === config.clientId && item.guildId === config.guildId);
    if (index >= 0) {
        configs[index] = next;
    }
    else {
        configs.push(next);
    }
    await writeAll(configs);
    return next;
}
