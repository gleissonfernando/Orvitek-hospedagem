const { REST, Routes } = require("discord.js");
const { getConfig } = require("./config");
const { commands } = require("./commands");

async function registerCommands(applicationId) {
  const config = getConfig();
  const targetApplicationId = applicationId || config.panelClientId;

  if (!targetApplicationId) {
    throw new Error("Informe PANEL_CLIENT_ID no .env ou inicie o bot para usar o ID do proprio bot logado.");
  }

  const rest = new REST({ version: "10" }).setToken(config.panelBotToken);

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(targetApplicationId, config.guildId), {
      body: commands
    });
    console.log(`Comandos do painel registrados no servidor ${config.guildId}.`);
    return;
  }

  await rest.put(Routes.applicationCommands(targetApplicationId), {
    body: commands
  });
  console.log("Comandos do painel registrados globalmente.");
}

if (require.main === module) {
  registerCommands().catch((error) => {
    console.error("Nao foi possivel registrar os comandos:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { registerCommands };
