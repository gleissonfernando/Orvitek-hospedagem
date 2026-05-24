import {
  ChatInputCommandInteraction,
  Client,
  Events,
  GuildMember,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";
import { getHierarchyConfig, saveHierarchyConfig, type HierarchyConfig } from "../storage/hierarchyStore";

const hierarchyCommandNames = ["herarquia", "hierarquia"];

const hierarchyCommands = hierarchyCommandNames.map((name) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription("Gerencia cargos automaticos e hierarquia deste servidor.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("ver")
        .setDescription("Mostra a hierarquia e os cargos automaticos configurados.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("nivel")
        .setDescription("Adiciona ou atualiza um nivel da hierarquia.")
        .addStringOption((option) =>
          option
            .setName("nome")
            .setDescription("Nome do nivel. Ex: lider, gerente, suporte.")
            .setRequired(true)
            .setMaxLength(40)
        )
        .addRoleOption((option) =>
          option
            .setName("cargo")
            .setDescription("Cargo desse nivel.")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remover-nivel")
        .setDescription("Remove um nivel da hierarquia.")
        .addStringOption((option) =>
          option
            .setName("nome")
            .setDescription("Nome do nivel que sera removido.")
            .setRequired(true)
            .setMaxLength(40)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("aplicar")
        .setDescription("Aplica um nivel da hierarquia a um membro.")
        .addUserOption((option) =>
          option
            .setName("usuario")
            .setDescription("Usuario que recebera o cargo.")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("nivel")
            .setDescription("Nome do nivel configurado.")
            .setRequired(true)
            .setMaxLength(40)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("autocargo")
        .setDescription("Adiciona ou remove cargo automatico para novos membros.")
        .addStringOption((option) =>
          option
            .setName("acao")
            .setDescription("O que fazer com o cargo automatico.")
            .setRequired(true)
            .addChoices(
              { name: "adicionar", value: "adicionar" },
              { name: "remover", value: "remover" }
            )
        )
        .addRoleOption((option) =>
          option
            .setName("cargo")
            .setDescription("Cargo automatico.")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("resetar")
        .setDescription("Apaga a hierarquia e os cargos automaticos configurados.")
    )
    .toJSON()
);

function normalizeLevelName(name: string): string {
  return name.trim().toLowerCase();
}

function canManageHierarchy(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.inCachedGuild()) {
    return false;
  }

  return interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles);
}

function formatConfig(config: HierarchyConfig): string {
  const levels = config.levels.length > 0
    ? config.levels.map((level, index) => `${index + 1}. ${level.name}: <@&${level.roleId}>`).join("\n")
    : "Nenhum nivel configurado.";

  const autoRoles = config.autoRoleIds.length > 0
    ? config.autoRoleIds.map((roleId) => `<@&${roleId}>`).join(", ")
    : "Nenhum cargo automatico configurado.";

  return [
    "## Hierarquia",
    levels,
    "",
    "## Cargos automaticos",
    autoRoles
  ].join("\n");
}

async function ensureManagePermission(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (canManageHierarchy(interaction)) {
    return true;
  }

  await interaction.reply({
    content: "Voce precisa da permissao Gerenciar Cargos para configurar a hierarquia.",
    ephemeral: true
  });
  return false;
}

export async function registerHierarchyCommands(applicationId: string, guildId: string, token: string): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
    body: hierarchyCommands
  });
}

export function attachHierarchySystem(client: Client, clientId: string, guildId: string, token: string): void {
  client.once(Events.ClientReady, async () => {
    const applicationId = client.user?.id;
    if (!applicationId) {
      return;
    }

    await registerHierarchyCommands(applicationId, guildId, token).catch((error) => {
      console.error(`Nao foi possivel registrar /herarquia no bot ${clientId}:`, error.message);
    });
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    await applyAutoRoles(clientId, member);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || !hierarchyCommandNames.includes(interaction.commandName)) {
      return;
    }

    await handleHierarchyCommand(clientId, interaction);
  });
}

async function applyAutoRoles(clientId: string, member: GuildMember): Promise<void> {
  const config = await getHierarchyConfig(clientId, member.guild.id);

  if (config.autoRoleIds.length === 0) {
    return;
  }

  const manageableRoleIds = config.autoRoleIds.filter((roleId) => {
    const role = member.guild.roles.cache.get(roleId);
    return role?.editable;
  });

  if (manageableRoleIds.length === 0) {
    return;
  }

  await member.roles.add(manageableRoleIds, "Cargos automaticos da hierarquia Orvitek").catch(() => undefined);
}

async function handleHierarchyCommand(clientId: string, interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId || !interaction.inCachedGuild()) {
    await interaction.reply({ content: "Use este comando dentro de um servidor.", ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const config = await getHierarchyConfig(clientId, interaction.guildId);

  if (subcommand === "ver") {
    await interaction.reply({ content: formatConfig(config), ephemeral: true });
    return;
  }

  if (!await ensureManagePermission(interaction)) {
    return;
  }

  if (subcommand === "nivel") {
    const name = normalizeLevelName(interaction.options.getString("nome", true));
    const role = interaction.options.getRole("cargo", true);
    const nextLevels = config.levels.filter((level) => normalizeLevelName(level.name) !== name);

    nextLevels.push({ name, roleId: role.id });
    await saveHierarchyConfig({ ...config, levels: nextLevels });
    await interaction.reply({ content: `Nivel ${name} configurado com o cargo <@&${role.id}>.`, ephemeral: true });
    return;
  }

  if (subcommand === "remover-nivel") {
    const name = normalizeLevelName(interaction.options.getString("nome", true));
    const nextLevels = config.levels.filter((level) => normalizeLevelName(level.name) !== name);

    await saveHierarchyConfig({ ...config, levels: nextLevels });
    await interaction.reply({ content: `Nivel ${name} removido.`, ephemeral: true });
    return;
  }

  if (subcommand === "aplicar") {
    const user = interaction.options.getUser("usuario", true);
    const levelName = normalizeLevelName(interaction.options.getString("nivel", true));
    const level = config.levels.find((item) => normalizeLevelName(item.name) === levelName);

    if (!level) {
      await interaction.reply({ content: "Esse nivel ainda nao foi configurado.", ephemeral: true });
      return;
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const role = interaction.guild.roles.cache.get(level.roleId);

    if (!member || !role) {
      await interaction.reply({ content: "Nao encontrei o membro ou o cargo configurado.", ephemeral: true });
      return;
    }

    if (!role.editable) {
      await interaction.reply({ content: "Nao consigo aplicar esse cargo. Coloque o cargo do bot acima dele na hierarquia do Discord.", ephemeral: true });
      return;
    }

    const hierarchyRoleIds = config.levels.map((item) => item.roleId);
    const rolesToRemove = member.roles.cache.filter((memberRole) => hierarchyRoleIds.includes(memberRole.id) && memberRole.id !== role.id);

    if (rolesToRemove.size > 0) {
      await member.roles.remove(rolesToRemove, "Atualizacao de nivel da hierarquia").catch(() => undefined);
    }

    await member.roles.add(role, "Aplicacao de nivel da hierarquia");
    await interaction.reply({ content: `${user} recebeu o nivel ${level.name}.`, ephemeral: true });
    return;
  }

  if (subcommand === "autocargo") {
    const action = interaction.options.getString("acao", true);
    const role = interaction.options.getRole("cargo", true);
    const autoRoleIds = new Set(config.autoRoleIds);

    if (action === "adicionar") {
      autoRoleIds.add(role.id);
    } else {
      autoRoleIds.delete(role.id);
    }

    await saveHierarchyConfig({ ...config, autoRoleIds: [...autoRoleIds] });
    await interaction.reply({
      content: action === "adicionar"
        ? `Cargo automatico <@&${role.id}> adicionado.`
        : `Cargo automatico <@&${role.id}> removido.`,
      ephemeral: true
    });
    return;
  }

  if (subcommand === "resetar") {
    await saveHierarchyConfig({ ...config, levels: [], autoRoleIds: [] });
    await interaction.reply({ content: "Hierarquia e cargos automaticos resetados.", ephemeral: true });
  }
}
