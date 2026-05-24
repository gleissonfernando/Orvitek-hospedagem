const { SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Abre o painel da Orvitek Hospedagem.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Open the Orvitek Hosting bot panel.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("hospedagem")
    .setDescription("Mostra o tutorial para cadastrar seu bot na hospedagem.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("painel-gerenciador")
    .setDescription("Abre o painel gerenciador dos bots hospedados.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("gerenciar")
    .setDescription("Mostra os bots cadastrados, donos e status.")
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Filtra os bots de um usuario.")
        .setRequired(false)
    )
    .toJSON()
];

module.exports = { commands };
