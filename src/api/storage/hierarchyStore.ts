import fs from "node:fs/promises";
import path from "node:path";

export type HierarchyLevel = {
  name: string;
  roleId: string;
};

export type HierarchyConfig = {
  clientId: string;
  guildId: string;
  levels: HierarchyLevel[];
  autoRoleIds: string[];
  updatedAt: string;
};

const dataDir = path.join(process.cwd(), "data");
const storePath = path.join(dataDir, "hierarchies.json");

async function ensureStore(): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, "[]\n", "utf8");
  }
}

async function readAll(): Promise<HierarchyConfig[]> {
  await ensureStore();

  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as HierarchyConfig[] : [];
  } catch {
    return [];
  }
}

async function writeAll(configs: HierarchyConfig[]): Promise<void> {
  await ensureStore();
  await fs.writeFile(storePath, `${JSON.stringify(configs, null, 2)}\n`, "utf8");
}

export async function getHierarchyConfig(clientId: string, guildId: string): Promise<HierarchyConfig> {
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

export async function saveHierarchyConfig(config: HierarchyConfig): Promise<HierarchyConfig> {
  const configs = await readAll();
  const now = new Date().toISOString();
  const next = { ...config, updatedAt: now };
  const index = configs.findIndex((item) => item.clientId === config.clientId && item.guildId === config.guildId);

  if (index >= 0) {
    configs[index] = next;
  } else {
    configs.push(next);
  }

  await writeAll(configs);
  return next;
}
