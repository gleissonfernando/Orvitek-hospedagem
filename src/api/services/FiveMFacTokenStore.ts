import fs from "node:fs";
import path from "node:path";

type FiveMTokenStatus = "available" | "used";

type FiveMTokenRecord = {
  status: FiveMTokenStatus;
  createdBy: string;
  createdAt: string;
  usedBy: string | null;
  usedAt: string | null;
};

type FiveMUserRecord = {
  access: boolean;
  token: string;
  activatedAt: string;
  config: Record<string, unknown>;
};

type FiveMGuildStore = {
  tokens: Record<string, FiveMTokenRecord>;
  users: Record<string, FiveMUserRecord>;
};

type FiveMFacStore = {
  guilds: Record<string, FiveMGuildStore>;
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

export function createFiveMFacToken(input: {
  guildId: string;
  token: string;
  createdBy: string;
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
    usedBy: null,
    usedAt: null
  };

  guildStore.tokens[input.token] = record;
  writeStore(store);
  return record;
}
