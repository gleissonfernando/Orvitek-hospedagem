const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  InteractionType,
  MessageFlags,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ModalBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
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
const publicComponentsV2Flags = MessageFlags.IsComponentsV2;
const ephemeralComponentsV2Flags = MessageFlags.Ephemeral | MessageFlags.IsComponentsV2;

const panelClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
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

function generateFiveMFacToken(guildId, createdBy) {
  const store = readFiveMFacStore();
  const guildStore = getFiveMGuildStore(store, guildId);
  let token = null;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    if (!guildStore.tokens[candidate] || guildStore.tokens[candidate].status === "used") {
      token = candidate;
      break;
    }
  }

  if (!token) {
    throw new Error("Nao foi possivel gerar um token disponivel para este servidor.");
  }

  guildStore.tokens[token] = {
    status: "available",
    createdBy,
    createdAt: new Date().toISOString(),
    usedBy: null,
    usedAt: null
  };

  writeJsonFile(fivemFacPath, store);
  return token;
}

function activateFiveMFacToken(guildId, userId, token) {
  const store = readFiveMFacStore();
  const guildStore = getFiveMGuildStore(store, guildId);
  const tokenData = guildStore.tokens[token];

  if (!tokenData || tokenData.status !== "available") {
    return {
      ok: false,
      message: "Token invalido ou ja utilizado."
    };
  }

  tokenData.status = "used";
  tokenData.usedBy = userId;
  tokenData.usedAt = new Date().toISOString();
  guildStore.users[userId] = {
    access: true,
    token,
    activatedAt: tokenData.usedAt,
    config: guildStore.users[userId]?.config || {}
  };

  writeJsonFile(fivemFacPath, store);
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

async function callOrvitekApi(pathname, options = {}) {
  const url = new URL(pathname, config.apiPublicUrl);
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-orvitek-api-key": config.orvitekApiKey,
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

function isPanelAdmin(userId) {
  return config.panelAdminIds.includes(userId);
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

function buildPanel(userId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("bot:register")
      .setLabel("Register Bot")
      .setStyle(ButtonStyle.Success)
  );

  if (isPanelAdmin(userId)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId("bot:delete")
        .setLabel("Delete Bot")
        .setStyle(ButtonStyle.Danger)
    );
  }

  return buildV2Panel([
    "## Bot Orvitek Hospedagem",
    "Escolha uma acao para gerenciar bots de clientes."
  ], row, {
    imagePath: panelImagePath,
    imageName: panelImageName,
    ephemeral: false
  });
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
    "1. Entre no Discord Developer Portal e clique em Novo aplicativo.",
    "2. Dê um nome para o aplicativo, aceite os termos e clique em Criar.",
    "3. Na aba OAuth2, copie o ID do cliente. Esse numero sera o Client ID.",
    "4. Na aba Bot, clique em Redefinir token e copie o token do bot.",
    "5. No Discord, use o botao Cadastrar bot e informe seu ID de Discord, o Client ID, o ID do servidor dos comandos e o token.",
    "6. Depois de confirmar, a hospedagem valida o token e liga o bot automaticamente.",
    "",
    "Nunca envie token em chat aberto. Use somente o formulario seguro do botao abaixo."
  ], row, {
    imagePath: panelImagePath,
    imageName: panelImageName,
    ephemeral: false
  });
}

function buildManagerPanel() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("manager:list")
      .setLabel("Ver cadastrados")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("manager:sync-hierarchy")
      .setLabel("Registrar hierarquia")
      .setStyle(ButtonStyle.Success)
  );

  return buildV2Panel([
    "## Painel gerenciador",
    "Gerencie os bots cadastrados na hospedagem.",
    "",
    "O sistema de hierarquia roda dentro de cada bot hospedado. Ao sincronizar, cada bot registra `/herarquia` e `/hierarquia` usando o proprio token, como comando dele mesmo."
  ], row);
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

function buildFiveMFacAccessPanel(isAdmin = false) {
  const accessRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("fivem-fac:buy-token")
      .setLabel("Comprar token")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("fivem-fac:use-token")
      .setLabel("Usar token")
      .setStyle(ButtonStyle.Primary)
  );

  const rows = [accessRow];

  if (isAdmin) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("fivem-fac:generate-token")
        .setLabel("Gerar token")
        .setStyle(ButtonStyle.Secondary)
    ));
  }

  return buildV2Panel([
    "## fac FiveM",
    "Essa ferramenta precisa de um token de acesso de 4 digitos.",
    "",
    "Cada servidor Discord tem seus proprios tokens, acessos e configuracoes.",
    "Usar um token aqui libera somente o painel fac FiveM para voce neste servidor."
  ], rows);
}

function buildFiveMFacPanel(guildId, userId) {
  const store = readFiveMFacStore();
  const guildStore = getFiveMGuildStore(store, guildId);
  const userConfig = guildStore.users[userId]?.config || {};

  return buildV2Panel([
    "## fac FiveM",
    "Painel liberado por token.",
    "",
    `Servidor configurado: ${guildId}`,
    `Usuario configurando: <@${userId}>`,
    `Regras cadastradas: ${Array.isArray(userConfig.rules) ? userConfig.rules.length : 0}`,
    "",
    "As proximas regras e componentes de faccao FiveM serao adicionados aqui sem misturar configuracoes de outros servidores ou usuarios."
  ], new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("management:back")
      .setLabel("Voltar")
      .setStyle(ButtonStyle.Secondary)
  ));
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

function formatPlanStatus(bot) {
  const expired = bot.planExpiresAt && new Date(bot.planExpiresAt).getTime() <= Date.now();

  if (expired || bot.planStatus === "overdue") {
    return "vencido";
  }

  return bot.planStatus || "ativo";
}

function formatBotStatus(bot) {
  const planStatus = formatPlanStatus(bot);
  const onlineStatus = bot.status === "online" && planStatus !== "vencido" ? "online" : "offline";

  return `${onlineStatus} / plano ${planStatus}`;
}

function buildRegisteredBotsLines(plans, filterUserId = null) {
  const filtered = filterUserId
    ? plans.filter((bot) => bot.userId === filterUserId)
    : plans;

  if (filtered.length === 0) {
    return [
      "## Bots cadastrados",
      filterUserId ? `Nenhum bot cadastrado para <@${filterUserId}>.` : "Nenhum bot cadastrado ainda."
    ];
  }

  const lines = [
    "## Bots cadastrados",
    `Total: ${filtered.length}`
  ];

  for (const bot of filtered.slice(0, 10)) {
    lines.push(
      "",
      `Dono: <@${bot.userId}>`,
      `Bot: ${bot.botUsername || "sem nome"} (${bot.clientId})`,
      `Servidor: ${bot.guildId}`,
      `Status: ${formatBotStatus(bot)}`,
      `Hierarquia: use /herarquia no bot do cliente`
    );
  }

  if (filtered.length > 10) {
    lines.push("", `Mostrando 10 de ${filtered.length}. Use /gerenciar usuario:@usuario para filtrar.`);
  }

  return lines;
}

async function fetchRegisteredBots() {
  if (!config.orvitekApiKey) {
    return {
      ok: false,
      message: "ORVITEK_API_KEY nao configurada no bot do painel."
    };
  }

  const result = await callOrvitekApi("/api/hosting-plans");

  if (!result.ok || !result.data.success) {
    return {
      ok: false,
      message: result.data.message || "Nao foi possivel carregar os bots cadastrados."
    };
  }

  return {
    ok: true,
    plans: Array.isArray(result.data.plans) ? result.data.plans.filter(Boolean) : []
  };
}

async function replyRegisteredBots(interaction, filterUserId = null) {
  const result = await fetchRegisteredBots();

  if (!result.ok) {
    await interaction.editReply(result.message);
    return;
  }

  await interaction.editReply(buildV2Panel(buildRegisteredBotsLines(result.plans, filterUserId), new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("manager:sync-hierarchy")
      .setLabel("Registrar hierarquia")
      .setStyle(ButtonStyle.Success)
  )));
}

async function handleManagerPanel(interaction) {
  if (!isPanelAdmin(interaction.user.id)) {
    await interaction.reply({ content: "Apenas administradores podem abrir o painel gerenciador.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply(buildManagerPanel());
}

async function handleManageCommand(interaction) {
  if (!isPanelAdmin(interaction.user.id)) {
    await interaction.reply({ content: "Apenas administradores podem ver os cadastros.", flags: MessageFlags.Ephemeral });
    return;
  }

  const user = interaction.options.getUser("usuario");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await replyRegisteredBots(interaction, user?.id || null);
}

async function handleManagerList(interaction) {
  if (!isPanelAdmin(interaction.user.id)) {
    await interaction.reply({ content: "Apenas administradores podem ver os cadastros.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await replyRegisteredBots(interaction);
}

async function handleManagerSyncHierarchy(interaction) {
  if (!isPanelAdmin(interaction.user.id)) {
    await interaction.reply({ content: "Apenas administradores podem sincronizar comandos.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!config.orvitekApiKey) {
    await interaction.editReply("ORVITEK_API_KEY nao configurada no bot do painel.");
    return;
  }

  const result = await callOrvitekApi("/api/hosting-plans/sync-hierarchy-commands", {
    method: "POST",
    body: JSON.stringify({})
  });

  if (!result.ok || !result.data.success) {
    await interaction.editReply(result.data.message || "Nao foi possivel registrar os comandos de hierarquia.");
    return;
  }

  await interaction.editReply(result.data.message || "Comandos de hierarquia sincronizados.");
}

async function handleFiveMFacEntry(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Use essa ferramenta dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (hasFiveMFacAccess(interaction.guildId, interaction.user.id)) {
    await interaction.update(buildFiveMFacPanel(interaction.guildId, interaction.user.id));
    return;
  }

  await interaction.update(buildFiveMFacAccessPanel(isPanelAdmin(interaction.user.id)));
}

async function handleFiveMFacBuyToken(interaction) {
  await interaction.reply({
    content: "Para comprar um token fac FiveM, chame a equipe Orvitek. Depois use o botao Usar token e digite os 4 digitos recebidos.",
    flags: MessageFlags.Ephemeral
  });
}

async function handleFiveMFacGenerateToken(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "Use essa ferramenta dentro de um servidor.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isPanelAdmin(interaction.user.id)) {
    await interaction.reply({ content: "Apenas administradores podem gerar tokens.", flags: MessageFlags.Ephemeral });
    return;
  }

  let token;
  try {
    token = generateFiveMFacToken(interaction.guildId, interaction.user.id);
  } catch (error) {
    await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: `Token fac FiveM gerado para este servidor: ${token}\nEnvie esse token somente para o cliente que comprou o acesso.`,
    flags: MessageFlags.Ephemeral
  });
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

function buildRegisterModal(previous = {}, currentGuildId = null) {
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
    .setPlaceholder("Numero do aplicativo no Developer Portal")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  if (previous.clientId) {
    clientInput.setValue(previous.clientId);
  }

  const serverInput = new TextInputBuilder()
    .setCustomId("serverId")
    .setLabel("ID do servidor dos comandos")
    .setPlaceholder("Servidor onde o bot mostrara /herarquia")
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
    .setLabel("FakeToken")
    .setPlaceholder("Token que sera enviado para a API")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(20)
    .setMaxLength(4000);

  if (previous.botToken) {
    tokenInput.setValue(previous.botToken);
  }

  return new ModalBuilder()
    .setCustomId("modal:bot-register")
    .setTitle("Register Bot")
    .addComponents(
      new ActionRowBuilder().addComponents(ownerInput),
      new ActionRowBuilder().addComponents(clientInput),
      new ActionRowBuilder().addComponents(serverInput),
      new ActionRowBuilder().addComponents(accessKeyInput),
      new ActionRowBuilder().addComponents(tokenInput)
    );
}

function buildRegisterConfirmPanel(registration) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("bot:register-correct")
      .setLabel("Correct")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("bot:register-confirm")
      .setLabel("Confirm Registration")
      .setStyle(ButtonStyle.Success)
  );

  return buildV2Panel([
    "## Confirm bot registration",
    `ID de Discord: ${registration.ownerId}`,
    `Client ID: ${registration.clientId}`,
    `Servidor dos comandos: ${registration.serverId}`,
    `Chave Orvitek: ${registration.hostingAccessKey}`,
    `FakeToken: ${maskToken(registration.botToken)}`
  ], row);
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

  const ownerId = validateSnowflake(interaction.fields.getTextInputValue("ownerId"), "ID de Discord");
  const clientId = validateSnowflake(interaction.fields.getTextInputValue("clientId"), "ID do cliente");
  const serverId = validateSnowflake(interaction.fields.getTextInputValue("serverId"), "ID do servidor dos comandos");
  const hostingAccessKey = interaction.fields.getTextInputValue("hostingAccessKey").trim();
  const botToken = interaction.fields.getTextInputValue("botToken").trim();

  if (!ownerId.ok) {
    await interaction.reply({ content: ownerId.message, flags: MessageFlags.Ephemeral });
    return;
  }

  if (!clientId.ok) {
    await interaction.reply({ content: clientId.message, flags: MessageFlags.Ephemeral });
    return;
  }

  if (!serverId.ok) {
    await interaction.reply({ content: serverId.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const registration = {
    serverId: serverId.value,
    ownerId: ownerId.value,
    clientId: clientId.value,
    hostingAccessKey,
    botToken
  };

  pendingBotRegistrations.set(interaction.user.id, registration);
  await interaction.reply(buildRegisterConfirmPanel(registration));
}

async function handleRegisterConfirm(interaction) {
  const registration = pendingBotRegistrations.get(interaction.user.id);

  if (!registration) {
    await interaction.reply({
      content: "Nenhum cadastro pendente. Clique em Register Bot para comecar novamente.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
  await interaction.editReply("Bot registrado e ativado com sucesso.");
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
    console.log("Comandos /painel, /panel, /hospedagem, /painel-gerenciador, /painel-gerenciar e /gerenciar registrados.");
  } catch (error) {
    console.error("Nao foi possivel registrar os comandos:", error.message);
  }
});

panelClient.on(Events.MessageCreate, async (message) => {
  await deleteTokenLikeMessage(message);
});

panelClient.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand() && ["painel", "panel"].includes(interaction.commandName)) {
    await interaction.reply(buildPanel(interaction.user.id));
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "hospedagem") {
    await interaction.reply(buildHostingTutorialPanel());
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "painel-gerenciador") {
    await handleManagerPanel(interaction);
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "painel-gerenciar") {
    if (interaction.guildId && hasFiveMFacAccess(interaction.guildId, interaction.user.id)) {
      await interaction.reply(buildFiveMFacPanel(interaction.guildId, interaction.user.id));
      return;
    }

    await interaction.reply(buildManagementToolsPanel());
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "gerenciar") {
    await handleManageCommand(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId === "management:fivem-fac") {
    await handleFiveMFacEntry(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId === "management:back") {
    if (interaction.guildId && hasFiveMFacAccess(interaction.guildId, interaction.user.id)) {
      await interaction.update(buildFiveMFacPanel(interaction.guildId, interaction.user.id));
      return;
    }

    await interaction.update(buildManagementToolsPanel());
    return;
  }

  if (interaction.isButton() && interaction.customId === "fivem-fac:buy-token") {
    await handleFiveMFacBuyToken(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId === "fivem-fac:use-token") {
    await interaction.showModal(buildFiveMTokenModal());
    return;
  }

  if (interaction.isButton() && interaction.customId === "fivem-fac:generate-token") {
    await handleFiveMFacGenerateToken(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId === "manager:list") {
    await handleManagerList(interaction);
    return;
  }

  if (interaction.isButton() && interaction.customId === "manager:sync-hierarchy") {
    await handleManagerSyncHierarchy(interaction);
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

  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "modal:bot-delete") {
    await handleDeleteSubmit(interaction);
    return;
  }

  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "modal:fivem-fac-token") {
    await handleFiveMFacTokenSubmit(interaction);
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
