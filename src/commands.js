const { SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("hospedagem")
    .setDescription("Mostra o tutorial para cadastrar seu bot na hospedagem.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("gerenciador")
    .setDescription("Abre o painel de ferramentas de gerenciamento.")
    .toJSON()
];

module.exports = { commands };
