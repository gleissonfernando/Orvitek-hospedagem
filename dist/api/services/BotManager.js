"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.botManager = void 0;
const discord_js_1 = require("discord.js");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("../config");
const tokenCrypto_1 = require("../security/tokenCrypto");
const FiveMFacTokenStore_1 = require("./FiveMFacTokenStore");
const userBotStore_1 = require("../storage/userBotStore");
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
    const cleaned = name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    return cleaned || fallback;
}
function bannerRelativePath(guildId, userId, scope, fileName) {
    return node_path_1.default.join("data", "fivem-fac-banners", guildId, userId, `${scope}-${fileName}`);
}
function bannerImageOptions(config) {
    const localPath = typeof config.bannerLocalPath === "string" ? node_path_1.default.resolve(process.cwd(), config.bannerLocalPath) : null;
    const attachmentName = typeof config.bannerAttachmentName === "string"
        ? config.bannerAttachmentName
        : localPath
            ? node_path_1.default.basename(localPath)
            : null;
    if (localPath && attachmentName && node_fs_1.default.existsSync(localPath)) {
        return {
            imagePath: localPath,
            imageName: attachmentName
        };
    }
    const bannerUrl = typeof config.bannerUrl === "string" ? config.bannerUrl : null;
    if (bannerUrl && !bannerUrl.includes("/ephemeral-attachments/")) {
        return { imageUrl: bannerUrl };
    }
    return {};
}
async function persistUploadedImage(input) {
    const fileName = sanitizeImageFileName(input.name, `${input.scope}-banner.png`);
    const relativePath = bannerRelativePath(input.guildId, input.userId, input.scope, fileName);
    const absolutePath = node_path_1.default.resolve(process.cwd(), relativePath);
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(absolutePath), { recursive: true });
    const response = await fetch(input.url);
    if (!response.ok) {
        throw new Error("Nao foi possivel baixar a imagem enviada.");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    node_fs_1.default.writeFileSync(absolutePath, buffer);
    return {
        bannerUrl: input.url,
        bannerName: input.name,
        bannerLocalPath: relativePath,
        bannerAttachmentName: fileName
    };
}
function claimMemberEvent(input) {
    const ttlMs = input.ttlMs || 15_000;
    const dir = node_path_1.default.join(process.cwd(), "data", "fivem-fac-event-locks", input.guildId, input.userId);
    const filePath = node_path_1.default.join(dir, `${input.type}-${input.memberId}.lock`);
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    try {
        const stat = node_fs_1.default.statSync(filePath);
        if (Date.now() - stat.mtimeMs < ttlMs) {
            return false;
        }
        node_fs_1.default.unlinkSync(filePath);
    }
    catch {
        // Lock ausente ou antigo removido.
    }
    try {
        const fd = node_fs_1.default.openSync(filePath, "wx");
        node_fs_1.default.writeFileSync(fd, new Date().toISOString());
        node_fs_1.default.closeSync(fd);
        return true;
    }
    catch {
        return false;
    }
}
function buildActivationCommands(hasAccess) {
    const commands = [];
    if (!hasAccess) {
        commands.push(new discord_js_1.SlashCommandBuilder()
            .setName("ativar")
            .setDescription("Ativa o Painel fac usando o codigo de 4 digitos.")
            .toJSON());
    }
    if (hasAccess) {
        commands.push(new discord_js_1.SlashCommandBuilder()
            .setName("painel-fac")
            .setDescription("Abre o painel fac liberado para este servidor.")
            .toJSON());
    }
    return commands;
}
async function registerActivationCommands(applicationId, guildId, token, hasAccess) {
    const rest = new discord_js_1.REST({ version: "10" }).setToken(token);
    await rest.put(discord_js_1.Routes.applicationGuildCommands(applicationId, guildId), {
        body: buildActivationCommands(hasAccess)
    });
}
function buildActivationModal() {
    const tokenInput = new discord_js_1.TextInputBuilder()
        .setCustomId("token")
        .setLabel("Codigo de 4 digitos")
        .setPlaceholder("Ex: 1234")
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(4)
        .setMaxLength(4);
    return new discord_js_1.ModalBuilder()
        .setCustomId("hosted:activate-fac")
        .setTitle("Ativar Painel fac")
        .addComponents(new discord_js_1.ActionRowBuilder().addComponents(tokenInput));
}
function asEphemeral(payload) {
    return {
        components: payload.components,
        flags: [discord_js_1.MessageFlags.Ephemeral, discord_js_1.MessageFlags.IsComponentsV2],
        ...(payload.files ? { files: payload.files } : {})
    };
}
function buildHostedV2Panel(lines, rows = [], options = {}) {
    const container = new discord_js_1.ContainerBuilder();
    const files = [];
    if (options.imagePath && options.imageName && node_fs_1.default.existsSync(options.imagePath)) {
        container.addMediaGalleryComponents(new discord_js_1.MediaGalleryBuilder().addItems(new discord_js_1.MediaGalleryItemBuilder().setURL(`attachment://${options.imageName}`)));
        files.push(new discord_js_1.AttachmentBuilder(options.imagePath, { name: options.imageName }));
    }
    else if (options.imageUrl) {
        container.addMediaGalleryComponents(new discord_js_1.MediaGalleryBuilder().addItems(new discord_js_1.MediaGalleryItemBuilder().setURL(options.imageUrl)));
    }
    container.addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(lines.join("\n")));
    if (rows.length > 0) {
        container.addSeparatorComponents(new discord_js_1.SeparatorBuilder());
        for (const row of rows) {
            container.addActionRowComponents(row);
        }
    }
    return {
        components: [container],
        flags: [discord_js_1.MessageFlags.IsComponentsV2],
        ...(files.length > 0 ? { files } : {})
    };
}
function buildHostedMemberWelcomePanel(member, template, context) {
    const avatarUrl = member.user.displayAvatarURL({ size: 256 });
    const container = new discord_js_1.ContainerBuilder()
        .setAccentColor(0xf5d142)
        .addSectionComponents(new discord_js_1.SectionBuilder()
        .addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent([
        `### ${renderWelcomeTemplate(template.entryTitle, context)}`,
        `${context.user} entrou no servidor!`,
        "",
        renderWelcomeTemplate(template.entryMessage, context)
    ].join("\n")), new discord_js_1.TextDisplayBuilder().setContent([
        "**Usuario**",
        context.username,
        "",
        "**Primeiro passo**",
        context.firstStep,
        "",
        context.joinedAt
    ].join("\n")))
        .setThumbnailAccessory(new discord_js_1.ThumbnailBuilder()
        .setURL(avatarUrl)
        .setDescription(`Avatar de ${context.username}`)));
    return {
        components: [container],
        flags: [discord_js_1.MessageFlags.IsComponentsV2]
    };
}
function hasDraft(draft) {
    return Boolean(draft && Object.keys(draft).length > 0);
}
function buildHostedToolSelectRow() {
    return new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
        .setCustomId("hosted:fivem-fac:tool")
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
    ]));
}
function buildHostedFiveMFacPanel(guildId, userId) {
    return buildHostedV2Panel([
        "## Painel fac",
        `Servidor: ${guildId}`,
        `Responsavel: <@${userId}>`,
        "",
        "Escolha uma ferramenta para configurar."
    ], [
        buildHostedToolSelectRow(),
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
            .setCustomId("hosted:fivem-fac:publish-preview")
            .setLabel("Publicar neste canal")
            .setStyle(discord_js_1.ButtonStyle.Success))
    ]);
}
function buildHostedPublishConfirmPanel(guildId, userId) {
    return buildHostedV2Panel([
        "## Confirmar publicacao",
        "Este painel sera publicado no canal atual.",
        "",
        "Preview:",
        `Servidor: ${guildId}`,
        `Responsavel: <@${userId}>`,
        "Ferramentas: Boas vindas e Hierarquia"
    ], [
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
            .setCustomId("hosted:fivem-fac:publish-confirm")
            .setLabel("Confirmar")
            .setStyle(discord_js_1.ButtonStyle.Success), new discord_js_1.ButtonBuilder()
            .setCustomId("hosted:fivem-fac:back")
            .setLabel("Cancelar")
            .setStyle(discord_js_1.ButtonStyle.Secondary))
    ]);
}
function buildHostedFixedFiveMFacPanel(guildId, userId) {
    return buildHostedV2Panel([
        "## Painel fac",
        `Servidor: ${guildId}`,
        `Responsavel: <@${userId}>`,
        "",
        "Selecione a ferramenta que deseja usar."
    ], [
        buildHostedToolSelectRow()
    ]);
}
function buildHostedWelcomePanel(guildId, userId, draft = {}) {
    const savedConfig = (0, FiveMFacTokenStore_1.getFiveMWelcomeConfig)(guildId, userId);
    const config = {
        ...savedConfig,
        ...draft
    };
    const template = resolveWelcomeTemplate(config);
    const active = savedConfig.enabled === true || Boolean(savedConfig.confirmedAt || savedConfig.entryChannelId || savedConfig.exitChannelId);
    const pending = hasDraft(draft);
    return buildHostedV2Panel([
        "## Boas vindas",
        config.entryChannelId ? `Canal de entrada: <#${config.entryChannelId}>` : "Canal de entrada: nao configurado",
        config.exitChannelId ? `Canal de saida: <#${config.exitChannelId}>` : "Canal de saida: nao configurado",
        config.bannerUrl ? "Banner de boas vindas: configurado" : "Banner de boas vindas: nao configurado",
        active ? "Status: modelo ativo." : "Status: modelo ainda nao confirmado.",
        pending ? "Status: alteracoes aguardando confirmacao." : "Status: sem alteracoes pendentes.",
        "",
        `Modelo de entrada: ${compactTemplatePreview(template.entryMessage)}`,
        `Modelo de saida: ${compactTemplatePreview(template.exitMessage)}`
    ], [
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ChannelSelectMenuBuilder()
            .setCustomId("hosted:welcome:entry-channel")
            .setPlaceholder("Escolha o canal de entrada")
            .setChannelTypes(discord_js_1.ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1)),
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ChannelSelectMenuBuilder()
            .setCustomId("hosted:welcome:exit-channel")
            .setPlaceholder("Escolha o canal de saida")
            .setChannelTypes(discord_js_1.ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1)),
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
            .setCustomId("hosted:welcome:banner-upload")
            .setLabel("Adicionar banner")
            .setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder()
            .setCustomId("hosted:welcome:preview")
            .setLabel("Preview")
            .setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder()
            .setCustomId("hosted:welcome:confirm")
            .setLabel("Confirmar")
            .setStyle(discord_js_1.ButtonStyle.Success)
            .setDisabled(!pending), new discord_js_1.ButtonBuilder()
            .setCustomId("hosted:welcome:discard")
            .setLabel("Descartar")
            .setStyle(discord_js_1.ButtonStyle.Danger)
            .setDisabled(!pending), new discord_js_1.ButtonBuilder()
            .setCustomId("hosted:fivem-fac:back")
            .setLabel("Voltar")
            .setStyle(discord_js_1.ButtonStyle.Secondary))
    ], bannerImageOptions(config));
}
function buildHostedWelcomePreviewPanel(guildId, userId, draft = {}) {
    const config = {
        ...(0, FiveMFacTokenStore_1.getFiveMWelcomeConfig)(guildId, userId),
        ...draft
    };
    const template = resolveWelcomeTemplate(config);
    const context = {
        id: "000000000000000000",
        user: "@membro",
        mention: "@membro",
        username: "Membro",
        tag: "Membro#0000",
        server: "este servidor",
        memberCount: "123",
        firstStep: "`#` `✅` verificar-acesso",
        joinedAt: formatWelcomeDate()
    };
    return buildHostedV2Panel([
        "## Preview de boas vindas",
        `Mensagem no servidor: ${renderWelcomeTemplate(template.entryMessage, context).replace(/\n/g, " ")}`,
        `Mensagem na DM: ${renderWelcomeTemplate(template.dmMessage, context)}`,
        `Mensagem de saida: ${renderWelcomeTemplate(template.exitMessage, context).replace(/\n/g, " ")}`,
        config.entryChannelId ? `Canal de entrada: <#${config.entryChannelId}>` : "Canal de entrada: nao configurado",
        config.exitChannelId ? `Canal de saida: <#${config.exitChannelId}>` : "Canal de saida: nao configurado",
        config.bannerUrl ? "Imagem: pronta para aplicar." : "Imagem: sem banner."
    ], [], bannerImageOptions(config));
}
function buildHostedHierarchyPanel(guildId, userId, draft = {}) {
    const config = (0, FiveMFacTokenStore_1.getFiveMHierarchyConfig)(guildId, userId);
    const levels = draft.levels || config.levels;
    const pendingPanelChannelId = draft.panelChannelId || config.panel?.channelId;
    const bannerUrl = draft.bannerUrl || config.bannerUrl;
    const pending = hasDraft(draft);
    const levelOptions = levels.slice(0, 24).map((level) => ({
        label: level.name.slice(0, 100),
        description: level.roleId ? `Cargo ${level.roleId}` : "Selecionar cargo deste nivel",
        value: level.id
    }));
    levelOptions.push({
        label: "Adicionar nivel",
        description: "Criar outra hierarquia com cargo proprio",
        value: "__add"
    });
    return buildHostedV2Panel([
        "## Hierarquia da fac",
        pendingPanelChannelId ? `Canal do painel: <#${pendingPanelChannelId}>` : "Painel ainda nao publicado.",
        bannerUrl ? "Banner da hierarquia: configurado" : "Banner da hierarquia: nao configurado",
        pending ? "Status: alteracoes aguardando confirmacao." : "Status: sem alteracoes pendentes.",
        "",
        ...levels.map((level, index) => `${index + 1}. ${level.name}: ${level.roleId ? `<@&${level.roleId}>` : "cargo nao configurado"}`)
    ], [
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.StringSelectMenuBuilder()
            .setCustomId("hosted:hierarchy:level-select")
            .setPlaceholder("Editar nivel ou adicionar")
            .addOptions(levelOptions)),
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ChannelSelectMenuBuilder()
            .setCustomId("hosted:hierarchy:panel-channel")
            .setPlaceholder("Escolha o canal do painel de hierarquia")
            .setChannelTypes(discord_js_1.ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1)),
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
            .setCustomId("hosted:hierarchy:banner-upload")
            .setLabel("Adicionar banner")
            .setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder()
            .setCustomId("hosted:hierarchy:preview")
            .setLabel("Preview")
            .setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder()
            .setCustomId("hosted:hierarchy:confirm")
            .setLabel("Confirmar")
            .setStyle(discord_js_1.ButtonStyle.Success)
            .setDisabled(!pending), new discord_js_1.ButtonBuilder()
            .setCustomId("hosted:hierarchy:discard")
            .setLabel("Descartar")
            .setStyle(discord_js_1.ButtonStyle.Danger)
            .setDisabled(!pending), new discord_js_1.ButtonBuilder()
            .setCustomId("hosted:fivem-fac:back")
            .setLabel("Voltar")
            .setStyle(discord_js_1.ButtonStyle.Secondary))
    ], bannerImageOptions({ ...config, ...draft, bannerUrl }));
}
function buildHostedHierarchyRolePanel(level) {
    return buildHostedV2Panel([
        "## Cargo da hierarquia",
        `Nivel: ${level.name}`,
        level.roleId ? `Cargo atual: <@&${level.roleId}>` : "Cargo atual: nao configurado"
    ], [
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.RoleSelectMenuBuilder()
            .setCustomId(`hosted:hierarchy:role-select:${level.id}`)
            .setPlaceholder(`Escolha o cargo de ${level.name}`)
            .setMinValues(1)
            .setMaxValues(1))
    ]);
}
function buildHostedImageUploadModal(customId, title, label) {
    return new discord_js_1.ModalBuilder()
        .setCustomId(customId)
        .setTitle(title)
        .addLabelComponents(new discord_js_1.LabelBuilder()
        .setLabel(label)
        .setDescription("Selecione uma imagem do seu computador.")
        .setFileUploadComponent(new discord_js_1.FileUploadBuilder()
        .setCustomId("image")
        .setRequired(true)
        .setMinValues(1)
        .setMaxValues(1)));
}
function buildHostedAddHierarchyLevelModal() {
    const nameInput = new discord_js_1.TextInputBuilder()
        .setCustomId("name")
        .setLabel("Nome da hierarquia")
        .setPlaceholder("Ex: Soldado")
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(50);
    return new discord_js_1.ModalBuilder()
        .setCustomId("hosted:hierarchy:add-level")
        .setTitle("Adicionar hierarquia")
        .addComponents(new discord_js_1.ActionRowBuilder().addComponents(nameInput));
}
async function buildHostedHierarchyPublicPanel(guild, userId, override) {
    const config = override || (0, FiveMFacTokenStore_1.getFiveMHierarchyConfig)(guild.id, userId);
    const lines = [
        "## Hierarquia da Fac",
        "Painel automatico de cargos da faccao."
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
        lines.push("", `**${level.name}**`, `Cargo: ${level.roleId ? `<@&${level.roleId}>` : "cargo nao configurado"}`);
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
    return buildHostedV2Panel(lines, [
        new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
            .setCustomId("hosted:hierarchy:refresh")
            .setLabel("Atualizar")
            .setStyle(discord_js_1.ButtonStyle.Primary))
    ], bannerImageOptions(config));
}
class BotManager {
    clients = new Map();
    statuses = new Map();
    pendingWelcomeDrafts = new Map();
    pendingHierarchyDrafts = new Map();
    key(userId, clientId) {
        return `${userId}:${clientId}`;
    }
    draftKey(guildId, userId) {
        return `${guildId}:${userId}`;
    }
    getWelcomeDraft(guildId, userId) {
        return this.pendingWelcomeDrafts.get(this.draftKey(guildId, userId)) || {};
    }
    setWelcomeDraft(guildId, userId, patch) {
        const key = this.draftKey(guildId, userId);
        const draft = {
            ...(this.pendingWelcomeDrafts.get(key) || {}),
            ...patch
        };
        this.pendingWelcomeDrafts.set(key, draft);
        return draft;
    }
    clearWelcomeDraft(guildId, userId) {
        this.pendingWelcomeDrafts.delete(this.draftKey(guildId, userId));
    }
    getHierarchyDraft(guildId, userId) {
        return this.pendingHierarchyDrafts.get(this.draftKey(guildId, userId)) || {};
    }
    setHierarchyDraft(guildId, userId, patch) {
        const key = this.draftKey(guildId, userId);
        const draft = {
            ...(this.pendingHierarchyDrafts.get(key) || {}),
            ...patch
        };
        this.pendingHierarchyDrafts.set(key, draft);
        return draft;
    }
    clearHierarchyDraft(guildId, userId) {
        this.pendingHierarchyDrafts.delete(this.draftKey(guildId, userId));
    }
    isImageAttachment(attachment) {
        return Boolean(attachment.contentType?.startsWith("image/")
            || /\.(png|jpe?g|gif|webp)$/i.test(attachment.name || attachment.url || ""));
    }
    getUploadedImage(interaction) {
        const files = interaction.fields.getUploadedFiles("image", true);
        const file = [...files.values()][0];
        if (!file || !this.isImageAttachment(file)) {
            return null;
        }
        return {
            url: file.url,
            name: file.name || "banner"
        };
    }
    async sendHostedWelcomeMessage(member, userId) {
        const config = (0, FiveMFacTokenStore_1.getFiveMWelcomeConfig)(member.guild.id, userId);
        const active = config.enabled === true || Boolean(config.confirmedAt || config.entryChannelId);
        if (!active) {
            return;
        }
        if (!claimMemberEvent({ guildId: member.guild.id, userId, memberId: member.id, type: "welcome" })) {
            return;
        }
        const template = resolveWelcomeTemplate(config);
        const context = buildWelcomeTemplateContext(member);
        const dmContent = renderWelcomeTemplate(template.dmMessage, context);
        const dmPayload = buildHostedV2Panel([dmContent], [], bannerImageOptions(config));
        await member.send(dmPayload).catch(() => undefined);
        if (config.entryChannelId) {
            const channel = await member.guild.channels.fetch(config.entryChannelId).catch(() => null);
            if (channel && typeof channel.send === "function") {
                const payload = buildHostedMemberWelcomePanel(member, template, context);
                await channel.send({
                    ...payload,
                    allowedMentions: { users: [member.id] },
                }).catch(() => undefined);
            }
        }
    }
    async sendHostedExitMessage(member, userId) {
        const config = (0, FiveMFacTokenStore_1.getFiveMWelcomeConfig)(member.guild.id, userId);
        const channelId = config.exitChannelId || config.entryChannelId;
        if (!channelId) {
            console.log(`[fac-welcome] saida ignorada sem canal guildId=${member.guild.id} userId=${userId}`);
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
        if (!claimMemberEvent({ guildId: member.guild.id, userId, memberId: member.id, type: "exit" })) {
            return;
        }
        const template = resolveWelcomeTemplate(config);
        const context = buildWelcomeTemplateContext(member);
        const payload = buildHostedV2Panel([
            `## ${renderWelcomeTemplate(template.exitTitle, context)}`,
            renderWelcomeTemplate(template.exitMessage, context)
        ]);
        const sent = await channel.send({
            ...payload,
            allowedMentions: { users: [member.id] }
        }).catch(() => undefined);
        if (!sent) {
            console.error(`[fac-welcome] falha ao enviar saida guildId=${member.guild.id} userId=${userId} memberId=${member.id} channelId=${channelId}`);
        }
    }
    async updateHostedHierarchyPublicPanel(guild, userId) {
        const config = (0, FiveMFacTokenStore_1.getFiveMHierarchyConfig)(guild.id, userId);
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
        await message.edit(await buildHostedHierarchyPublicPanel(guild, userId)).catch(() => undefined);
        return true;
    }
    async confirmHostedHierarchyDraft(interaction, guildId, userId) {
        const draft = this.getHierarchyDraft(guildId, userId);
        if (!hasDraft(draft)) {
            await interaction.reply({ content: "Nao ha alteracoes pendentes para confirmar.", flags: discord_js_1.MessageFlags.Ephemeral });
            return;
        }
        const current = (0, FiveMFacTokenStore_1.getFiveMHierarchyConfig)(guildId, userId);
        const nextConfig = {
            ...current,
            ...(draft.bannerUrl ? {
                bannerUrl: draft.bannerUrl,
                bannerName: draft.bannerName,
                bannerLocalPath: draft.bannerLocalPath,
                bannerAttachmentName: draft.bannerAttachmentName,
                bannerUpdatedAt: draft.bannerUpdatedAt
            } : {}),
            levels: draft.levels || current.levels,
            panel: current.panel
        };
        if (draft.panelChannelId) {
            const channel = await interaction.guild.channels.fetch(draft.panelChannelId).catch(() => null);
            if (!channel || typeof channel.send !== "function") {
                await interaction.reply({ content: "Nao consegui publicar o painel de hierarquia nesse canal. Confira as permissoes do bot.", flags: discord_js_1.MessageFlags.Ephemeral });
                return;
            }
            const panelMessage = await channel.send(await buildHostedHierarchyPublicPanel(interaction.guild, userId, nextConfig)).catch(() => null);
            if (!panelMessage) {
                await interaction.reply({ content: "Nao consegui publicar o painel de hierarquia nesse canal. Confira as permissoes do bot.", flags: discord_js_1.MessageFlags.Ephemeral });
                return;
            }
            await panelMessage.pin("Painel de hierarquia da fac").catch(() => undefined);
            nextConfig.panel = {
                channelId: channel.id,
                channelName: channel.name,
                messageId: panelMessage.id,
                publishedAt: new Date().toISOString()
            };
        }
        (0, FiveMFacTokenStore_1.saveFiveMHierarchyConfig)(guildId, nextConfig, userId);
        this.clearHierarchyDraft(guildId, userId);
        if (!draft.panelChannelId) {
            await this.updateHostedHierarchyPublicPanel(interaction.guild, userId);
        }
        await interaction.update(buildHostedHierarchyPanel(guildId, userId));
    }
    async startBot(userId, clientId) {
        const key = this.key(userId, clientId);
        const existing = this.clients.get(key);
        if (existing?.isReady()) {
            return "online";
        }
        const userBot = await (0, userBotStore_1.findUserBot)(userId, clientId);
        if (!userBot) {
            return "offline";
        }
        if (userBot.planExpiresAt && new Date(userBot.planExpiresAt).getTime() <= Date.now()) {
            await (0, userBotStore_1.updateUserBot)(userId, clientId, { planStatus: "overdue", status: "offline" });
            this.statuses.set(key, "offline");
            return "offline";
        }
        if (!userBot.encryptedToken) {
            this.statuses.set(key, "offline");
            await (0, userBotStore_1.updateUserBot)(userId, clientId, { status: "offline" });
            return "offline";
        }
        const token = (0, tokenCrypto_1.decryptToken)(userBot.encryptedToken);
        const intents = [
            discord_js_1.GatewayIntentBits.Guilds,
            discord_js_1.GatewayIntentBits.GuildMessages
        ];
        if (config_1.apiConfig.hostedBotsEnableMemberEvents) {
            intents.push(discord_js_1.GatewayIntentBits.GuildMembers);
        }
        const client = new discord_js_1.Client({ intents });
        client.once(discord_js_1.Events.ClientReady, async () => {
            const guild = client.guilds.cache.get(userBot.guildId);
            const status = guild ? "online" : "error";
            this.statuses.set(key, status);
            await (0, userBotStore_1.updateUserBot)(userId, clientId, { status });
            if (guild) {
                await registerActivationCommands(clientId, userBot.guildId, token, (0, FiveMFacTokenStore_1.hasFiveMFacAccess)(userBot.guildId, userBot.userId)).catch((error) => {
                    console.error(`Nao foi possivel registrar comandos fac do bot ${clientId}:`, error.message);
                });
            }
        });
        client.on(discord_js_1.Events.Error, async () => {
            this.statuses.set(key, "error");
            await (0, userBotStore_1.updateUserBot)(userId, clientId, { status: "error" });
        });
        client.on(discord_js_1.Events.MessageCreate, async (message) => {
            if (!message.guild || message.guild.id !== userBot.guildId) {
                return;
            }
            if (message.author.id !== userBot.targetUserId || message.author.id === client.user?.id) {
                return;
            }
            const botMember = message.guild.members.me;
            if (!botMember?.permissionsIn(message.channelId).has(discord_js_1.PermissionFlagsBits.ManageMessages)) {
                return;
            }
            await message.delete().catch(() => undefined);
        });
        if (config_1.apiConfig.hostedBotsEnableMemberEvents) {
            client.on(discord_js_1.Events.GuildMemberAdd, async (member) => {
                if (member.guild.id !== userBot.guildId) {
                    return;
                }
                await this.sendHostedWelcomeMessage(member, userBot.userId);
            });
            client.on(discord_js_1.Events.GuildMemberRemove, async (member) => {
                if (member.guild.id !== userBot.guildId) {
                    return;
                }
                await this.sendHostedExitMessage(member, userBot.userId);
            });
            client.on(discord_js_1.Events.GuildMemberUpdate, async (oldMember, newMember) => {
                if (newMember.guild.id !== userBot.guildId) {
                    return;
                }
                const oldRoles = oldMember.roles.cache;
                const newRoles = newMember.roles.cache;
                const changed = oldRoles.size !== newRoles.size || oldRoles.some((_, roleId) => !newRoles.has(roleId));
                if (changed) {
                    await this.updateHostedHierarchyPublicPanel(newMember.guild, userBot.userId);
                }
            });
        }
        client.on(discord_js_1.Events.InteractionCreate, async (interaction) => {
            if (!interaction.guild || interaction.guild.id !== userBot.guildId) {
                return;
            }
            const ensureHostedFacAccess = async () => {
                if (!interaction.isRepliable()) {
                    return false;
                }
                if (interaction.user.id !== userBot.userId) {
                    await interaction.reply({ content: "Apenas o usuario que hospedou este bot pode acessar este Painel fac.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return false;
                }
                if (!(0, FiveMFacTokenStore_1.hasFiveMFacAccess)(userBot.guildId, userBot.userId)) {
                    await interaction.reply({ content: "Use /ativar com o codigo de 4 digitos para liberar o Painel fac.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return false;
                }
                return true;
            };
            if (interaction.isChatInputCommand() && interaction.commandName === "ativar") {
                if (interaction.user.id !== userBot.userId) {
                    await interaction.reply({ content: "Apenas o usuario que hospedou este bot pode ativar o Painel fac.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                if ((0, FiveMFacTokenStore_1.hasFiveMFacAccess)(userBot.guildId, userBot.userId)) {
                    await interaction.reply({ content: "O Painel fac ja esta liberado. Use /painel-fac.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                await interaction.showModal(buildActivationModal());
                return;
            }
            if (interaction.type === discord_js_1.InteractionType.ModalSubmit && interaction.customId === "hosted:activate-fac") {
                if (interaction.user.id !== userBot.userId) {
                    await interaction.reply({ content: "Apenas o usuario que hospedou este bot pode ativar o Painel fac.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const facToken = interaction.fields.getTextInputValue("token").trim();
                if (!/^\d{4}$/.test(facToken)) {
                    await interaction.reply({ content: "O codigo precisa ter exatamente 4 digitos.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const result = (0, FiveMFacTokenStore_1.useFiveMFacToken)({
                    guildId: userBot.guildId,
                    token: facToken,
                    userId: userBot.userId
                });
                if (!result.ok) {
                    await interaction.reply({ content: result.message, flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                await registerActivationCommands(clientId, userBot.guildId, token, true).catch((error) => {
                    console.error(`Nao foi possivel trocar /ativar por /painel-fac no bot ${clientId}:`, error.message);
                });
                await interaction.reply({ content: "Painel fac liberado. O comando /ativar foi removido e /painel-fac foi ativado para este bot.", flags: discord_js_1.MessageFlags.Ephemeral });
                return;
            }
            if (interaction.isChatInputCommand() && interaction.commandName === "painel-fac") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                await interaction.reply(asEphemeral(buildHostedFiveMFacPanel(userBot.guildId, userBot.userId)));
                return;
            }
            if (interaction.isButton() && ["hosted:fivem-fac:publish-preview", "hosted:fivem-fac:publish"].includes(interaction.customId)) {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                await interaction.reply(asEphemeral(buildHostedPublishConfirmPanel(userBot.guildId, userBot.userId)));
                return;
            }
            if (interaction.isButton() && interaction.customId === "hosted:fivem-fac:publish-confirm") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                if (!interaction.channel || typeof interaction.channel.send !== "function") {
                    await interaction.reply({ content: "Nao consegui publicar painel nesse canal.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const panelMessage = await interaction.channel.send(buildHostedFixedFiveMFacPanel(userBot.guildId, userBot.userId)).catch(() => null);
                if (!panelMessage) {
                    await interaction.reply({ content: "Nao consegui enviar o Painel fac nesse canal. Confira as permissoes do bot.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                await panelMessage.pin("Painel fac FiveM").catch(() => undefined);
                (0, FiveMFacTokenStore_1.saveFiveMFacPanelActivation)({
                    guildId: userBot.guildId,
                    userId: userBot.userId,
                    channelId: interaction.channelId,
                    channelName: "name" in interaction.channel && typeof interaction.channel.name === "string" ? interaction.channel.name : undefined,
                    messageId: panelMessage.id
                });
                await interaction.reply({ content: "Painel fac publicado neste canal.", flags: discord_js_1.MessageFlags.Ephemeral });
                return;
            }
            if (interaction.isButton() && interaction.customId === "hosted:fivem-fac:back") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                await interaction.update(buildHostedFiveMFacPanel(userBot.guildId, userBot.userId));
                return;
            }
            if (interaction.isStringSelectMenu() && interaction.customId === "hosted:fivem-fac:tool") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                const selectedTool = interaction.values[0];
                if (selectedTool === "welcome") {
                    await interaction.reply(asEphemeral(buildHostedWelcomePanel(userBot.guildId, userBot.userId, this.getWelcomeDraft(userBot.guildId, userBot.userId))));
                    return;
                }
                if (selectedTool === "hierarchy") {
                    await interaction.reply(asEphemeral(buildHostedHierarchyPanel(userBot.guildId, userBot.userId, this.getHierarchyDraft(userBot.guildId, userBot.userId))));
                    return;
                }
                await interaction.reply({ content: "Ferramenta nao encontrada.", flags: discord_js_1.MessageFlags.Ephemeral });
                return;
            }
            if (interaction.isChannelSelectMenu() && interaction.customId === "hosted:welcome:entry-channel") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                const channel = await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);
                const draft = this.setWelcomeDraft(userBot.guildId, userBot.userId, {
                    entryChannelId: interaction.values[0],
                    entryChannelName: channel && "name" in channel ? channel.name : undefined
                });
                await interaction.update(buildHostedWelcomePanel(userBot.guildId, userBot.userId, draft));
                return;
            }
            if (interaction.isChannelSelectMenu() && interaction.customId === "hosted:welcome:exit-channel") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                const channel = await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);
                const draft = this.setWelcomeDraft(userBot.guildId, userBot.userId, {
                    exitChannelId: interaction.values[0],
                    exitChannelName: channel && "name" in channel ? channel.name : undefined
                });
                await interaction.update(buildHostedWelcomePanel(userBot.guildId, userBot.userId, draft));
                return;
            }
            if (interaction.isButton() && interaction.customId === "hosted:welcome:banner-upload") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                await interaction.showModal(buildHostedImageUploadModal("hosted:welcome:banner-upload-submit", "Upload do banner", "Banner de boas vindas"));
                return;
            }
            if (interaction.isButton() && interaction.customId === "hosted:welcome:preview") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                await interaction.reply(asEphemeral(buildHostedWelcomePreviewPanel(userBot.guildId, userBot.userId, this.getWelcomeDraft(userBot.guildId, userBot.userId))));
                return;
            }
            if (interaction.isButton() && interaction.customId === "hosted:welcome:confirm") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                const draft = this.getWelcomeDraft(userBot.guildId, userBot.userId);
                if (!hasDraft(draft)) {
                    await interaction.reply({ content: "Nao ha alteracoes pendentes para confirmar.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const current = (0, FiveMFacTokenStore_1.getFiveMWelcomeConfig)(userBot.guildId, userBot.userId);
                const template = resolveWelcomeTemplate({ ...current, ...draft });
                (0, FiveMFacTokenStore_1.saveFiveMWelcomeConfig)(userBot.guildId, {
                    ...template,
                    ...draft,
                    enabled: true,
                    confirmedAt: new Date().toISOString()
                }, userBot.userId);
                this.clearWelcomeDraft(userBot.guildId, userBot.userId);
                await interaction.update(buildHostedWelcomePanel(userBot.guildId, userBot.userId));
                await interaction.followUp({
                    content: "Modelo de boas vindas e saida salvo. A partir de agora ele sera usado quando membros entrarem ou sairem.",
                    flags: discord_js_1.MessageFlags.Ephemeral
                }).catch(() => undefined);
                return;
            }
            if (interaction.isButton() && interaction.customId === "hosted:welcome:discard") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                this.clearWelcomeDraft(userBot.guildId, userBot.userId);
                await interaction.update(buildHostedWelcomePanel(userBot.guildId, userBot.userId));
                return;
            }
            if (interaction.isStringSelectMenu() && interaction.customId === "hosted:hierarchy:level-select") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                const selectedLevelId = interaction.values[0];
                if (selectedLevelId === "__add") {
                    await interaction.showModal(buildHostedAddHierarchyLevelModal());
                    return;
                }
                const config = (0, FiveMFacTokenStore_1.getFiveMHierarchyConfig)(userBot.guildId, userBot.userId);
                const draft = this.getHierarchyDraft(userBot.guildId, userBot.userId);
                const levels = draft.levels || config.levels;
                const level = levels.find((item) => item.id === selectedLevelId);
                if (!level) {
                    await interaction.reply({ content: "Nivel nao encontrado.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                await interaction.reply(asEphemeral(buildHostedHierarchyRolePanel(level)));
                return;
            }
            if (interaction.isRoleSelectMenu() && interaction.customId.startsWith("hosted:hierarchy:role-select:")) {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                const levelId = interaction.customId.split(":").slice(3).join(":");
                const roleId = interaction.values[0];
                const config = (0, FiveMFacTokenStore_1.getFiveMHierarchyConfig)(userBot.guildId, userBot.userId);
                const draft = this.getHierarchyDraft(userBot.guildId, userBot.userId);
                const levels = [...(draft.levels || config.levels)];
                const level = levels.find((item) => item.id === levelId);
                if (!level) {
                    await interaction.reply({ content: "Nivel nao encontrado.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const nextLevels = levels.map((item) => item.id === levelId ? { ...item, roleId } : item);
                const nextDraft = this.setHierarchyDraft(userBot.guildId, userBot.userId, { levels: nextLevels });
                await interaction.update(buildHostedHierarchyPanel(userBot.guildId, userBot.userId, nextDraft));
                return;
            }
            if (interaction.isChannelSelectMenu() && interaction.customId === "hosted:hierarchy:panel-channel") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                const channel = await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);
                const nextDraft = this.setHierarchyDraft(userBot.guildId, userBot.userId, {
                    panelChannelId: interaction.values[0],
                    panelChannelName: channel && "name" in channel ? channel.name : undefined
                });
                await interaction.update(buildHostedHierarchyPanel(userBot.guildId, userBot.userId, nextDraft));
                return;
            }
            if (interaction.isButton() && interaction.customId === "hosted:hierarchy:banner-upload") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                await interaction.showModal(buildHostedImageUploadModal("hosted:hierarchy:banner-upload-submit", "Upload da hierarquia", "Banner da hierarquia"));
                return;
            }
            if (interaction.isButton() && interaction.customId === "hosted:hierarchy:preview") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                const current = (0, FiveMFacTokenStore_1.getFiveMHierarchyConfig)(userBot.guildId, userBot.userId);
                const draft = this.getHierarchyDraft(userBot.guildId, userBot.userId);
                const previewConfig = {
                    ...current,
                    ...(draft.bannerUrl ? {
                        bannerUrl: draft.bannerUrl,
                        bannerName: draft.bannerName,
                        bannerLocalPath: draft.bannerLocalPath,
                        bannerAttachmentName: draft.bannerAttachmentName,
                        bannerUpdatedAt: draft.bannerUpdatedAt
                    } : {}),
                    levels: draft.levels || current.levels
                };
                await interaction.reply(asEphemeral(await buildHostedHierarchyPublicPanel(interaction.guild, userBot.userId, previewConfig)));
                return;
            }
            if (interaction.isButton() && interaction.customId === "hosted:hierarchy:confirm") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                await this.confirmHostedHierarchyDraft(interaction, userBot.guildId, userBot.userId);
                return;
            }
            if (interaction.isButton() && interaction.customId === "hosted:hierarchy:discard") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                this.clearHierarchyDraft(userBot.guildId, userBot.userId);
                await interaction.update(buildHostedHierarchyPanel(userBot.guildId, userBot.userId));
                return;
            }
            if (interaction.isButton() && interaction.customId === "hosted:hierarchy:refresh") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                await interaction.update(await buildHostedHierarchyPublicPanel(interaction.guild, userBot.userId));
                return;
            }
            if (interaction.type === discord_js_1.InteractionType.ModalSubmit && interaction.customId === "hosted:welcome:banner-upload-submit") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                const image = this.getUploadedImage(interaction);
                if (!image) {
                    await interaction.reply({ content: "Envie uma imagem valida para usar como banner.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                let storedImage;
                try {
                    storedImage = await persistUploadedImage({
                        guildId: userBot.guildId,
                        userId: userBot.userId,
                        scope: "welcome",
                        url: image.url,
                        name: image.name
                    });
                }
                catch {
                    await interaction.reply({ content: "Nao consegui salvar a imagem. Tente enviar outra imagem.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const draft = this.setWelcomeDraft(userBot.guildId, userBot.userId, {
                    ...storedImage,
                    bannerUpdatedAt: new Date().toISOString()
                });
                await interaction.reply(asEphemeral(buildHostedWelcomePanel(userBot.guildId, userBot.userId, draft)));
                return;
            }
            if (interaction.type === discord_js_1.InteractionType.ModalSubmit && interaction.customId === "hosted:hierarchy:banner-upload-submit") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                const image = this.getUploadedImage(interaction);
                if (!image) {
                    await interaction.reply({ content: "Envie uma imagem valida para usar como banner.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                let storedImage;
                try {
                    storedImage = await persistUploadedImage({
                        guildId: userBot.guildId,
                        userId: userBot.userId,
                        scope: "hierarchy",
                        url: image.url,
                        name: image.name
                    });
                }
                catch {
                    await interaction.reply({ content: "Nao consegui salvar a imagem. Tente enviar outra imagem.", flags: discord_js_1.MessageFlags.Ephemeral });
                    return;
                }
                const draft = this.setHierarchyDraft(userBot.guildId, userBot.userId, {
                    ...storedImage,
                    bannerUpdatedAt: new Date().toISOString()
                });
                await interaction.reply(asEphemeral(buildHostedHierarchyPanel(userBot.guildId, userBot.userId, draft)));
                return;
            }
            if (interaction.type === discord_js_1.InteractionType.ModalSubmit && interaction.customId === "hosted:hierarchy:add-level") {
                if (!(await ensureHostedFacAccess())) {
                    return;
                }
                const name = interaction.fields.getTextInputValue("name").trim();
                const config = (0, FiveMFacTokenStore_1.getFiveMHierarchyConfig)(userBot.guildId, userBot.userId);
                const draft = this.getHierarchyDraft(userBot.guildId, userBot.userId);
                const levels = [...(draft.levels || config.levels)];
                const baseId = (0, FiveMFacTokenStore_1.createFiveMHierarchyLevelId)(name);
                let id = baseId;
                let suffix = 2;
                while (levels.some((level) => level.id === id)) {
                    id = `${baseId}-${suffix}`;
                    suffix += 1;
                }
                const level = { id, name, roleId: null };
                this.setHierarchyDraft(userBot.guildId, userBot.userId, { levels: [...levels, level] });
                await interaction.reply(asEphemeral(buildHostedHierarchyRolePanel(level)));
            }
        });
        try {
            await client.login(token);
            if (client.user?.id !== clientId) {
                await client.destroy();
                this.clients.delete(key);
                this.statuses.set(key, "error");
                await (0, userBotStore_1.updateUserBot)(userId, clientId, { status: "error" });
                return "error";
            }
            const guild = await client.guilds.fetch(userBot.guildId).catch(() => null);
            if (!guild) {
                await client.destroy();
                this.clients.delete(key);
                this.statuses.set(key, "error");
                await (0, userBotStore_1.updateUserBot)(userId, clientId, { status: "error" });
                return "error";
            }
            this.clients.set(key, client);
            this.statuses.set(key, "online");
            await (0, userBotStore_1.updateUserBot)(userId, clientId, { status: "online" });
            return "online";
        }
        catch {
            this.clients.delete(key);
            this.statuses.set(key, "error");
            await (0, userBotStore_1.updateUserBot)(userId, clientId, { status: "error" });
            return "error";
        }
    }
    async stopBot(userId, clientId) {
        const key = this.key(userId, clientId);
        const client = this.clients.get(key);
        if (client) {
            await client.destroy();
            this.clients.delete(key);
        }
        this.statuses.set(key, "offline");
        await (0, userBotStore_1.updateUserBot)(userId, clientId, { status: "offline" });
    }
    async restartBot(userId, clientId) {
        await this.stopBot(userId, clientId);
        return this.startBot(userId, clientId);
    }
    async restoreOnlineBots() {
        const now = Date.now();
        const expiredBots = await (0, userBotStore_1.listOverdueUserBots)(new Date(now));
        for (const bot of expiredBots) {
            await this.stopBot(bot.userId, bot.clientId);
            await (0, userBotStore_1.updateUserBot)(bot.userId, bot.clientId, { planStatus: "overdue", status: "offline" });
            console.log(`Plano vencido, bot desligado: ${bot.clientId}`);
        }
        const registeredBots = await (0, userBotStore_1.listAllUserBots)();
        const botsToRestore = registeredBots.filter((bot) => {
            const activePlan = !bot.planExpiresAt || new Date(bot.planExpiresAt).getTime() > now;
            return Boolean(bot.encryptedToken) && bot.planStatus !== "overdue" && activePlan;
        });
        if (botsToRestore.length === 0) {
            console.log("No user bots to restore.");
            return;
        }
        console.log(`Restoring ${botsToRestore.length} active user bot(s).`);
        for (const bot of botsToRestore) {
            const status = await this.startBot(bot.userId, bot.clientId);
            console.log(`Restore ${bot.clientId}: ${status}`);
        }
    }
    getStatus(userId, clientId) {
        return this.statuses.get(this.key(userId, clientId)) || "offline";
    }
}
exports.botManager = new BotManager();
