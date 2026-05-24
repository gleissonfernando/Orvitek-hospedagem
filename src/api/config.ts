import dotenv from "dotenv";

dotenv.config();

const snowflakeRegex = /^\d{17,20}$/;

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

export const apiConfig = {
  port: Number(process.env.API_PORT || 3000),
  mongoUri: process.env.MONGODB_URI || "",
  mongoDbName: process.env.MONGODB_DB_NAME || "orvitek",
  hostingEventsCollection: process.env.MONGODB_HOSTING_EVENTS_COLLECTION || "hosting_shutdown_events",
  hostingRegistrationPermissionsCollection: process.env.MONGODB_HOSTING_REGISTRATION_PERMISSIONS_COLLECTION || "hosting_registration_permissions",
  encryptionKey: requireEnv("BOT_TOKEN_ENCRYPTION_KEY"),
  hostingBotApiUrl: process.env.HOSTING_BOT_API_URL || `http://localhost:${process.env.API_PORT || 3000}`,
  orvitekApiKey: process.env.ORVITEK_API_KEY || "",
  orvitekHostingBotUrl: process.env.ORVITEK_HOSTING_BOT_URL || `${process.env.HOSTING_BOT_API_URL || `http://localhost:${process.env.API_PORT || 3000}`}/api/orvitek/desligar`,
  orvitekHostingBotToken: process.env.ORVITEK_HOSTING_BOT_TOKEN || "",
  orvitekHostingBotDebug: process.env.ORVITEK_HOSTING_BOT_DEBUG === "true",
  orvitekMainBotNotifyUrl: process.env.ORVITEK_MAIN_BOT_NOTIFY_URL || "",
  orvitekMainBotNotifyToken: process.env.ORVITEK_MAIN_BOT_NOTIFY_TOKEN || "",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  hostedBotsEnableMemberEvents: process.env.HOSTED_BOTS_ENABLE_MEMBER_EVENTS === "true" || process.env.ENABLE_MEMBER_EVENTS === "true",
  enableDevMockBots: process.env.ENABLE_DEV_MOCK_BOTS === "true",
  nodeEnv: process.env.NODE_ENV || "development"
};

export function assertSnowflake(value: string, label: string): void {
  if (!snowflakeRegex.test(value)) {
    throw new Error(`${label} invalido`);
  }
}
