import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  Client,
  ContainerBuilder,
  Events,
  FileUploadBuilder,
  GatewayIntentBits,
  InteractionType,
  LabelBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  RoleSelectMenuBuilder,
  Routes,
  SeparatorBuilder,
  SectionBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type GuildMember
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { apiConfig } from "../config";
import { decryptToken } from "../security/tokenCrypto";
import {
  createFiveMHierarchyLevelId,
  getFiveMHierarchyConfig,
  getFiveMWelcomeConfig,
  hasFiveMFacAccess,
  saveFiveMFacPanelActivation,
  saveFiveMHierarchyConfig,
  saveFiveMWelcomeConfig,
  useFiveMFacToken,
  type FiveMHierarchyConfig,
  type FiveMHierarchyLevel
} from "./FiveMFacTokenStore";
import { findUserBot, listAllUserBots, listOverdueUserBots, updateUserBot } from "../storage/userBotStore";

type BotStatus = "online" | "offline" | "error";
type HostedActionRow = ActionRowBuilder<ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder>;
type HostedV2Payload = {
  components: ContainerBuilder[];
  flags: readonly [MessageFlags.IsComponentsV2];
  files?: AttachmentBuilder[];
};
type HostedEphemeralV2Payload = Omit<HostedV2Payload, "flags"> & {
  flags: readonly [MessageFlags.Ephemeral, MessageFlags.IsComponentsV2];
};
type WelcomeDraft = {
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
type HierarchyDraft = {
  levels?: FiveMHierarchyLevel[];
  panelChannelId?: string;
  panelChannelName?: string;
  bannerUrl?: string;
  bannerName?: string;
  bannerLocalPath?: string;
  bannerAttachmentName?: string;
  bannerUpdatedAt?: string;
};

type WelcomeTemplate = {
  entryTitle: string;
  entryMessage: string;
  dmMessage: string;
  exitTitle: string;
  exitMessage: string;
};

type WelcomeTemplateContext = {
  id: string;
  user: string;
  mention: string;
  username: string;
  tag: string;
  server: string;
  memberCount: string;
  firstStep: string;
  joinedAt: string;
};

const defaultWelcomeTemplate: WelcomeTemplate = {
  entryTitle: "Novo membro na comunidade",
  entryMessage: "Seja bem-vindo. Faca a verificacao, leia as regras e use os tickets somente quando precisar de atendimento.",
  dmMessage: "Bem-vindo(a) ao servidor {server}, {username}! Que sua chegada seja tranquila por aqui.",
  exitTitle: "Ate logo, {username}",
  exitMessage: "{user} saiu de **{server}**.\nUsuario: {tag} | ID: {id}"
};

const legacyWelcomeTemplate: WelcomeTemplate = {
  entryTitle: "Boas vindas",
  entryMessage: "Seja bem-vindo(a), {user}! Voce entrou em {server}.\nAgora somos {memberCount} membros.",
  dmMessage: "Bem-vindo(a) ao servidor {server}, {username}! Que sua chegada seja tranquila por aqui.",
  exitTitle: "Saida do servidor",
  exitMessage: "{user} saiu do servidor {server}.\nUsuario: {tag} | ID: {id}"
};

const welcomePlaceholderAliases: Record<string, keyof WelcomeTemplateContext> = {
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

function valueOrDefault(value: unknown, fallback: string, legacy?: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  return legacy && value === legacy ? fallback : value;
}

function resolveWelcomeTemplate(config: Record<string, unknown> = {}): WelcomeTemplate {
  return {
    entryTitle: valueOrDefault(config.entryTitle, defaultWelcomeTemplate.entryTitle, legacyWelcomeTemplate.entryTitle),
    entryMessage: valueOrDefault(config.entryMessage, defaultWelcomeTemplate.entryMessage, legacyWelcomeTemplate.entryMessage),
    dmMessage: valueOrDefault(config.dmMessage, defaultWelcomeTemplate.dmMessage, legacyWelcomeTemplate.dmMessage),
    exitTitle: valueOrDefault(config.exitTitle, defaultWelcomeTemplate.exitTitle, legacyWelcomeTemplate.exitTitle),
    exitMessage: valueOrDefault(config.exitMessage, defaultWelcomeTemplate.exitMessage, legacyWelcomeTemplate.exitMessage)
  };
}

function renderWelcomeTemplate(template: string, context: WelcomeTemplateContext): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) => {
    const contextKey = welcomePlaceholderAliases[key];
    return contextKey ? context[contextKey] : match;
  });
}

function normalizeChannelName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function findWelcomeFirstStep(guild: Guild): string {
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

function formatWelcomeDate(date = new Date()): string {
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

function buildWelcomeTemplateContext(member: GuildMember): WelcomeTemplateContext {
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

function compactTemplatePreview(template: string): string {
  return template.replace(/\s+/g, " ").trim();
}

function sanitizeImageFileName(name: string, fallback: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return cleaned || fallback;
}

function bannerRelativePath(guildId: string, userId: string, scope: "welcome" | "hierarchy", fileName: string): string {
  return path.join("data", "fivem-fac-banners", guildId, userId, `${scope}-${fileName}`);
}

function bannerImageOptions(config: Record<string, unknown>): { imagePath?: string; imageName?: string; imageUrl?: string | null } {
  const localPath = typeof config.bannerLocalPath === "string" ? path.resolve(process.cwd(), config.bannerLocalPath) : null;
  const attachmentName = typeof config.bannerAttachmentName === "string"
    ? config.bannerAttachmentName
    : localPath
      ? path.basename(localPath)
      : null;

  if (localPath && attachmentName && fs.existsSync(localPath)) {
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

async function persistUploadedImage(input: {
  guildId: string;
  userId: string;
  scope: "welcome" | "hierarchy";
  url: string;
  name: string;
}): Promise<{ bannerUrl: string; bannerName: string; bannerLocalPath: string; bannerAttachmentName: string }> {
  const fileName = sanitizeImageFileName(input.name, `${input.scope}-banner.png`);
  const relativePath = bannerRelativePath(input.guildId, input.userId, input.scope, fileName);
  const absolutePath = path.resolve(process.cwd(), relativePath);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  const response = await fetch(input.url);
  if (!response.ok) {
    throw new Error("Nao foi possivel baixar a imagem enviada.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(absolutePath, buffer);

  return {
    bannerUrl: input.url,
    bannerName: input.name,
    bannerLocalPath: relativePath,
    bannerAttachmentName: fileName
  };
}

function claimMemberEvent(input: {
  guildId: string;
  userId: string;
  memberId: string;
  type: "welcome" | "exit";
  ttlMs?: number;
}): boolean {
  const ttlMs = input.ttlMs || 15_000;
  const dir = path.join(process.cwd(), "data", "fivem-fac-event-locks", input.guildId, input.userId);
  const filePath = path.join(dir, `${input.type}-${input.memberId}.lock`);

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

function buildActivationCommands(hasAccess: boolean) {
  const commands = [];

  if (!hasAccess) {
    commands.push(
      new SlashCommandBuilder()
        .setName("ativar")
        .setDescription("Ativa o Painel fac usando o codigo de 4 digitos.")
        .toJSON()
    );
  }

  if (hasAccess) {
    commands.push(
      new SlashCommandBuilder()
        .setName("painel-fac")
        .setDescription("Abre o painel fac liberado para este servidor.")
        .toJSON()
    );
  }

  return commands;
}

async function registerActivationCommands(applicationId: string, guildId: string, token: string, hasAccess: boolean): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
    body: buildActivationCommands(hasAccess)
  });
}

function buildActivationModal(): ModalBuilder {
  const tokenInput = new TextInputBuilder()
    .setCustomId("token")
    .setLabel("Codigo de 4 digitos")
    .setPlaceholder("Ex: 1234")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(4);

  return new ModalBuilder()
    .setCustomId("hosted:activate-fac")
    .setTitle("Ativar Painel fac")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(tokenInput)
    );
}

function asEphemeral(payload: HostedV2Payload): HostedEphemeralV2Payload {
  return {
    components: payload.components,
    flags: [MessageFlags.Ephemeral, MessageFlags.IsComponentsV2] as const,
    ...(payload.files ? { files: payload.files } : {})
  };
}

function buildHostedV2Panel(
  lines: string[],
  rows: HostedActionRow[] = [],
  options: { imageUrl?: string | null; imagePath?: string | null; imageName?: string | null } = {}
): HostedV2Payload {
  const container = new ContainerBuilder();
  const files: AttachmentBuilder[] = [];

  if (options.imagePath && options.imageName && fs.existsSync(options.imagePath)) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${options.imageName}`)
      )
    );
    files.push(new AttachmentBuilder(options.imagePath, { name: options.imageName }));
  } else if (options.imageUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(options.imageUrl)
      )
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lines.join("\n"))
  );

  if (rows.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());

    for (const row of rows) {
      container.addActionRowComponents(row);
    }
  }

  return {
    components: [container],
    flags: [MessageFlags.IsComponentsV2] as const,
    ...(files.length > 0 ? { files } : {})
  };
}

function buildHostedMemberWelcomePanel(member: GuildMember, template: WelcomeTemplate, context: WelcomeTemplateContext): HostedV2Payload {
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
    flags: [MessageFlags.IsComponentsV2] as const
  };
}

function hasDraft(draft?: Record<string, unknown>): boolean {
  return Boolean(draft && Object.keys(draft).length > 0);
}

function buildHostedToolSelectRow(): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
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
      ])
  );
}

function buildHostedFiveMFacPanel(guildId: string, userId: string) {
  return buildHostedV2Panel([
      "## Painel fac",
      `Servidor: ${guildId}`,
      `Responsavel: <@${userId}>`,
      "",
      "Escolha uma ferramenta para configurar."
    ],
    [
      buildHostedToolSelectRow() as ActionRowBuilder<ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder>,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("hosted:fivem-fac:publish-preview")
          .setLabel("Publicar neste canal")
          .setStyle(ButtonStyle.Success)
      ) as ActionRowBuilder<ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder>
    ]);
}

function buildHostedPublishConfirmPanel(guildId: string, userId: string) {
  return buildHostedV2Panel([
    "## Confirmar publicacao",
    "Este painel sera publicado no canal atual.",
    "",
    "Preview:",
    `Servidor: ${guildId}`,
    `Responsavel: <@${userId}>`,
    "Ferramentas: Boas vindas e Hierarquia"
  ], [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("hosted:fivem-fac:publish-confirm")
        .setLabel("Confirmar")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("hosted:fivem-fac:back")
        .setLabel("Cancelar")
        .setStyle(ButtonStyle.Secondary)
    ) as HostedActionRow
  ]);
}

function buildHostedFixedFiveMFacPanel(guildId: string, userId: string) {
  return buildHostedV2Panel([
      "## Painel fac",
      `Servidor: ${guildId}`,
      `Responsavel: <@${userId}>`,
      "",
      "Selecione a ferramenta que deseja usar."
    ],
    [
      buildHostedToolSelectRow() as ActionRowBuilder<ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder>
    ]);
}

function buildHostedWelcomePanel(guildId: string, userId: string, draft: WelcomeDraft = {}) {
  const savedConfig = getFiveMWelcomeConfig(guildId, userId);
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
    ],
    [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("hosted:welcome:entry-channel")
          .setPlaceholder("Escolha o canal de entrada")
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1)
      ) as ActionRowBuilder<ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder>,
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("hosted:welcome:exit-channel")
          .setPlaceholder("Escolha o canal de saida")
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1)
      ) as ActionRowBuilder<ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder>,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("hosted:welcome:banner-upload")
          .setLabel("Adicionar banner")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("hosted:welcome:preview")
          .setLabel("Preview")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("hosted:welcome:confirm")
          .setLabel("Confirmar")
          .setStyle(ButtonStyle.Success)
          .setDisabled(!pending),
        new ButtonBuilder()
          .setCustomId("hosted:welcome:discard")
          .setLabel("Descartar")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(!pending),
        new ButtonBuilder()
          .setCustomId("hosted:fivem-fac:back")
          .setLabel("Voltar")
          .setStyle(ButtonStyle.Secondary)
      ) as ActionRowBuilder<ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder>
    ], bannerImageOptions(config));
}

function buildHostedWelcomePreviewPanel(guildId: string, userId: string, draft: WelcomeDraft = {}) {
  const config = {
    ...getFiveMWelcomeConfig(guildId, userId),
    ...draft
  };
  const template = resolveWelcomeTemplate(config);
  const context: WelcomeTemplateContext = {
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

function buildHostedHierarchyPanel(guildId: string, userId: string, draft: HierarchyDraft = {}) {
  const config = getFiveMHierarchyConfig(guildId, userId);
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
    ],
    [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("hosted:hierarchy:level-select")
          .setPlaceholder("Editar nivel ou adicionar")
          .addOptions(levelOptions)
      ) as ActionRowBuilder<ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder>,
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId("hosted:hierarchy:panel-channel")
          .setPlaceholder("Escolha o canal do painel de hierarquia")
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1)
      ) as ActionRowBuilder<ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder>,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("hosted:hierarchy:banner-upload")
          .setLabel("Adicionar banner")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("hosted:hierarchy:preview")
          .setLabel("Preview")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("hosted:hierarchy:confirm")
          .setLabel("Confirmar")
          .setStyle(ButtonStyle.Success)
          .setDisabled(!pending),
        new ButtonBuilder()
          .setCustomId("hosted:hierarchy:discard")
          .setLabel("Descartar")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(!pending),
        new ButtonBuilder()
          .setCustomId("hosted:fivem-fac:back")
          .setLabel("Voltar")
          .setStyle(ButtonStyle.Secondary)
      ) as ActionRowBuilder<ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder>
    ], bannerImageOptions({ ...config, ...draft, bannerUrl }));
}

function buildHostedHierarchyRolePanel(level: FiveMHierarchyLevel) {
  return buildHostedV2Panel([
      "## Cargo da hierarquia",
      `Nivel: ${level.name}`,
      level.roleId ? `Cargo atual: <@&${level.roleId}>` : "Cargo atual: nao configurado"
    ],
    [
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`hosted:hierarchy:role-select:${level.id}`)
          .setPlaceholder(`Escolha o cargo de ${level.name}`)
          .setMinValues(1)
          .setMaxValues(1)
      ) as ActionRowBuilder<ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder>
    ]);
}

function buildHostedImageUploadModal(customId: string, title: string, label: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(label)
        .setDescription("Selecione uma imagem do seu computador.")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("image")
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(1)
        )
    );
}

function buildHostedAddHierarchyLevelModal(): ModalBuilder {
  const nameInput = new TextInputBuilder()
    .setCustomId("name")
    .setLabel("Nome da hierarquia")
    .setPlaceholder("Ex: Soldado")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(50);

  return new ModalBuilder()
    .setCustomId("hosted:hierarchy:add-level")
    .setTitle("Adicionar hierarquia")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput)
    );
}

async function buildHostedHierarchyPublicPanel(guild: Guild, userId: string, override?: FiveMHierarchyConfig) {
  const config = override || getFiveMHierarchyConfig(guild.id, userId);
  const lines = [
    "## Hierarquia da Fac",
    "Painel automatico de cargos da faccao."
  ];

  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const assignedLevelByMember = new Map<string, string>();

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
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("hosted:hierarchy:refresh")
          .setLabel("Atualizar")
          .setStyle(ButtonStyle.Primary)
      ) as ActionRowBuilder<ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder>
    ], bannerImageOptions(config));
}

class BotManager {
  private clients = new Map<string, Client>();
  private statuses = new Map<string, BotStatus>();
  private pendingWelcomeDrafts = new Map<string, WelcomeDraft>();
  private pendingHierarchyDrafts = new Map<string, HierarchyDraft>();

  private key(userId: string, clientId: string): string {
    return `${userId}:${clientId}`;
  }

  private draftKey(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }

  private getWelcomeDraft(guildId: string, userId: string): WelcomeDraft {
    return this.pendingWelcomeDrafts.get(this.draftKey(guildId, userId)) || {};
  }

  private setWelcomeDraft(guildId: string, userId: string, patch: WelcomeDraft): WelcomeDraft {
    const key = this.draftKey(guildId, userId);
    const draft = {
      ...(this.pendingWelcomeDrafts.get(key) || {}),
      ...patch
    };

    this.pendingWelcomeDrafts.set(key, draft);
    return draft;
  }

  private clearWelcomeDraft(guildId: string, userId: string): void {
    this.pendingWelcomeDrafts.delete(this.draftKey(guildId, userId));
  }

  private getHierarchyDraft(guildId: string, userId: string): HierarchyDraft {
    return this.pendingHierarchyDrafts.get(this.draftKey(guildId, userId)) || {};
  }

  private setHierarchyDraft(guildId: string, userId: string, patch: HierarchyDraft): HierarchyDraft {
    const key = this.draftKey(guildId, userId);
    const draft = {
      ...(this.pendingHierarchyDrafts.get(key) || {}),
      ...patch
    };

    this.pendingHierarchyDrafts.set(key, draft);
    return draft;
  }

  private clearHierarchyDraft(guildId: string, userId: string): void {
    this.pendingHierarchyDrafts.delete(this.draftKey(guildId, userId));
  }

  private isImageAttachment(attachment: { contentType: string | null; name: string | null; url: string }): boolean {
    return Boolean(
      attachment.contentType?.startsWith("image/")
      || /\.(png|jpe?g|gif|webp)$/i.test(attachment.name || attachment.url || "")
    );
  }

  private getUploadedImage(interaction: any): { url: string; name: string } | null {
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

  private async sendHostedWelcomeMessage(member: GuildMember, userId: string): Promise<void> {
    const config = getFiveMWelcomeConfig(member.guild.id, userId);
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
      if (channel && typeof (channel as any).send === "function") {
        const payload = buildHostedMemberWelcomePanel(member, template, context);

        await (channel as any).send({
          ...payload,
          allowedMentions: { users: [member.id] },
        }).catch(() => undefined);
      }
    }
  }

  private async sendHostedExitMessage(member: GuildMember, userId: string): Promise<void> {
    const config = getFiveMWelcomeConfig(member.guild.id, userId);
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
    if (!channel || typeof (channel as any).send !== "function") {
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

    const sent = await (channel as any).send({
      ...payload,
      allowedMentions: { users: [member.id] }
    }).catch(() => undefined);

    if (!sent) {
      console.error(`[fac-welcome] falha ao enviar saida guildId=${member.guild.id} userId=${userId} memberId=${member.id} channelId=${channelId}`);
    }
  }

  private async updateHostedHierarchyPublicPanel(guild: Guild, userId: string): Promise<boolean> {
    const config = getFiveMHierarchyConfig(guild.id, userId);
    const panel = config.panel;

    if (!panel?.channelId || !panel.messageId) {
      return false;
    }

    const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
    if (!channel || typeof (channel as any).messages?.fetch !== "function") {
      return false;
    }

    const message = await (channel as any).messages.fetch(panel.messageId).catch(() => null);
    if (!message) {
      return false;
    }

    await message.edit(await buildHostedHierarchyPublicPanel(guild, userId)).catch(() => undefined);
    return true;
  }

  private async confirmHostedHierarchyDraft(interaction: any, guildId: string, userId: string): Promise<void> {
    const draft = this.getHierarchyDraft(guildId, userId);

    if (!hasDraft(draft)) {
      await interaction.reply({ content: "Nao ha alteracoes pendentes para confirmar.", flags: MessageFlags.Ephemeral });
      return;
    }

    const current = getFiveMHierarchyConfig(guildId, userId);
    const nextConfig: FiveMHierarchyConfig = {
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
        await interaction.reply({ content: "Nao consegui publicar o painel de hierarquia nesse canal. Confira as permissoes do bot.", flags: MessageFlags.Ephemeral });
        return;
      }

      const panelMessage = await channel.send(await buildHostedHierarchyPublicPanel(interaction.guild, userId, nextConfig)).catch(() => null);

      if (!panelMessage) {
        await interaction.reply({ content: "Nao consegui publicar o painel de hierarquia nesse canal. Confira as permissoes do bot.", flags: MessageFlags.Ephemeral });
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

    saveFiveMHierarchyConfig(guildId, nextConfig, userId);
    this.clearHierarchyDraft(guildId, userId);

    if (!draft.panelChannelId) {
      await this.updateHostedHierarchyPublicPanel(interaction.guild, userId);
    }

    await interaction.update(buildHostedHierarchyPanel(guildId, userId));
  }

  async startBot(userId: string, clientId: string): Promise<BotStatus> {
    const key = this.key(userId, clientId);
    const existing = this.clients.get(key);

    if (existing?.isReady()) {
      return "online";
    }

    const userBot = await findUserBot(userId, clientId);
    if (!userBot) {
      return "offline";
    }

    if (userBot.planExpiresAt && new Date(userBot.planExpiresAt).getTime() <= Date.now()) {
      await updateUserBot(userId, clientId, { planStatus: "overdue", status: "offline" });
      this.statuses.set(key, "offline");
      return "offline";
    }

    if (!userBot.encryptedToken) {
      this.statuses.set(key, "offline");
      await updateUserBot(userId, clientId, { status: "offline" });
      return "offline";
    }

    const token = decryptToken(userBot.encryptedToken);
    const intents = [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages
    ];

    if (apiConfig.hostedBotsEnableMemberEvents) {
      intents.push(GatewayIntentBits.GuildMembers);
    }

    const client = new Client({ intents });

    client.once(Events.ClientReady, async () => {
      const guild = client.guilds.cache.get(userBot.guildId);
      const status: BotStatus = guild ? "online" : "error";
      this.statuses.set(key, status);
      await updateUserBot(userId, clientId, { status });

      if (guild) {
        await registerActivationCommands(
          clientId,
          userBot.guildId,
          token,
          hasFiveMFacAccess(userBot.guildId, userBot.userId)
        ).catch((error) => {
          console.error(`Nao foi possivel registrar comandos fac do bot ${clientId}:`, error.message);
        });
      }
    });

    client.on(Events.Error, async () => {
      this.statuses.set(key, "error");
      await updateUserBot(userId, clientId, { status: "error" });
    });

    client.on(Events.MessageCreate, async (message) => {
      if (!message.guild || message.guild.id !== userBot.guildId) {
        return;
      }

      if (message.author.id !== userBot.targetUserId || message.author.id === client.user?.id) {
        return;
      }

      const botMember = message.guild.members.me;
      if (!botMember?.permissionsIn(message.channelId).has(PermissionFlagsBits.ManageMessages)) {
        return;
      }

      await message.delete().catch(() => undefined);
    });

    if (apiConfig.hostedBotsEnableMemberEvents) {
      client.on(Events.GuildMemberAdd, async (member) => {
        if (member.guild.id !== userBot.guildId) {
          return;
        }

        await this.sendHostedWelcomeMessage(member, userBot.userId);
      });

      client.on(Events.GuildMemberRemove, async (member) => {
        if (member.guild.id !== userBot.guildId) {
          return;
        }

        await this.sendHostedExitMessage(member as GuildMember, userBot.userId);
      });

      client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
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

    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.guild || interaction.guild.id !== userBot.guildId) {
        return;
      }

      const ensureHostedFacAccess = async (): Promise<boolean> => {
        if (!interaction.isRepliable()) {
          return false;
        }

        if (interaction.user.id !== userBot.userId) {
          await interaction.reply({ content: "Apenas o usuario que hospedou este bot pode acessar este Painel fac.", flags: MessageFlags.Ephemeral });
          return false;
        }

        if (!hasFiveMFacAccess(userBot.guildId, userBot.userId)) {
          await interaction.reply({ content: "Use /ativar com o codigo de 4 digitos para liberar o Painel fac.", flags: MessageFlags.Ephemeral });
          return false;
        }

        return true;
      };

      if (interaction.isChatInputCommand() && interaction.commandName === "ativar") {
        if (interaction.user.id !== userBot.userId) {
          await interaction.reply({ content: "Apenas o usuario que hospedou este bot pode ativar o Painel fac.", flags: MessageFlags.Ephemeral });
          return;
        }

        if (hasFiveMFacAccess(userBot.guildId, userBot.userId)) {
          await interaction.reply({ content: "O Painel fac ja esta liberado. Use /painel-fac.", flags: MessageFlags.Ephemeral });
          return;
        }

        await interaction.showModal(buildActivationModal());
        return;
      }

      if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "hosted:activate-fac") {
        if (interaction.user.id !== userBot.userId) {
          await interaction.reply({ content: "Apenas o usuario que hospedou este bot pode ativar o Painel fac.", flags: MessageFlags.Ephemeral });
          return;
        }

        const facToken = interaction.fields.getTextInputValue("token").trim();
        if (!/^\d{4}$/.test(facToken)) {
          await interaction.reply({ content: "O codigo precisa ter exatamente 4 digitos.", flags: MessageFlags.Ephemeral });
          return;
        }

        const result = useFiveMFacToken({
          guildId: userBot.guildId,
          token: facToken,
          userId: userBot.userId
        });

        if (!result.ok) {
          await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
          return;
        }

        await registerActivationCommands(clientId, userBot.guildId, token, true).catch((error) => {
          console.error(`Nao foi possivel trocar /ativar por /painel-fac no bot ${clientId}:`, error.message);
        });
        await interaction.reply({ content: "Painel fac liberado. O comando /ativar foi removido e /painel-fac foi ativado para este bot.", flags: MessageFlags.Ephemeral });
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

        if (!interaction.channel || typeof (interaction.channel as any).send !== "function") {
          await interaction.reply({ content: "Nao consegui publicar painel nesse canal.", flags: MessageFlags.Ephemeral });
          return;
        }

        const panelMessage = await (interaction.channel as any).send(buildHostedFixedFiveMFacPanel(userBot.guildId, userBot.userId)).catch(() => null);

        if (!panelMessage) {
          await interaction.reply({ content: "Nao consegui enviar o Painel fac nesse canal. Confira as permissoes do bot.", flags: MessageFlags.Ephemeral });
          return;
        }

        await panelMessage.pin("Painel fac FiveM").catch(() => undefined);
        saveFiveMFacPanelActivation({
          guildId: userBot.guildId,
          userId: userBot.userId,
          channelId: interaction.channelId,
          channelName: "name" in interaction.channel && typeof interaction.channel.name === "string" ? interaction.channel.name : undefined,
          messageId: panelMessage.id
        });

        await interaction.reply({ content: "Painel fac publicado neste canal.", flags: MessageFlags.Ephemeral });
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

        await interaction.reply({ content: "Ferramenta nao encontrada.", flags: MessageFlags.Ephemeral });
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
          await interaction.reply({ content: "Nao ha alteracoes pendentes para confirmar.", flags: MessageFlags.Ephemeral });
          return;
        }

        const current = getFiveMWelcomeConfig(userBot.guildId, userBot.userId);
        const template = resolveWelcomeTemplate({ ...current, ...draft });
        saveFiveMWelcomeConfig(userBot.guildId, {
          ...template,
          ...draft,
          enabled: true,
          confirmedAt: new Date().toISOString()
        }, userBot.userId);
        this.clearWelcomeDraft(userBot.guildId, userBot.userId);
        await interaction.update(buildHostedWelcomePanel(userBot.guildId, userBot.userId));
        await interaction.followUp({
          content: "Modelo de boas vindas e saida salvo. A partir de agora ele sera usado quando membros entrarem ou sairem.",
          flags: MessageFlags.Ephemeral
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

        const config = getFiveMHierarchyConfig(userBot.guildId, userBot.userId);
        const draft = this.getHierarchyDraft(userBot.guildId, userBot.userId);
        const levels = draft.levels || config.levels;
        const level = levels.find((item) => item.id === selectedLevelId);

        if (!level) {
          await interaction.reply({ content: "Nivel nao encontrado.", flags: MessageFlags.Ephemeral });
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
        const config = getFiveMHierarchyConfig(userBot.guildId, userBot.userId);
        const draft = this.getHierarchyDraft(userBot.guildId, userBot.userId);
        const levels = [...(draft.levels || config.levels)];
        const level = levels.find((item) => item.id === levelId);

        if (!level) {
          await interaction.reply({ content: "Nivel nao encontrado.", flags: MessageFlags.Ephemeral });
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

        const current = getFiveMHierarchyConfig(userBot.guildId, userBot.userId);
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

      if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "hosted:welcome:banner-upload-submit") {
        if (!(await ensureHostedFacAccess())) {
          return;
        }

        const image = this.getUploadedImage(interaction);
        if (!image) {
          await interaction.reply({ content: "Envie uma imagem valida para usar como banner.", flags: MessageFlags.Ephemeral });
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
        } catch {
          await interaction.reply({ content: "Nao consegui salvar a imagem. Tente enviar outra imagem.", flags: MessageFlags.Ephemeral });
          return;
        }

        const draft = this.setWelcomeDraft(userBot.guildId, userBot.userId, {
          ...storedImage,
          bannerUpdatedAt: new Date().toISOString()
        });

        await interaction.reply(asEphemeral(buildHostedWelcomePanel(userBot.guildId, userBot.userId, draft)));
        return;
      }

      if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "hosted:hierarchy:banner-upload-submit") {
        if (!(await ensureHostedFacAccess())) {
          return;
        }

        const image = this.getUploadedImage(interaction);
        if (!image) {
          await interaction.reply({ content: "Envie uma imagem valida para usar como banner.", flags: MessageFlags.Ephemeral });
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
        } catch {
          await interaction.reply({ content: "Nao consegui salvar a imagem. Tente enviar outra imagem.", flags: MessageFlags.Ephemeral });
          return;
        }

        const draft = this.setHierarchyDraft(userBot.guildId, userBot.userId, {
          ...storedImage,
          bannerUpdatedAt: new Date().toISOString()
        });

        await interaction.reply(asEphemeral(buildHostedHierarchyPanel(userBot.guildId, userBot.userId, draft)));
        return;
      }

      if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "hosted:hierarchy:add-level") {
        if (!(await ensureHostedFacAccess())) {
          return;
        }

        const name = interaction.fields.getTextInputValue("name").trim();
        const config = getFiveMHierarchyConfig(userBot.guildId, userBot.userId);
        const draft = this.getHierarchyDraft(userBot.guildId, userBot.userId);
        const levels = [...(draft.levels || config.levels)];
        const baseId = createFiveMHierarchyLevelId(name);
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
        await updateUserBot(userId, clientId, { status: "error" });
        return "error";
      }

      const guild = await client.guilds.fetch(userBot.guildId).catch(() => null);
      if (!guild) {
        await client.destroy();
        this.clients.delete(key);
        this.statuses.set(key, "error");
        await updateUserBot(userId, clientId, { status: "error" });
        return "error";
      }

      this.clients.set(key, client);
      this.statuses.set(key, "online");
      await updateUserBot(userId, clientId, { status: "online" });
      return "online";
    } catch {
      this.clients.delete(key);
      this.statuses.set(key, "error");
      await updateUserBot(userId, clientId, { status: "error" });
      return "error";
    }
  }

  async stopBot(userId: string, clientId: string): Promise<void> {
    const key = this.key(userId, clientId);
    const client = this.clients.get(key);

    if (client) {
      await client.destroy();
      this.clients.delete(key);
    }

    this.statuses.set(key, "offline");
    await updateUserBot(userId, clientId, { status: "offline" });
  }

  async restartBot(userId: string, clientId: string): Promise<BotStatus> {
    await this.stopBot(userId, clientId);
    return this.startBot(userId, clientId);
  }

  async restoreOnlineBots(): Promise<void> {
    const now = Date.now();
    const expiredBots = await listOverdueUserBots(new Date(now));

    for (const bot of expiredBots) {
      await this.stopBot(bot.userId, bot.clientId);
      await updateUserBot(bot.userId, bot.clientId, { planStatus: "overdue", status: "offline" });
      console.log(`Plano vencido, bot desligado: ${bot.clientId}`);
    }

    const registeredBots = await listAllUserBots();
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

  getStatus(userId: string, clientId: string): BotStatus {
    return this.statuses.get(this.key(userId, clientId)) || "offline";
  }
}

export const botManager = new BotManager();
