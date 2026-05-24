const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  Client,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  InteractionType,
  MessageFlags,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  SeparatorBuilder,
  SectionBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { getConfig } = require("./config");
const { registerCommands } = require("./register-commands");

const config = getConfig();
const snowflakeRegex = /^\d{17,20}$/;
const dataDir = path.join(__dirname, "..", "data");
const registryPath = path.join(dataDir, "fivem-users.json");
const fivemFacPath = path.join(dataDir, "fivem-fac.json");
const panelImageName = "orvitek-bots-hospedagem.png";
const panelImagePath = path.join(__dirname, "assets", panelImageName);

const testBotClients = new Map();
const testBotStatuses = new Map();
const pendingBotRegistrations = new Map();
const pendingBotDeletes = new Map();
const pendingWelcomeBannerUploads = new Map();
const publicComponentsV2Flags = MessageFlags.IsComponentsV2;
const ephemeralComponentsV2Flags = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;
const panelClientIntents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages
];

if (config.enableMemberEvents) {
  panelClientIntents.push(GatewayIntentBits.GuildMembers);
}

const panelClient = new Client({
  intents: panelClientIntents
});

const tokenLikePatterns = [
  /mfa\.[A-Za-z0-9_-]{20,}/,
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/,
  /TOKEN_DO_BOT/i,
  /TOKEN_REAL_DO_BOT/i
];

function containsTokenLikeText(content) {
  return tokenLikePatterns.some((pattern) => pattern.test(content));
}

async function deleteTokenLikeMessage(message) {
  if (message.author.bot || !message.guild || !containsTokenLikeText(message.content)) {
    return;
  }

  try {
    await message.delete();
  } catch {
    return;
  }

  try {
    const warning = await message.channel.send({
      content: `${message.author}, por seguranca apaguei essa mensagem. Tokens devem ser enviados somente pelo botao Configurar token no painel seguro.`
    });

    setTimeout(() => {
      warning.delete().catch(() => {});
    }, 10000);
  } catch {
    // Sem log de conteudo para evitar expor segredo por acidente.
  }
}

function getConfiguredTestBots() {
  dotenv.config({ override: true });

  const indexedBots = [];
  for (let index = 1; index <= 50; index += 1) {
    const ownerId = process.env[`TEST_BOT_${index}_OWNER_ID`];
    const serverId = process.env[`TEST_BOT_${index}_SERVER_ID`];
    const clientId = process.env[`TEST_BOT_${index}_CLIENT_ID`];
    const token = process.env[`TEST_BOT_${index}_TOKEN`];

    if (ownerId || serverId || clientId || token) {
      if (ownerId && clientId && token) {
        indexedBots.push({ ownerId, serverId: serverId || null, clientId, token });
      } else {
        console.error(`TEST_BOT_${index} esta incompleto. Preencha OWNER_ID, CLIENT_ID e TOKEN.`);
      }
    }
  }

  if (indexedBots.length > 0) {
    return indexedBots;
  }

  if (process.env.TEST_BOTS_JSON) {
    try {
      const parsed = JSON.parse(process.env.TEST_BOTS_JSON);
      if (Array.isArray(parsed)) {
        return parsed.filter((bot) => bot?.ownerId && bot?.clientId && bot?.token);
      }
    } catch (error) {
      console.error("TEST_BOTS_JSON invalido:", error.message);
      return [];
    }
  }

  if (process.env.TEST_OWNER_ID && process.env.TEST_BOT_CLIENT_ID && process.env.TEST_BOT_TOKEN) {
    return [
      {
        ownerId: process.env.TEST_OWNER_ID,
        clientId: process.env.TEST_BOT_CLIENT_ID,
        token: process.env.TEST_BOT_TOKEN
      }
    ];
  }

  return [];
}

function findConfiguredTestBot(registration) {
  return getConfiguredTestBots().find((bot) => {
    const sameServer = !bot.serverId || bot.serverId === registration.serverId;
    return sameServer && bot.ownerId === registration.ownerId && bot.clientId === registration.clientId;
  }) || null;
}

function getTestBotStatus(clientId) {
  return testBotStatuses.get(clientId) || "offline";
}

function ensureRegistry() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(registryPath)) {
    fs.writeFileSync(registryPath, "{}\n", "utf8");
  }
}

function readRegistry() {
  ensureRegistry();

  try {
    return JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch {
    return {};
  }
}

function writeRegistry(registry) {
  ensureRegistry();
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function readJsonFile(filePath, fallback) {
  ensureRegistry();

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  ensureRegistry();
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readFiveMFacStore() {
  const store = readJsonFile(fivemFacPath, { guilds: {} });
  if (!store.guilds || typeof store.guilds !== "object") {
    store.guilds = {};
  }
  return store;
}

function getFiveMGuildStore(store, guildId) {
  if (!store.guilds[guildId]) {
    store.guilds[guildId] = {
      tokens: {},
      users: {}
    };
  }

  if (!store.guilds[guildId].tokens) {
    store.guilds[guildId].tokens = {};
  }

  if (!store.guilds[guildId].users) {
    store.guilds[guildId].users = {};
  }

  return store.guilds[guildId];
}

function hasFiveMFacAccess(guildId, userId) {
  if (!guildId || !userId) {
    return false;
  }

  const store = readFiveMFacStore();
  const guildStore = getFiveMGuildStore(store, guildId);
  return guildStore.users[userId]?.access === true;
}

function findFiveMFacTokenEntry(store, guildId, token, userId) {
  const guildStore = getFiveMGuildStore(store, guildId);
  const localRecord = guildStore.tokens[token];

  if (localRecord) {
    return { sourceGuildId: guildId, record: localRecord };
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

    const entry = { sourceGuildId: candidateGuildId, record: candidateRecord };

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

function isFiveMFacTokenActivatedForUser(entry, guildId, token, userId, userData) {
  if (!entry?.record || entry.record.status !== "used" || entry.record.usedBy !== userId || userData?.access !== true) {
    return false;
  }

  return entry.sourceGuildId === guildId || userData.token === token;
}

function activateFiveMFacToken(guildId, userId, token) {
  const store = readFiveMFacStore();
  const guildStore = getFiveMGuildStore(store, guildId);
  const tokenEntry = findFiveMFacTokenEntry(store, guildId, token, userId);
  const tokenData = tokenEntry?.record;
  const userData = guildStore.users[userId];

  if (isFiveMFacTokenActivatedForUser(tokenEntry, guildId, token, userId, userData)) {
    return { ok: true };
  }

  if (!tokenData || tokenData.status !== "available") {
    return { ok: false, message: "Token invalido ou ja utilizado." };
  }

  if (tokenData.createdForUserId && tokenData.createdForUserId !== userId) {
    return { ok: false, message: "Este codigo de ativacao pertence a outro usuario." };
  }

  const now = new Date().toISOString();
  tokenData.status = "used";
  tokenData.usedBy = userId;
  tokenData.usedAt = now;

  if (tokenEntry?.sourceGuildId && tokenEntry.sourceGuildId !== guildId) {
    guildStore.tokens[token] = {
      ...tokenData,
      sourceGuildId: tokenEntry.sourceGuildId,
      usedBy: userId,
      usedAt: now
    };
  }

  guildStore.users[userId] = {
    access: true,
    token,
    activatedAt: now,
    config: guildStore.users[userId]?.config || {}
  };

  writeJsonFile(fivemFacPath, store);
  return { ok: true };
}

function saveFiveMFacActivation(guild, user, channel, panelMessage) {
  const store = readFiveMFacStore();
  const guildStore = getFiveMGuildStore(store, guild.id);
  const previousUser = guildStore.users[user.id] || {};
  const now = new Date().toISOString();

  guildStore.users[user.id] = {
    ...previousUser,
    access: true,
    activatedAt: previousUser.activatedAt || now,
    config: {
      ...(previousUser.config || {}),
      panel: {
        channelId: channel.id,
        channelName: channel.name,
        messageId: panelMessage.id,
        activatedAt: now,
        activatedBy: {
          id: user.id,
          tag: user.tag,
          username: user.username,
          globalName: user.globalName || null,
          avatarUrl: user.displayAvatarURL()
        },
        guild: {
          id: guild.id,
          name: guild.name
        }
      }
    }
  };

  writeJsonFile(fivemFacPath, store);
  return guildStore.users[user.id].config.panel;
}

function getFiveMWelcomeConfig(guildId) {
  const store = readFiveMFacStore();
  const guildStore = getFiveMGuildStore(store, guildId);
  return guildStore.welcome || {};
}

function saveFiveMWelcomeConfig(guild, user, patch) {
  const store = readFiveMFacStore();
  const guildStore = getFiveMGuildStore(store, guild.id);
  const previous = guildStore.welcome || {};
  const now = new Date().toISOString();

  guildStore.welcome = {
    ...previous,
    ...patch,
    updatedAt: now,
    updatedBy: {
      id: user.id,
      tag: user.tag,
      username: user.username,
      globalName: user.globalName || null,
      avatarUrl: user.displayAvatarURL()
    },
    guild: {
      id: guild.id,
      name: guild.name
    }
  };

  writeJsonFile(fivemFacPath, store);
  return guildStore.welcome;
}

function createHierarchyLevelId(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || `nivel-${Date.now()}`;
}

function getFiveMHierarchyConfig(guildId) {
  const store = readFiveMFacStore();
  const guildStore = getFiveMGuildStore(store, guildId);

  if (!guildStore.hierarchy) {
    guildStore.hierarchy = {
      levels: [
        { id: "lider", name: "Lider", roleId: null },
        { id: "gerente", name: "Gerente", roleId: null },
        { id: "gerente-de-acao", name: "Gerente de Acao", roleId: null }
      ],
      panel: null
    };
    writeJsonFile(fivemFacPath, store);
  }

  return guildStore.hierarchy;
}

function saveFiveMHierarchyConfig(guild, user, patch) {
  const store = readFiveMFacStore();
  const guildStore = getFiveMGuildStore(store, guild.id);
  const previous = getFiveMHierarchyConfig(guild.id);
  const now = new Date().toISOString();

  guildStore.hierarchy = {
    ...previous,
    ...patch,
    updatedAt: now,
    updatedBy: {
      id: user.id,
      tag: user.tag,
      username: user.username,
      globalName: user.globalName || null,
      avatarUrl: user.displayAvatarURL()
    },
    guild: {
      id: guild.id,
      name: guild.name
    }
  };

  writeJsonFile(fivemFacPath, store);
  return guildStore.hierarchy;
}

function upsertFiveMHierarchyLevel(guild, user, level) {
  const config = getFiveMHierarchyConfig(guild.id);
  const levels = [...config.levels];
  const index = levels.findIndex((item) => item.id === level.id);

  if (index >= 0) {
    levels[index] = { ...levels[index], ...level };
  } else {
    levels.push(level);
  }

  return saveFiveMHierarchyConfig(guild, user, { levels });
}

function checkFiveMFacTokenAvailable(guildId, token, userId = null) {
  const store = readFiveMFacStore();
  const guildStore = getFiveMGuildStore(store, guildId);
  const tokenEntry = userId
    ? findFiveMFacTokenEntry(store, guildId, token, userId)
    : guildStore.tokens[token]
      ? { sourceGuildId: guildId, record: guildStore.tokens[token] }
      : null;
  const tokenData = tokenEntry?.record;
  const userData = userId ? guildStore.users[userId] : null;

  if (isFiveMFacTokenActivatedForUser(tokenEntry, guildId, token, userId, userData)) {
    return { ok: true };
  }

  if (!tokenData || tokenData.status !== "available") {
    return {
      ok: false,
      message: "Codigo de ativacao invalido ou ja utilizado para este servidor."
    };
  }

  if (tokenData.createdForUserId && tokenData.createdForUserId !== userId) {
    return {
      ok: false,
      message: "Este codigo de ativacao pertence a outro usuario."
    };
  }

  return { ok: true };
}

function saveRegistration(discordUserId, registration) {
  const registry = readRegistry();
  registry[discordUserId] = {
    ...registration,
    updatedAt: new Date().toISOString()
  };
  writeRegistry(registry);
}

function getRegistration(discordUserId) {
  return readRegistry()[discordUserId] || null;
}

function validateSnowflake(value, label) {
  const normalized = value.trim();
  const match = normalized.match(/\d{17,20}/);

  if (!match) {
    return {
      ok: false,
      message: `${label} precisa ser o numero do Discord, com 17 a 20 digitos. Exemplo: 123456789012345678.`
    };
  }

  return { ok: true, value: match[0] };
}

async function startTestBot(testConfig) {
  const existingClient = testBotClients.get(testConfig.clientId);

  if (existingClient?.isReady()) {
    return "O bot do cliente ja esta online.";
  }

  if (!testConfig.ownerId || !testConfig.clientId || !testConfig.token) {
    return "A hospedagem ainda nao tem ownerId, clientId e token configurados para esse usuario.";
  }

  const testBotClient = new Client({
    intents: [GatewayIntentBits.Guilds]
  });

  testBotClient.once(Events.ClientReady, (client) => {
    testBotStatuses.set(testConfig.clientId, `online como ${client.user.tag}`);
    console.log(`Bot do cliente online: ${client.user.tag}`);
  });

  testBotClient.on(Events.Error, (error) => {
    testBotStatuses.set(testConfig.clientId, "erro");
    console.error("Erro no bot do cliente:", error.message);
  });

  try {
    await testBotClient.login(testConfig.token);

    if (testBotClient.user.id !== testConfig.clientId) {
      const loggedClientId = testBotClient.user.id;
      await testBotClient.destroy();
      testBotClients.delete(testConfig.clientId);
      testBotStatuses.set(testConfig.clientId, "client id diferente");
      return `O token configurado pertence ao bot ${loggedClientId}, mas o TEST_BOT_CLIENT_ID configurado e ${testConfig.clientId}.`;
    }

    testBotClients.set(testConfig.clientId, testBotClient);
    return "Bot do cliente iniciado com sucesso.";
  } catch (error) {
    testBotClients.delete(testConfig.clientId);
    testBotStatuses.set(testConfig.clientId, "erro ao iniciar");
    return `Nao foi possivel iniciar o bot do cliente: ${error.message}`;
  }
}

function maskToken(token) {
  if (!token) {
    return "";
  }

  if (token.length <= 8) {
    return "********";
  }

  return `${token.slice(0, 4)}********${token.slice(-4)}`;
}

async function callUserBotsApi(pathname, options = {}) {
  const url = new URL(pathname, config.apiPublicUrl);
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

function isPanelAdmin(userId) {
  return config.panelAdminIds.includes(userId);
}

function canAccessFiveMFac(guildId, userId) {
  return isPanelAdmin(userId) || hasFiveMFacAccess(guildId, userId);
}

function buildV2Panel(lines, row, options = {}) {
  const container = new ContainerBuilder();

  if (options.imageName) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${options.imageName}`)
      )
    );
  }

  if (options.imageUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(options.imageUrl)
      )
    );
  }

  container
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines.join("\n"))
    )
    .addSeparatorComponents(new SeparatorBuilder());

  const rows = Array.isArray(row) ? row : [row];
  for (const actionRow of rows) {
    container.addActionRowComponents(actionRow);
  }

  const message = {
    components: [container],
    flags: options.ephemeral === false ? publicComponentsV2Flags : ephemeralComponentsV2Flags
  };

  if (options.imagePath && options.imageName) {
    message.files = [
      new AttachmentBuilder(options.imagePath, { name: options.imageName })
    ];
  }

  return message;
}

function buildMemberWelcomePanel(member, template, context) {
  const avatarUrl = member.user.displayAvatarURL({ size: 256 });
  const container = new ContainerBuilder()
    .setAccentColor(0xf5d142)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent([
            `### ${renderWelcomeTemplate(template.entryTitle, context)}`,
            `${context.user} entrou no servidor!`,
            "",
            renderWelcomeTemplate(template.entryMessage, context)
          ].join("\n")),
          new TextDisplayBuilder().setContent([
            "**Usuario**",
            context.username,
            "",
            "**Primeiro passo**",
            context.firstStep,
            "",
            context.joinedAt
          ].join("\n"))
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(avatarUrl)
            .setDescription(`Avatar de ${context.username}`)
        )
    );

  return {
    components: [container],
    flags: publicComponentsV2Flags
  };
}

function buildHostingTutorialPanel() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("bot:register")
      .setLabel("Cadastrar bot")
      .setStyle(ButtonStyle.Success)
  );

  return buildV2Panel([
    "## Tutorial: cadastrar seu bot na hospedagem",
    "1. Entre no Discord Developer Portal e abra o aplicativo do bot do cliente.",
    "2. Em General Information, copie o Application ID. Ele sera usado como Client ID.",
    "3. Em Bot, clique em Reset Token e copie o token do bot.",
    "4. Convide esse bot para o servidor do cliente com bot e applications.commands.",
    "5. Pegue o ID do servidor do cliente onde o bot vai funcionar.",
    "6. Clique em Cadastrar bot e informe somente: Client ID, ID do servidor, Chave Orvitek e Token do bot.",
    "7. Depois informe o codigo de ativacao de 4 digitos e confirme o cadastro.",
    "",
    "O ID de Discord do dono e detectado automaticamente por quem clicou no botao. Nunca envie token em chat aberto."
  ], row, {
    imagePath: panelImagePath,
    imageName: panelImageName,
    ephemeral: false
  });
}

function buildManagementToolsPanel() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("management:fivem-fac")
      .setLabel("fac FiveM")
      .setStyle(ButtonStyle.Primary)
  );

  return buildV2Panel([
    "## Painel gerenciar",
    "Escolha uma ferramenta para configurar regras e funcoes.",
    "",
    "A ferramenta fac FiveM sera usada para as regras de faccao FiveM."
  ], row);
}

function buildFiveMFacAccessPanel() {
  const accessRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("fivem-fac:use-token")
      .setLabel("Informar codigo")
      .setStyle(ButtonStyle.Primary)
  );

  return buildV2Panel([
    "## fac FiveM",
    "Essa ferramenta precisa do codigo de acesso de 4 digitos.",
    "",
    "Informe aqui o codigo gerado quando voce comprou e ativou o bot no painel de hospedagem.",
    "Cada servidor Discord tem seus proprios tokens, acessos e configuracoes.",
    "Usar o codigo aqui libera somente o painel fac FiveM para voce neste servidor."
  ], accessRow);
}

function buildFiveMFacPanel(guildId, userId) {
  const store = readFiveMFacStore();
  const guildStore = getFiveMGuildStore(store, guildId);
  const userConfig = guildStore.users[userId]?.config || {};
  const panelConfig = userConfig.panel;

  const lines = [
    "## fac FiveM",
    "Painel liberado por token.",
    "",
    `Servidor configurado: ${guildId}`,
    `Usuario configurando: <@${userId}>`,
    `Regras cadastradas: ${Array.isArray(userConfig.rules) ? userConfig.rules.length : 0}`,
    panelConfig?.channelId ? `Painel fac fixado em: <#${panelConfig.channelId}>` : "Painel fac ainda nao ativado."
  ];

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("fivem-fac:activate")
      .setLabel(panelConfig?.channelId ? "Alterar canal" : "Ativar")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("management:back")
      .setLabel("Voltar")
      .setStyle(ButtonStyle.Secondary)
  );

  return buildV2Panel(lines, row);
}

function buildFiveMFacChannelPanel() {
  const row = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("fivem-fac:channel-select")
      .setPlaceholder("Escolha o canal do Painel fac")
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
  );

  return buildV2Panel([
    "## Ativar Painel fac",
    "Escolha o canal de texto onde o Painel fac vai ficar fixo."
  ], row);
}

function buildFixedFiveMFacPanel(guildId, userId) {
  return buildV2Panel([
    "## Painel fac",
    `Servidor: ${guildId}`,
    `Responsavel: <@${userId}>`,
    "",
    "Selecione a ferramenta que deseja usar."
  ], new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("fivem-fac:tool-select")
      .setPlaceholder("Escolha uma ferramenta")
      .addOptions([
        {
          label: "Boas vindas",
          description: "Configurar entrada, saida, DM e banner.",
          value: "welcome"
        },
        {
          label: "Hierarquia",
          description: "Configurar cargos e painel automatico.",
          value: "hierarchy"
        }
      ])
  ), { ephemeral: false });
}

function buildWelcomePanel(guildId) {
  const config = getFiveMWelcomeConfig(guildId);
  const template = resolveWelcomeTemplate(config);
  const lines = [
    "## Boas vindas",
    config.entryChannelId ? `Canal de entrada: <#${config.entryChannelId}>` : "Canal de entrada: nao configurado",
    config.exitChannelId ? `Canal de saida: <#${config.exitChannelId}>` : "Canal de saida: nao configurado",
    config.bannerUrl ? "Banner de boas vindas: configurado" : "Banner de boas vindas: nao configurado",
    config.enabled || config.confirmedAt || config.entryChannelId || config.exitChannelId ? "Status: modelo ativo." : "Status: modelo ainda nao configurado.",
    "",
    `Modelo de entrada: ${compactTemplatePreview(template.entryMessage)}`,
    `Modelo de saida: ${compactTemplatePreview(template.exitMessage)}`
  ];

  const entryRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("welcome:entry-channel")
      .setPlaceholder("Escolha o canal de entrada")
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const exitRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("welcome:exit-channel")
      .setPlaceholder("Escolha o canal de saida")
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("welcome:banner")
      .setLabel("Banner de boas vindas")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("welcome:back")
      .setLabel("Voltar")
      .setStyle(ButtonStyle.Secondary)
  );

  return buildV2Panel(lines, [entryRow, exitRow, buttonRow], bannerImageOptions(config));
}

function buildHierarchyConfigPanel(guildId) {
  const config = getFiveMHierarchyConfig(guildId);
  const lines = [
    "## Hierarquia da fac",
    config.panel?.channelId ? `Painel publicado em: <#${config.panel.channelId}>` : "Painel ainda nao publicado.",
    "",
    ...config.levels.map((level, index) => `${index + 1}. ${level.name}: ${level.roleId ? `<@&${level.roleId}>` : "cargo nao configurado"}`)
  ];

  const levelOptions = config.levels.slice(0, 24).map((level) => ({
    label: level.name.slice(0, 100),
    description: level.roleId ? `Cargo ${level.roleId}` : "Selecionar cargo deste nivel",
    value: level.id
  }));

  levelOptions.push({
    label: "Adicionar nivel",
    description: "Criar outra hierarquia com cargo proprio",
    value: "__add"
  });

  const levelRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("hierarchy:level-select")
      .setPlaceholder("Editar nivel ou adicionar")
      .addOptions(levelOptions)
  );

  const channelRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("hierarchy:panel-channel")
      .setPlaceholder("Escolha o canal do painel de hierarquia")
      .setChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("hierarchy:preview")
      .setLabel("Ver painel")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("hierarchy:back")
      .setLabel("Voltar")
      .setStyle(ButtonStyle.Secondary)
  );

  return buildV2Panel(lines, [levelRow, channelRow, buttonRow]);
}

function buildHierarchyRolePanel(level) {
  const row = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(`hierarchy:role-select:${level.id}`)
      .setPlaceholder(`Escolha o cargo de ${level.name}`)
      .setMinValues(1)
      .setMaxValues(1)
  );

  return buildV2Panel([
    "## Cargo da hierarquia",
    `Nivel: ${level.name}`,
    level.roleId ? `Cargo atual: <@&${level.roleId}>` : "Cargo atual: nao configurado"
  ], row);
}

function buildAddHierarchyLevelModal() {
  const nameInput = new TextInputBuilder()
    .setCustomId("name")
    .setLabel("Nome da hierarquia")
    .setPlaceholder("Ex: Soldado")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(50);

  return new ModalBuilder()
    .setCustomId("modal:hierarchy-add-level")
    .setTitle("Adicionar hierarquia")
    .addComponents(
      new ActionRowBuilder().addComponents(nameInput)
    );
}

async function buildHierarchyPublicPanel(guild) {
  const config = getFiveMHierarchyConfig(guild.id);
  const lines = [
    "## Hierarquia da Fac",
    "Painel automatico de cargos da faccao.",
    "Quando alguem recebe ou perde um cargo configurado, este painel e atualizado."
  ];

  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const assignedLevelByMember = new Map();

  for (const member of members.values()) {
    const matchedLevel = config.levels.find((level) => level.roleId && member.roles.cache.has(level.roleId));
    if (matchedLevel) {
      assignedLevelByMember.set(member.id, matchedLevel.id);
    }
  }

  for (const level of config.levels) {
    lines.push("", `**${level.name}**`, `Cargo(s): ${level.roleId ? `<@&${level.roleId}>` : "Cargo nao configurado"}`);

    if (!level.roleId) {
      lines.push("Nenhum membro com esse cargo.");
      continue;
    }

    const levelMembers = [...members.values()]
      .filter((member) => assignedLevelByMember.get(member.id) === level.id)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"))
      .slice(0, 30);

    if (levelMembers.length === 0) {
      lines.push("Nenhum membro com esse cargo.");
      continue;
    }

    for (const [index, member] of levelMembers.entries()) {
      lines.push(`${index + 1}. <@${member.id}>`);
    }
  }

  lines.push("", `Atualizado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`);
  return buildV2Panel(lines, new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("hierarchy:refresh")
      .setLabel("Atualizar")
      .setStyle(ButtonStyle.Primary)
  ), { ephemeral: false });
}

function buildFiveMTokenModal() {
  const tokenInput = new TextInputBuilder()
    .setCustomId("token")
    .setLabel("Token de acesso")
    .setPlaceholder("Digite os 4 digitos")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(4);

  return new ModalBuilder()
    .setCustomId("modal:fivem-fac-token")
    .setTitle("Liberar fac FiveM")
    .addComponents(
      new ActionRowBuilder().addComponents(tokenInput)
    );
}

async function handleManagerCommand(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Use esse painel dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
    await interaction.reply(buildFiveMFacPanel(interaction.guildId, interaction.user.id));
    return;
  }

  await interaction.reply(buildManagementToolsPanel());
}

async function handleFiveMFacEntry(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Use essa ferramenta dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
    await interaction.update(buildFiveMFacPanel(interaction.guildId, interaction.user.id));
    return;
  }

  await interaction.update(buildFiveMFacAccessPanel());
}

async function handleFiveMFacTokenSubmit(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Use essa ferramenta dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  const token = interaction.fields.getTextInputValue("token").trim();

  if (!/^\d{4}$/.test(token)) {
    await interaction.reply({ content: "O token precisa ter exatamente 4 digitos.", flags: MessageFlags.Ephemeral });
    return;
  }

  const result = activateFiveMFacToken(interaction.guildId, interaction.user.id, token);

  if (!result.ok) {
    await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply(buildFiveMFacPanel(interaction.guildId, interaction.user.id));
}

async function handleFiveMFacActivate(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Use essa ferramenta dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
    await interaction.reply({ content: "Informe o codigo de ativacao antes de ativar o painel.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply(buildFiveMFacChannelPanel());
}

async function handleFiveMFacChannelSelect(interaction) {
  if (!interaction.guild || !interaction.guildId) {
    await interaction.reply({ content: "Use essa ferramenta dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
    await interaction.reply({ content: "Informe o codigo de ativacao antes de ativar o painel.", flags: MessageFlags.Ephemeral });
    return;
  }

  const channelId = interaction.values[0];
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);

  if (!channel || typeof channel.send !== "function") {
    await interaction.reply({ content: "Nao consegui enviar mensagens nesse canal. Confira as permissoes do bot.", flags: MessageFlags.Ephemeral });
    return;
  }

  const panelMessage = await channel.send(buildFixedFiveMFacPanel(interaction.guildId, interaction.user.id)).catch(() => null);

  if (!panelMessage) {
    await interaction.reply({ content: "Nao consegui fixar o Painel fac nesse canal. Confira as permissoes do bot.", flags: MessageFlags.Ephemeral });
    return;
  }

  await panelMessage.pin("Painel fac FiveM fixo").catch(() => undefined);

  saveFiveMFacActivation(interaction.guild, interaction.user, channel, panelMessage);
  await interaction.update(buildFiveMFacPanel(interaction.guildId, interaction.user.id));
}

function isImageAttachment(attachment) {
  return Boolean(
    attachment?.contentType?.startsWith("image/")
    || /\.(png|jpe?g|gif|webp)$/i.test(attachment?.name || attachment?.url || "")
  );
}

const defaultWelcomeTemplate = {
  entryTitle: "Novo membro na comunidade",
  entryMessage: "Seja bem-vindo. Faca a verificacao, leia as regras e use os tickets somente quando precisar de atendimento.",
  dmMessage: "Bem-vindo(a) ao servidor {server}, {username}! Que sua chegada seja tranquila por aqui.",
  exitTitle: "Ate logo, {username}",
  exitMessage: "{user} saiu de **{server}**.\nUsuario: {tag} | ID: {id}"
};

const legacyWelcomeTemplate = {
  entryTitle: "Boas vindas",
  entryMessage: "Seja bem-vindo(a), {user}! Voce entrou em {server}.\nAgora somos {memberCount} membros.",
  dmMessage: "Bem-vindo(a) ao servidor {server}, {username}! Que sua chegada seja tranquila por aqui.",
  exitTitle: "Saida do servidor",
  exitMessage: "{user} saiu do servidor {server}.\nUsuario: {tag} | ID: {id}"
};

const welcomePlaceholderAliases = {
  id: "id",
  user: "user",
  usuario: "user",
  mention: "mention",
  mencao: "mention",
  username: "username",
  nome: "username",
  tag: "tag",
  server: "server",
  servidor: "server",
  memberCount: "memberCount",
  membros: "memberCount",
  firstStep: "firstStep",
  primeiroPasso: "firstStep",
  joinedAt: "joinedAt",
  data: "joinedAt"
};

function valueOrDefault(value, fallback, legacy) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  return legacy && value === legacy ? fallback : value;
}

function resolveWelcomeTemplate(config = {}) {
  return {
    entryTitle: valueOrDefault(config.entryTitle, defaultWelcomeTemplate.entryTitle, legacyWelcomeTemplate.entryTitle),
    entryMessage: valueOrDefault(config.entryMessage, defaultWelcomeTemplate.entryMessage, legacyWelcomeTemplate.entryMessage),
    dmMessage: valueOrDefault(config.dmMessage, defaultWelcomeTemplate.dmMessage, legacyWelcomeTemplate.dmMessage),
    exitTitle: valueOrDefault(config.exitTitle, defaultWelcomeTemplate.exitTitle, legacyWelcomeTemplate.exitTitle),
    exitMessage: valueOrDefault(config.exitMessage, defaultWelcomeTemplate.exitMessage, legacyWelcomeTemplate.exitMessage)
  };
}

function renderWelcomeTemplate(template, context) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, key) => {
    const contextKey = welcomePlaceholderAliases[key];
    return contextKey ? context[contextKey] : match;
  });
}

function normalizeChannelName(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function findWelcomeFirstStep(guild) {
  const preferredNames = [
    "verificar-acesso",
    "verificacao",
    "verificar",
    "regras",
    "ticket",
    "tickets"
  ];
  const channel = guild.channels.cache.find((item) => {
    if (!("name" in item) || typeof item.name !== "string") {
      return false;
    }

    const normalized = normalizeChannelName(item.name);
    return preferredNames.some((name) => normalized.includes(name));
  });

  return channel ? `<#${channel.id}>` : "`#` `✅` verificar-acesso";
}

function formatWelcomeDate(date = new Date()) {
  return date
    .toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    })
    .replace(",", "");
}

function buildWelcomeTemplateContext(member) {
  return {
    id: member.id,
    user: `<@${member.id}>`,
    mention: `<@${member.id}>`,
    username: member.displayName || member.user.username,
    tag: member.user.tag,
    server: member.guild.name,
    memberCount: String(member.guild.memberCount),
    firstStep: findWelcomeFirstStep(member.guild),
    joinedAt: formatWelcomeDate()
  };
}

function compactTemplatePreview(template) {
  return template.replace(/\s+/g, " ").trim();
}

function sanitizeImageFileName(name, fallback) {
  const cleaned = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return cleaned || fallback;
}

function bannerRelativePath(guildId, userId, scope, fileName) {
  return path.join("data", "fivem-fac-banners", guildId, userId, `${scope}-${fileName}`);
}

function bannerImageOptions(config = {}) {
  const localPath = typeof config.bannerLocalPath === "string"
    ? path.resolve(process.cwd(), config.bannerLocalPath)
    : null;
  const imageName = typeof config.bannerAttachmentName === "string"
    ? config.bannerAttachmentName
    : localPath
      ? path.basename(localPath)
      : null;

  if (localPath && imageName && fs.existsSync(localPath)) {
    return {
      imagePath: localPath,
      imageName
    };
  }

  if (typeof config.bannerUrl === "string" && !config.bannerUrl.includes("/ephemeral-attachments/")) {
    return { imageUrl: config.bannerUrl };
  }

  return {};
}

async function persistImageAttachment(guildId, userId, scope, attachment) {
  const fileName = sanitizeImageFileName(attachment.name || "banner.png", `${scope}-banner.png`);
  const relativePath = bannerRelativePath(guildId, userId, scope, fileName);
  const absolutePath = path.resolve(process.cwd(), relativePath);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error("Nao foi possivel baixar a imagem enviada.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(absolutePath, buffer);

  return {
    bannerUrl: attachment.url,
    bannerName: attachment.name || "banner",
    bannerLocalPath: relativePath,
    bannerAttachmentName: fileName
  };
}

function claimMemberEvent(guildId, userId, memberId, type, ttlMs = 15_000) {
  const dir = path.join(process.cwd(), "data", "fivem-fac-event-locks", guildId, userId);
  const filePath = path.join(dir, `${type}-${memberId}.lock`);

  fs.mkdirSync(dir, { recursive: true });

  try {
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs < ttlMs) {
      return false;
    }

    fs.unlinkSync(filePath);
  } catch {
    // Lock ausente ou antigo removido.
  }

  try {
    const fd = fs.openSync(filePath, "wx");
    fs.writeFileSync(fd, new Date().toISOString());
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

async function handleWelcomeChannelSelect(interaction, type) {
  if (!interaction.guild || !interaction.guildId) {
    await interaction.reply({ content: "Use essa ferramenta dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
    await interaction.reply({ content: "Voce ainda nao tem acesso ao painel fac FiveM neste servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  const channelId = interaction.values[0];
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);

  if (!channel || typeof channel.send !== "function") {
    await interaction.reply({ content: "Nao consegui usar esse canal. Confira as permissoes do bot.", flags: MessageFlags.Ephemeral });
    return;
  }

  const patch = type === "entry"
    ? { entryChannelId: channel.id, entryChannelName: channel.name }
    : { exitChannelId: channel.id, exitChannelName: channel.name };
  const template = resolveWelcomeTemplate(getFiveMWelcomeConfig(interaction.guildId));

  saveFiveMWelcomeConfig(interaction.guild, interaction.user, {
    ...template,
    ...patch,
    enabled: true,
    confirmedAt: new Date().toISOString()
  });
  await interaction.update(buildWelcomePanel(interaction.guildId));
}

async function handleWelcomeBannerRequest(interaction) {
  if (!interaction.guildId || !canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
    await interaction.reply({ content: "Voce ainda nao tem acesso ao painel fac FiveM neste servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  pendingWelcomeBannerUploads.set(`${interaction.guildId}:${interaction.user.id}`, {
    channelId: interaction.channelId,
    expiresAt: Date.now() + 2 * 60 * 1000
  });

  await interaction.reply({
    content: "Envie a imagem do banner neste canal em ate 2 minutos. O bot vai salvar a primeira imagem anexada por voce.",
    flags: MessageFlags.Ephemeral
  });
}

async function handlePendingWelcomeBannerUpload(message) {
  if (message.author.bot || !message.guild) {
    return false;
  }

  const key = `${message.guild.id}:${message.author.id}`;
  const pending = pendingWelcomeBannerUploads.get(key);

  if (!pending) {
    return false;
  }

  if (pending.expiresAt <= Date.now()) {
    pendingWelcomeBannerUploads.delete(key);
    return false;
  }

  if (pending.channelId !== message.channelId) {
    return false;
  }

  const attachment = message.attachments.find((item) => isImageAttachment(item));
  if (!attachment) {
    await message.reply("Envie uma imagem valida como anexo para usar como banner de boas vindas.").catch(() => undefined);
    return true;
  }

  let storedImage;
  try {
    storedImage = await persistImageAttachment(message.guild.id, message.author.id, "welcome", attachment);
  } catch {
    await message.reply("Nao consegui salvar essa imagem. Tente enviar outro arquivo.").catch(() => undefined);
    return true;
  }

  saveFiveMWelcomeConfig(message.guild, message.author, {
    ...storedImage,
    bannerUpdatedAt: new Date().toISOString()
  });
  pendingWelcomeBannerUploads.delete(key);

  await message.reply("Banner de boas vindas salvo. Abra o Painel fac para ver a ferramenta atualizada.").catch(() => undefined);
  return true;
}

async function sendWelcomeMessage(member) {
  const config = getFiveMWelcomeConfig(member.guild.id);
  const active = config.enabled === true || Boolean(config.confirmedAt || config.entryChannelId);

  if (!active) {
    return;
  }

  if (!claimMemberEvent(member.guild.id, "_panel", member.id, "welcome")) {
    return;
  }

  const template = resolveWelcomeTemplate(config);
  const context = buildWelcomeTemplateContext(member);
  const dmContent = renderWelcomeTemplate(template.dmMessage, context);
  const dmPayload = buildV2Panel([dmContent], [], {
    ephemeral: false,
    ...bannerImageOptions(config)
  });

  await member.send(dmPayload).catch(() => undefined);

  if (config.entryChannelId) {
    const channel = await member.guild.channels.fetch(config.entryChannelId).catch(() => null);
    if (channel && typeof channel.send === "function") {
      const payload = buildMemberWelcomePanel(member, template, context);

      await channel.send({
        ...payload,
        allowedMentions: { users: [member.id] },
      }).catch(() => undefined);
    }
  }
}

async function sendExitMessage(member) {
  const config = getFiveMWelcomeConfig(member.guild.id);
  const channelId = config.exitChannelId || config.entryChannelId;

  if (!channelId) {
    console.log(`[fac-welcome] saida ignorada sem canal guildId=${member.guild.id} userId=_panel`);
    return;
  }

  const active = config.enabled === true || Boolean(config.confirmedAt || channelId);
  if (!active) {
    return;
  }

  const channel = await member.guild.channels.fetch(channelId).catch((error) => {
    console.error(`[fac-welcome] nao consegui buscar canal de saida guildId=${member.guild.id} channelId=${channelId}:`, error.message);
    return null;
  });
  if (!channel || typeof channel.send !== "function") {
    console.error(`[fac-welcome] canal de saida invalido guildId=${member.guild.id} channelId=${channelId}`);
    return;
  }

  if (!claimMemberEvent(member.guild.id, "_panel", member.id, "exit")) {
    return;
  }

  const template = resolveWelcomeTemplate(config);
  const context = buildWelcomeTemplateContext(member);
  const payload = buildV2Panel([
    `## ${renderWelcomeTemplate(template.exitTitle, context)}`,
    renderWelcomeTemplate(template.exitMessage, context)
  ], [], {
    ephemeral: false
  });

  const sent = await channel.send({
    ...payload,
    allowedMentions: { users: [member.id] }
  }).catch(() => undefined);

  if (!sent) {
    console.error(`[fac-welcome] falha ao enviar saida guildId=${member.guild.id} userId=_panel memberId=${member.id} channelId=${channelId}`);
  }
}

async function updateHierarchyPublicPanel(guild) {
  const config = getFiveMHierarchyConfig(guild.id);
  const panel = config.panel;

  if (!panel?.channelId || !panel.messageId) {
    return false;
  }

  const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
  if (!channel || typeof channel.messages?.fetch !== "function") {
    return false;
  }

  const message = await channel.messages.fetch(panel.messageId).catch(() => null);
  if (!message) {
    return false;
  }

  await message.edit(await buildHierarchyPublicPanel(guild)).catch(() => undefined);
  return true;
}

async function publishHierarchyPublicPanel(interaction, channel) {
  const panelMessage = await channel.send(await buildHierarchyPublicPanel(interaction.guild)).catch(() => null);

  if (!panelMessage) {
    await interaction.reply({ content: "Nao consegui publicar o painel de hierarquia nesse canal. Confira as permissoes do bot.", flags: MessageFlags.Ephemeral });
    return;
  }

  await panelMessage.pin("Painel de hierarquia da fac").catch(() => undefined);
  const config = getFiveMHierarchyConfig(interaction.guildId);
  saveFiveMHierarchyConfig(interaction.guild, interaction.user, {
    ...config,
    panel: {
      channelId: channel.id,
      channelName: channel.name,
      messageId: panelMessage.id,
      publishedAt: new Date().toISOString()
    }
  });

  await interaction.update(buildHierarchyConfigPanel(interaction.guildId));
}

async function handleHierarchyLevelSelect(interaction) {
  if (!interaction.guildId || !canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
    await interaction.reply({ content: "Voce ainda nao tem acesso ao painel fac FiveM neste servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  const selectedLevelId = interaction.values[0];
  if (selectedLevelId === "__add") {
    await interaction.showModal(buildAddHierarchyLevelModal());
    return;
  }

  const config = getFiveMHierarchyConfig(interaction.guildId);
  const level = config.levels.find((item) => item.id === selectedLevelId);

  if (!level) {
    await interaction.reply({ content: "Nivel nao encontrado.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply(buildHierarchyRolePanel(level));
}

async function handleHierarchyRoleSelect(interaction) {
  if (!interaction.guild || !interaction.guildId || !canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
    await interaction.reply({ content: "Voce ainda nao tem acesso ao painel fac FiveM neste servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  const levelId = interaction.customId.split(":").slice(2).join(":");
  const roleId = interaction.values[0];
  const config = getFiveMHierarchyConfig(interaction.guildId);
  const level = config.levels.find((item) => item.id === levelId);

  if (!level) {
    await interaction.reply({ content: "Nivel nao encontrado.", flags: MessageFlags.Ephemeral });
    return;
  }

  upsertFiveMHierarchyLevel(interaction.guild, interaction.user, { ...level, roleId });
  await updateHierarchyPublicPanel(interaction.guild);
  await interaction.update(buildHierarchyConfigPanel(interaction.guildId));
}

async function handleHierarchyAddLevelSubmit(interaction) {
  if (!interaction.guild || !interaction.guildId || !canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
    await interaction.reply({ content: "Voce ainda nao tem acesso ao painel fac FiveM neste servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  const name = interaction.fields.getTextInputValue("name").trim();
  const config = getFiveMHierarchyConfig(interaction.guildId);
  let id = createHierarchyLevelId(name);
  let suffix = 2;

  while (config.levels.some((level) => level.id === id)) {
    id = `${createHierarchyLevelId(name)}-${suffix}`;
    suffix += 1;
  }

  const level = { id, name, roleId: null };
  upsertFiveMHierarchyLevel(interaction.guild, interaction.user, level);
  await interaction.reply(buildHierarchyRolePanel(level));
}

async function handleHierarchyPanelChannelSelect(interaction) {
  if (!interaction.guild || !interaction.guildId || !canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
    await interaction.reply({ content: "Voce ainda nao tem acesso ao painel fac FiveM neste servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);

  if (!channel || typeof channel.send !== "function") {
    await interaction.reply({ content: "Nao consegui enviar mensagens nesse canal. Confira as permissoes do bot.", flags: MessageFlags.Ephemeral });
    return;
  }

  await publishHierarchyPublicPanel(interaction, channel);
}

function buildRegisterModal(previous = {}, currentGuildId = null) {
  const clientInput = new TextInputBuilder()
    .setCustomId("clientId")
    .setLabel("Application ID / Client ID")
    .setPlaceholder("Numero do aplicativo no Developer Portal")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  if (previous.clientId) {
    clientInput.setValue(previous.clientId);
  }

  const serverInput = new TextInputBuilder()
    .setCustomId("serverId")
    .setLabel("ID do servidor")
    .setPlaceholder("Servidor onde o bot vai operar")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  if (previous.serverId || currentGuildId) {
    serverInput.setValue(previous.serverId || currentGuildId);
  }

  const accessKeyInput = new TextInputBuilder()
    .setCustomId("hostingAccessKey")
    .setLabel("Chave de acesso Orvitek")
    .setPlaceholder("Chave liberada apos pagamento")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  if (previous.hostingAccessKey) {
    accessKeyInput.setValue(previous.hostingAccessKey);
  }

  const tokenInput = new TextInputBuilder()
    .setCustomId("botToken")
    .setLabel("Token do bot")
    .setPlaceholder("Token copiado da aba Bot no Developer Portal")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(20)
    .setMaxLength(4000);

  if (previous.botToken) {
    tokenInput.setValue(previous.botToken);
  }

  return new ModalBuilder()
    .setCustomId("modal:bot-register")
    .setTitle("Cadastrar bot")
    .addComponents(
      new ActionRowBuilder().addComponents(clientInput),
      new ActionRowBuilder().addComponents(serverInput),
      new ActionRowBuilder().addComponents(accessKeyInput),
      new ActionRowBuilder().addComponents(tokenInput)
    );
}

function buildRegisterConfirmPanel(registration) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("bot:register-fivem-code")
      .setLabel(registration.fivemFacToken ? "Trocar codigo" : "Informar codigo")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("bot:register-correct")
      .setLabel("Corrigir")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("bot:register-confirm")
      .setLabel("Confirmar cadastro")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!registration.fivemFacToken)
  );

  return buildV2Panel([
    "## Confirmar cadastro do bot",
    `Client ID: ${registration.clientId}`,
    `ID do servidor: ${registration.serverId}`,
    `Chave Orvitek: ${registration.hostingAccessKey}`,
    `Codigo de ativacao: ${registration.fivemFacToken ? "validado" : "pendente"}`,
    `Token do bot: ${maskToken(registration.botToken)}`
  ], row);
}

function buildRegisterFiveMCodeModal() {
  const codeInput = new TextInputBuilder()
    .setCustomId("fivemFacToken")
    .setLabel("Codigo de ativacao")
    .setPlaceholder("Digite o codigo de 4 digitos")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(4);

  return new ModalBuilder()
    .setCustomId("modal:bot-register-fivem-code")
    .setTitle("Codigo de ativacao")
    .addComponents(
      new ActionRowBuilder().addComponents(codeInput)
    );
}

function botCanBeRegistered(bot) {
  const expiresAt = bot.planExpiresAt ? new Date(bot.planExpiresAt).getTime() : 0;
  const activePlan = bot.planStatus === "active" && expiresAt > Date.now();
  const paid = Boolean(bot.lastPaymentAt && bot.lastPaymentAmountCents && bot.lastPaymentAmountCents > 0);
  const released = bot.hostingAccessGranted === true || Boolean(bot.hostingAccessKey);
  const legacyActiveRegistration = bot.status === "online" && bot.planStatus !== "overdue" && !bot.planExpiresAt;

  return legacyActiveRegistration || (activePlan && paid && released);
}

function buildUserBotPickerPanel(bots) {
  const selectableBots = bots.filter(botCanBeRegistered).slice(0, 25);
  const manualRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("bot:register-manual")
      .setLabel("Preencher manualmente")
      .setStyle(ButtonStyle.Secondary)
  );

  const lines = selectableBots.length > 0 ? [
    "## Escolha o bot para cadastrar",
    "Encontrei liberacoes/cadastros no seu Discord.",
    "Selecione o bot que quer cadastrar para abrir o formulario ja preenchido."
  ] : [
    "## Nenhum bot liberado encontrado",
    "Nao encontrei bot pago/liberado no seu Discord.",
    "Use o preenchimento manual somente se a liberacao foi feita em outro ID."
  ];

  if (bots.length > selectableBots.length) {
    lines.push("", `Mostrando ${selectableBots.length} de ${bots.length} bots liberados.`);
  }

  if (selectableBots.length === 0) {
    return buildV2Panel(lines, manualRow);
  }

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("bot:register-select")
      .setPlaceholder("Escolha qual bot quer cadastrar")
      .addOptions(selectableBots.map((bot) => ({
        label: (bot.botUsername || `Bot ${bot.clientId}`).slice(0, 100),
        description: `Client ID ${bot.clientId}`.slice(0, 100),
        value: bot.clientId
      })))
  );

  return buildV2Panel(lines, [selectRow, manualRow]);
}

async function fetchUserRegisteredBots(userId) {
  const result = await callUserBotsApi("/api/user-bots", {
    headers: {
      "x-user-id": userId
    }
  });

  if (!result.ok || !result.data.success) {
    return {
      ok: false,
      message: result.data.message || "Nao foi possivel consultar seus cadastros."
    };
  }

  return {
    ok: true,
    bots: Array.isArray(result.data.bots) ? result.data.bots : []
  };
}

async function handleRegisterStart(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Use este painel dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await fetchUserRegisteredBots(interaction.user.id);

  if (!result.ok) {
    await interaction.editReply(result.message);
    return;
  }

  await interaction.editReply(buildUserBotPickerPanel(result.bots));
}

async function handleRegisterSelect(interaction) {
  const clientId = interaction.values[0];
  const result = await fetchUserRegisteredBots(interaction.user.id);

  if (!result.ok) {
    await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const bot = result.bots.find((item) => item.clientId === clientId);
  if (!bot || !botCanBeRegistered(bot)) {
    await interaction.reply({
      content: "Esse bot nao esta liberado para cadastro. Confirme pagamento e liberacao no bot principal.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.showModal(buildRegisterModal({
    ownerId: interaction.user.id,
    clientId: bot.clientId,
    serverId: bot.guildId,
    hostingAccessKey: bot.hostingAccessKey
  }, interaction.guildId));
}

function buildDeleteModal(previous = {}) {
  const ownerInput = new TextInputBuilder()
    .setCustomId("ownerId")
    .setLabel("ID de Discord")
    .setPlaceholder("Ex: 123456789012345678")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  if (previous.ownerId) {
    ownerInput.setValue(previous.ownerId);
  }

  const clientInput = new TextInputBuilder()
    .setCustomId("clientId")
    .setLabel("Application ID / Client ID")
    .setPlaceholder("Numero do bot que sera removido")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  if (previous.clientId) {
    clientInput.setValue(previous.clientId);
  }

  return new ModalBuilder()
    .setCustomId("modal:bot-delete")
    .setTitle("Delete Bot")
    .addComponents(
      new ActionRowBuilder().addComponents(ownerInput),
      new ActionRowBuilder().addComponents(clientInput)
    );
}

function buildDeleteConfirmPanel(registration) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("bot:delete-correct")
      .setLabel("Correct")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("bot:delete-confirm")
      .setLabel("Confirm Delete")
      .setStyle(ButtonStyle.Danger)
  );

  return buildV2Panel([
    "## Confirm bot deletion",
    `ID de Discord: ${registration.ownerId}`,
    `Client ID: ${registration.clientId}`
  ], row);
}

async function handleRegisterSubmit(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Use este painel dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  const clientId = validateSnowflake(interaction.fields.getTextInputValue("clientId"), "ID do cliente");
  const serverId = validateSnowflake(interaction.fields.getTextInputValue("serverId"), "ID do servidor dos comandos");
  const hostingAccessKey = interaction.fields.getTextInputValue("hostingAccessKey").trim();
  const botToken = interaction.fields.getTextInputValue("botToken").trim();

  if (!clientId.ok) {
    await interaction.reply({ content: clientId.message, flags: MessageFlags.Ephemeral });
    return;
  }

  if (!serverId.ok) {
    await interaction.reply({ content: serverId.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const previousRegistration = pendingBotRegistrations.get(interaction.user.id);
  const previousFiveMToken = previousRegistration?.serverId === serverId.value
    ? previousRegistration.fivemFacToken
    : null;

  const registration = {
    serverId: serverId.value,
    ownerId: interaction.user.id,
    clientId: clientId.value,
    hostingAccessKey,
    botToken,
    fivemFacToken: previousFiveMToken
  };

  pendingBotRegistrations.set(interaction.user.id, registration);
  await interaction.reply(buildRegisterConfirmPanel(registration));
}

async function handleRegisterFiveMCodeSubmit(interaction) {
  const registration = pendingBotRegistrations.get(interaction.user.id);

  if (!registration) {
    await interaction.reply({
      content: "Nenhum cadastro pendente. Clique em Cadastrar bot para comecar novamente.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const fivemFacToken = interaction.fields.getTextInputValue("fivemFacToken").trim();

  if (!/^\d{4}$/.test(fivemFacToken)) {
    await interaction.reply({ content: "O codigo de ativacao precisa ter exatamente 4 digitos.", flags: MessageFlags.Ephemeral });
    return;
  }

  const tokenStatus = checkFiveMFacTokenAvailable(registration.serverId, fivemFacToken, registration.ownerId);

  if (!tokenStatus.ok) {
    await interaction.reply({ content: tokenStatus.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const updatedRegistration = {
    ...registration,
    fivemFacToken
  };

  pendingBotRegistrations.set(interaction.user.id, updatedRegistration);
  await interaction.reply(buildRegisterConfirmPanel(updatedRegistration));
}

async function handleRegisterConfirm(interaction) {
  const registration = pendingBotRegistrations.get(interaction.user.id);

  if (!registration) {
    await interaction.reply({
      content: "Nenhum cadastro pendente. Clique em Cadastrar bot para comecar novamente.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!registration.fivemFacToken) {
    await interaction.reply({
      content: "Informe o codigo de ativacao de 4 digitos antes de confirmar o cadastro.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const tokenStatus = checkFiveMFacTokenAvailable(registration.serverId, registration.fivemFacToken, registration.ownerId);

  if (!tokenStatus.ok) {
    await interaction.editReply(tokenStatus.message);
    return;
  }

  let result;
  try {
    result = await callUserBotsApi("/api/user-bots/connect", {
      method: "POST",
      headers: {
        "x-user-id": registration.ownerId
      },
      body: JSON.stringify({
        guildId: registration.serverId,
        targetUserId: registration.ownerId,
        clientId: registration.clientId,
        hostingAccessKey: registration.hostingAccessKey,
        fivemFacToken: registration.fivemFacToken,
        activationCode: registration.fivemFacToken,
        botToken: registration.botToken
      })
    });
  } catch {
    await interaction.editReply("Nao foi possivel conectar com a API.");
    return;
  }

  const { ok, data } = result;

  if (!ok || !data.success) {
    await interaction.editReply(data.message || "Nao foi possivel registrar e ativar o bot.");
    return;
  }

  saveRegistration(interaction.user.id, {
    serverId: registration.serverId,
    ownerId: registration.ownerId,
    clientId: registration.clientId
  });
  pendingBotRegistrations.delete(interaction.user.id);
  await interaction.editReply("Bot registrado e ativado com sucesso. Codigo de ativacao consumido para este servidor.");
}

async function handleDeleteSubmit(interaction) {
  if (!isPanelAdmin(interaction.user.id)) {
    await interaction.reply({ content: "Apenas administradores podem desligar bots de clientes.", flags: MessageFlags.Ephemeral });
    return;
  }

  const ownerId = validateSnowflake(interaction.fields.getTextInputValue("ownerId"), "ID de Discord");
  const clientId = validateSnowflake(interaction.fields.getTextInputValue("clientId"), "ID do cliente");

  if (!ownerId.ok) {
    await interaction.reply({ content: ownerId.message, flags: MessageFlags.Ephemeral });
    return;
  }

  if (!clientId.ok) {
    await interaction.reply({ content: clientId.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const registration = {
    ownerId: ownerId.value,
    clientId: clientId.value
  };

  pendingBotDeletes.set(interaction.user.id, registration);
  await interaction.reply(buildDeleteConfirmPanel(registration));
}

async function handleDeleteConfirm(interaction) {
  if (!isPanelAdmin(interaction.user.id)) {
    await interaction.reply({ content: "Apenas administradores podem desligar bots de clientes.", flags: MessageFlags.Ephemeral });
    return;
  }

  const registration = pendingBotDeletes.get(interaction.user.id);

  if (!registration) {
    await interaction.reply({
      content: "Nenhuma remocao pendente. Clique em Delete Bot para comecar novamente.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let result;
  try {
    result = await callUserBotsApi(`/api/user-bots/${encodeURIComponent(registration.clientId)}/token`, {
      method: "DELETE",
      headers: {
        "x-user-id": registration.ownerId
      }
    });
  } catch {
    await interaction.editReply("Nao foi possivel conectar com a API.");
    return;
  }

  const { ok, data } = result;

  if (!ok || !data.success) {
    await interaction.editReply(data.message || "Nao foi possivel remover o bot.");
    return;
  }

  pendingBotDeletes.delete(interaction.user.id);
  await interaction.editReply("Bot removido com sucesso.");
}

panelClient.once(Events.ClientReady, async (client) => {
  console.log(`Bot do painel online: ${client.user.tag}`);
  try {
    await registerCommands(config.panelClientId || client.user.id);
    console.log("Comandos /hospedagem e /gerenciador registrados.");
  } catch (error) {
    console.error("Nao foi possivel registrar os comandos:", error.message);
  }
});

panelClient.on(Events.MessageCreate, async (message) => {
  if (await handlePendingWelcomeBannerUpload(message)) {
    return;
  }

  await deleteTokenLikeMessage(message);
});

panelClient.on(Events.GuildMemberAdd, async (member) => {
  if (!config.enableMemberEvents) {
    return;
  }

  await sendWelcomeMessage(member);
});

panelClient.on(Events.GuildMemberRemove, async (member) => {
  if (!config.enableMemberEvents) {
    return;
  }

  await sendExitMessage(member);
});

panelClient.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (!config.enableMemberEvents) {
    return;
  }

  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;
  const changed = oldRoles.size !== newRoles.size || oldRoles.some((_, roleId) => !newRoles.has(roleId));

  if (changed) {
    await updateHierarchyPublicPanel(newMember.guild);
  }
});

panelClient.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "hospedagem") {
    await interaction.reply(buildHostingTutorialPanel());
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "gerenciador") {
    await handleManagerCommand(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId === "management:fivem-fac") {
    await handleFiveMFacEntry(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId === "management:back") {
    if (interaction.guildId && canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
      await interaction.update(buildFiveMFacPanel(interaction.guildId, interaction.user.id));
      return;
    }

    await interaction.update(buildManagementToolsPanel());
    return;
  }

  if (interaction.isButton() && interaction.customId === "fivem-fac:use-token") {
    await interaction.showModal(buildFiveMTokenModal());
    return;
  }

  if (interaction.isButton() && interaction.customId === "fivem-fac:activate") {
    await handleFiveMFacActivate(interaction);
    return;
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === "fivem-fac:channel-select") {
    await handleFiveMFacChannelSelect(interaction);
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "fivem-fac:tool-select") {
    if (!interaction.guildId || !canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
      await interaction.reply({ content: "Voce ainda nao tem acesso ao painel fac FiveM neste servidor.", flags: MessageFlags.Ephemeral });
      return;
    }

    const selectedTool = interaction.values[0];
    if (selectedTool === "welcome") {
      await interaction.reply(buildWelcomePanel(interaction.guildId));
      return;
    }

    if (selectedTool === "hierarchy") {
      await interaction.reply(buildHierarchyConfigPanel(interaction.guildId));
      return;
    }

    await interaction.reply({ content: "Ferramenta nao encontrada.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "hierarchy:level-select") {
    await handleHierarchyLevelSelect(interaction);
    return;
  }

  if (interaction.isRoleSelectMenu() && interaction.customId.startsWith("hierarchy:role-select:")) {
    await handleHierarchyRoleSelect(interaction);
    return;
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === "hierarchy:panel-channel") {
    await handleHierarchyPanelChannelSelect(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId === "hierarchy:preview") {
    if (!interaction.guild || !interaction.guildId || !canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
      await interaction.reply({ content: "Voce ainda nao tem acesso ao painel fac FiveM neste servidor.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply(await buildHierarchyPublicPanel(interaction.guild));
    return;
  }

  if (interaction.isButton() && interaction.customId === "hierarchy:refresh") {
    if (!interaction.guild || !interaction.guildId || !canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
      await interaction.reply({ content: "Voce ainda nao tem acesso ao painel fac FiveM neste servidor.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.update(await buildHierarchyPublicPanel(interaction.guild));
    return;
  }

  if (interaction.isButton() && interaction.customId === "hierarchy:back") {
    if (!interaction.guildId || !canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
      await interaction.reply({ content: "Voce ainda nao tem acesso ao painel fac FiveM neste servidor.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.update(buildFiveMFacPanel(interaction.guildId, interaction.user.id));
    return;
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === "welcome:entry-channel") {
    await handleWelcomeChannelSelect(interaction, "entry");
    return;
  }

  if (interaction.isChannelSelectMenu() && interaction.customId === "welcome:exit-channel") {
    await handleWelcomeChannelSelect(interaction, "exit");
    return;
  }

  if (interaction.isButton() && interaction.customId === "welcome:banner") {
    await handleWelcomeBannerRequest(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId === "welcome:back") {
    if (!interaction.guildId || !canAccessFiveMFac(interaction.guildId, interaction.user.id)) {
      await interaction.reply({ content: "Voce ainda nao tem acesso ao painel fac FiveM neste servidor.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.update(buildFiveMFacPanel(interaction.guildId, interaction.user.id));
    return;
  }

  if (interaction.isButton() && interaction.customId === "bot:register") {
    await handleRegisterStart(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId === "bot:register-manual") {
    await interaction.showModal(buildRegisterModal(pendingBotRegistrations.get(interaction.user.id), interaction.guildId));
    return;
  }

  if (interaction.isButton() && interaction.customId === "bot:register-correct") {
    await interaction.showModal(buildRegisterModal(pendingBotRegistrations.get(interaction.user.id), interaction.guildId));
    return;
  }

  if (interaction.isButton() && interaction.customId === "bot:register-fivem-code") {
    if (!pendingBotRegistrations.has(interaction.user.id)) {
      await interaction.reply({
        content: "Nenhum cadastro pendente. Clique em Cadastrar bot para comecar novamente.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.showModal(buildRegisterFiveMCodeModal());
    return;
  }

  if (interaction.isButton() && interaction.customId === "bot:register-confirm") {
    await handleRegisterConfirm(interaction);
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "bot:register-select") {
    await handleRegisterSelect(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId === "bot:delete") {
    if (!isPanelAdmin(interaction.user.id)) {
      await interaction.reply({ content: "Apenas administradores podem desligar bots de clientes.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.showModal(buildDeleteModal(pendingBotDeletes.get(interaction.user.id)));
    return;
  }

  if (interaction.isButton() && interaction.customId === "bot:delete-correct") {
    if (!isPanelAdmin(interaction.user.id)) {
      await interaction.reply({ content: "Apenas administradores podem desligar bots de clientes.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.showModal(buildDeleteModal(pendingBotDeletes.get(interaction.user.id)));
    return;
  }

  if (interaction.isButton() && interaction.customId === "bot:delete-confirm") {
    await handleDeleteConfirm(interaction);
    return;
  }

  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "modal:bot-register") {
    await handleRegisterSubmit(interaction);
    return;
  }

  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "modal:bot-register-fivem-code") {
    await handleRegisterFiveMCodeSubmit(interaction);
    return;
  }

  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "modal:bot-delete") {
    await handleDeleteSubmit(interaction);
    return;
  }

  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "modal:fivem-fac-token") {
    await handleFiveMFacTokenSubmit(interaction);
    return;
  }

  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "modal:hierarchy-add-level") {
    await handleHierarchyAddLevelSubmit(interaction);
  }
});

panelClient.login(config.panelBotToken).catch((error) => {
  if (error.code === "TokenInvalid") {
    console.error([
      "Token do bot do painel invalido.",
      "Confira se PANEL_BOT_TOKEN no .env e o Token do bot em Discord Developer Portal > Bot > Token.",
      "O Application ID / Client ID e numerico; ele deve ficar em PANEL_CLIENT_ID ou CLIENT_ID, nao em PANEL_BOT_TOKEN.",
      "Se o token ja apareceu em chat, log ou arquivo compartilhado, gere um novo token no Developer Portal."
    ].join("\n"));
  } else {
    console.error("Nao foi possivel iniciar o bot do painel:", error.message);
  }

  process.exitCode = 1;
});
