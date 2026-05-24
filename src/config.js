require("dotenv").config();

const required = ["PANEL_BOT_TOKEN"];
const placeholderRegex = /^COLOQUE_AQUI_/;
const snowflakeRegex = /^\d{17,20}$/;

function normalizeOptionalId(value) {
  if (!value || placeholderRegex.test(value)) {
    return null;
  }

  return value;
}

function isValidSnowflake(value) {
  return snowflakeRegex.test(value);
}

function parseAdminIds(value) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getConfig() {
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Variaveis obrigatorias ausentes: ${missing.join(", ")}`);
  }

  const panelClientId = normalizeOptionalId(process.env.PANEL_CLIENT_ID) || normalizeOptionalId(process.env.CLIENT_ID);
  const guildId = normalizeOptionalId(process.env.GUILD_ID);

  if (panelClientId && !isValidSnowflake(panelClientId)) {
    throw new Error("PANEL_CLIENT_ID precisa ser um ID numerico valido do Discord.");
  }

  if (guildId && !isValidSnowflake(guildId)) {
    throw new Error("GUILD_ID precisa ser um ID numerico valido do Discord.");
  }

  return {
    panelBotToken: process.env.PANEL_BOT_TOKEN,
    panelClientId,
    guildId,
    panelAdminIds: parseAdminIds(process.env.PANEL_ADMIN_IDS),
    enableMemberEvents: process.env.ENABLE_MEMBER_EVENTS === "true",
    apiPublicUrl: process.env.API_PUBLIC_URL || `http://localhost:${process.env.API_PORT || 3000}`,
    orvitekApiKey: process.env.ORVITEK_API_KEY || "",
    testOwnerId: process.env.TEST_OWNER_ID || null,
    testBotClientId: process.env.TEST_BOT_CLIENT_ID || null,
    testBotToken: process.env.TEST_BOT_TOKEN || null
  };
}

module.exports = { getConfig, isValidSnowflake };
