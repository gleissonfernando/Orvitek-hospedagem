import type { Collection, WithId } from "mongodb";
import mongoose from "mongoose";
import { apiConfig } from "../config";
import { findUserBotByClientId, findUserBotByHostingAccessKey, updateUserBot, type LocalUserBot } from "../storage/userBotStore";
import { botManager } from "./BotManager";

type HostingActionKind = "shutdown" | "restore";

type HostingEventPayload = {
  event?: string;
  eventId?: string;
  sentAt?: string;
  guild?: {
    id?: string;
    name?: string;
  };
  client?: {
    userId?: string;
    clientId?: string;
    userTag?: string;
    plan?: string;
    status?: string;
  };
  hosting?: {
    projectName?: string;
    accessKey?: string;
    status?: string;
    paymentStatus?: string;
    dueAt?: string;
    graceUntil?: string;
    cycle?: string;
    projectChannelId?: string;
    paymentTicketChannelId?: string;
  };
  action?: {
    type?: string;
    reason?: string;
    requestedBy?: string | null;
  };
  clientId?: string;
};

type HostingShutdownEventDocument = {
  eventId: string;
  event: string;
  status: "pending" | "processing" | "processed" | "failed";
  payload?: HostingEventPayload;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  processingStartedAt?: string;
  processedAt?: string;
  failedAt?: string;
  processingError?: string | null;
};

type HostingActionResult = {
  eventId: string;
  accessKey: string;
  userId: string;
  clientId: string;
  client: string;
  projectName: string;
  actionType: string;
  dueAt: string;
  message: string;
  result: "desligado" | "religado" | "nao_encontrado";
  botStatus?: string;
};

type PayloadDescription = Omit<HostingActionResult, "message" | "result" | "botStatus">;

const shutdownActions = new Set(["shutdown_client_hosting", "overdue", "expired", "vencido", "atrasado", "suspended", "suspendido", "inactive", "inativo"]);
const restoreActions = new Set(["restore_client_hosting", "payment_confirmed", "paid", "pago", "active", "ativo", "restored", "restaurado"]);

export class HostingPayloadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostingPayloadValidationError";
  }
}

export function isHostingPayloadValidationError(error: unknown): error is HostingPayloadValidationError {
  return error instanceof HostingPayloadValidationError;
}

function getEventsCollection(): Collection<HostingShutdownEventDocument> {
  if (!mongoose.connection.db) {
    throw new Error("MongoDB nao esta conectado.");
  }

  return mongoose.connection.db.collection<HostingShutdownEventDocument>(apiConfig.hostingEventsCollection);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidDateString(value: string): boolean {
  return Boolean(value && !Number.isNaN(new Date(value).getTime()));
}

function parseDate(value?: string): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function describePayload(payload: HostingEventPayload): PayloadDescription {
  return {
    eventId: cleanString(payload.eventId),
    accessKey: cleanString(payload.hosting?.accessKey),
    userId: cleanString(payload.client?.userId),
    clientId: cleanString(payload.client?.clientId || payload.clientId),
    client: cleanString(payload.client?.userTag || payload.client?.userId || payload.client?.clientId || payload.clientId) || "cliente_desconhecido",
    projectName: cleanString(payload.hosting?.projectName) || "projeto_desconhecido",
    actionType: cleanString(payload.action?.type),
    dueAt: cleanString(payload.hosting?.dueAt) || "vencimento_desconhecido"
  };
}

function logActionResult(info: PayloadDescription, result: HostingActionResult["result"] | "erro", error?: string): void {
  console.log(`[orvitek/hosting] eventId=${info.eventId || "sem_eventId"} userId=${info.userId || "sem_userId"} clientId=${info.clientId || "sem_clientId"} projectName=${info.projectName} accessKey=${info.accessKey || "sem_accessKey"} action=${info.actionType || "sem_action"} resultado=${result}${error ? ` erro=${error}` : ""}`);
}

function resolveActionKind(payload: HostingEventPayload): HostingActionKind | null {
  const actionType = cleanString(payload.action?.type).toLowerCase();
  const event = cleanString(payload.event).toLowerCase();
  const hostingStatus = cleanString(payload.hosting?.status).toLowerCase();
  const paymentStatus = cleanString(payload.hosting?.paymentStatus).toLowerCase();
  const clientStatus = cleanString(payload.client?.status).toLowerCase();

  if (actionType === "shutdown_client_hosting" || event === "hosting.payment_overdue.shutdown") {
    return "shutdown";
  }

  if (actionType === "restore_client_hosting" || event === "hosting.payment_confirmed.restore") {
    return "restore";
  }

  if ([actionType, hostingStatus, paymentStatus, clientStatus].some((value) => shutdownActions.has(value))) {
    return "shutdown";
  }

  if ([actionType, hostingStatus, paymentStatus].some((value) => restoreActions.has(value))) {
    return "restore";
  }

  return null;
}

function validatePayload(input: unknown, expectedKind?: HostingActionKind): { payload: HostingEventPayload; info: PayloadDescription; kind: HostingActionKind } {
  const payload = asObject(input) as HostingEventPayload | null;

  if (!payload) {
    throw new HostingPayloadValidationError("Payload precisa ser um objeto JSON.");
  }

  if (payload.sentAt && !isValidDateString(payload.sentAt)) {
    throw new HostingPayloadValidationError("sentAt precisa ser uma data ISO valida.");
  }

  if (payload.hosting?.dueAt && !isValidDateString(payload.hosting.dueAt)) {
    throw new HostingPayloadValidationError("hosting.dueAt precisa ser uma data ISO valida.");
  }

  if (payload.hosting?.graceUntil && !isValidDateString(payload.hosting.graceUntil)) {
    throw new HostingPayloadValidationError("hosting.graceUntil precisa ser uma data ISO valida.");
  }

  const info = describePayload(payload);
  if (!info.accessKey && !info.clientId) {
    throw new HostingPayloadValidationError("Informe payload.hosting.accessKey ou clientId.");
  }

  const kind = resolveActionKind(payload);
  if (!kind || (expectedKind && kind !== expectedKind)) {
    const expected = expectedKind === "restore" ? "religamento" : expectedKind === "shutdown" ? "desligamento" : "acao valida";
    throw new HostingPayloadValidationError(`Payload nao indica ${expected}.`);
  }

  return { payload, info, kind };
}

async function findBotForPayload(info: PayloadDescription): Promise<LocalUserBot | null> {
  return info.accessKey
    ? findUserBotByHostingAccessKey(info.accessKey)
    : findUserBotByClientId(info.clientId);
}

function resolveRestoreExpiration(payload: HostingEventPayload, bot: LocalUserBot): string {
  const now = Date.now();
  const dueAt = parseDate(payload.hosting?.dueAt);
  const graceUntil = parseDate(payload.hosting?.graceUntil);
  const currentExpiration = parseDate(bot.planExpiresAt);

  if (dueAt && dueAt.getTime() > now) {
    return dueAt.toISOString();
  }

  if (graceUntil && graceUntil.getTime() > now) {
    return graceUntil.toISOString();
  }

  if (currentExpiration && currentExpiration.getTime() > now) {
    return currentExpiration.toISOString();
  }

  const nextExpiration = new Date(now);
  nextExpiration.setUTCDate(nextExpiration.getUTCDate() + 30);
  return nextExpiration.toISOString();
}

export async function shutdownHostingFromPayload(input: unknown): Promise<HostingActionResult> {
  const { payload, info } = validatePayload(input, "shutdown");
  const bot = await findBotForPayload(info);

  if (!bot) {
    logActionResult(info, "nao_encontrado");
    return { ...info, message: "Bot nao encontrado para essa accessKey", result: "nao_encontrado" };
  }

  if (bot.status !== "offline") {
    await botManager.stopBot(bot.userId, bot.clientId);
  }

  await updateUserBot(bot.userId, bot.clientId, {
    status: "offline",
    planStatus: "overdue",
    planExpiresAt: new Date().toISOString(),
    hostingAccessGranted: false,
    projectName: payload.hosting?.projectName || bot.projectName,
    hostingAccessKey: info.accessKey || bot.hostingAccessKey
  });

  logActionResult(info, "desligado");
  return { ...info, clientId: bot.clientId, message: "Bot desligado com sucesso", result: "desligado", botStatus: "offline" };
}

export async function restoreHostingFromPayload(input: unknown): Promise<HostingActionResult> {
  const { payload, info } = validatePayload(input, "restore");
  const bot = await findBotForPayload(info);

  if (!bot) {
    logActionResult(info, "nao_encontrado");
    return { ...info, message: "Bot nao encontrado para essa accessKey", result: "nao_encontrado" };
  }

  const planExpiresAt = resolveRestoreExpiration(payload, bot);
  const paidAt = parseDate(payload.sentAt)?.toISOString() || new Date().toISOString();

  await updateUserBot(bot.userId, bot.clientId, {
    planStatus: "active",
    planExpiresAt,
    lastPaymentAt: paidAt,
    hostingAccessGranted: true,
    projectName: payload.hosting?.projectName || bot.projectName,
    hostingAccessKey: info.accessKey || bot.hostingAccessKey
  });

  const botStatus = bot.encryptedToken
    ? await botManager.restartBot(bot.userId, bot.clientId)
    : "offline";

  if (!bot.encryptedToken) {
    await updateUserBot(bot.userId, bot.clientId, { status: "offline" });
  }

  logActionResult(info, "religado");
  return { ...info, clientId: bot.clientId, message: "Bot religado com sucesso", result: "religado", botStatus };
}

export async function processHostingEventPayload(input: unknown): Promise<HostingActionResult> {
  const { kind } = validatePayload(input);
  return kind === "restore"
    ? restoreHostingFromPayload(input)
    : shutdownHostingFromPayload(input);
}

export async function processPendingHostingShutdownEvents(limit = 25): Promise<number> {
  const collection = getEventsCollection();
  let processedCount = 0;

  for (let index = 0; index < limit; index += 1) {
    const now = new Date().toISOString();
    const event = await collection.findOneAndUpdate(
      {
        status: "pending",
        $or: [
          { "payload.event": "hosting.payment_overdue.shutdown" },
          { "payload.event": "hosting.payment_confirmed.restore" },
          { "payload.action.type": "shutdown_client_hosting" },
          { "payload.action.type": "restore_client_hosting" },
          { "payload.action.type": "overdue" },
          { "payload.action.type": "expired" },
          { "payload.action.type": "vencido" },
          { "payload.action.type": "payment_confirmed" },
          { "payload.hosting.status": "overdue" },
          { "payload.hosting.status": "expired" },
          { "payload.hosting.status": "vencido" },
          { "payload.hosting.status": "active" },
          { "payload.hosting.status": "ativo" },
          { "payload.hosting.paymentStatus": "overdue" },
          { "payload.hosting.paymentStatus": "expired" },
          { "payload.hosting.paymentStatus": "vencido" },
          { "payload.hosting.paymentStatus": "paid" },
          { "payload.hosting.paymentStatus": "pago" },
          { "payload.client.status": "overdue" },
          { "payload.client.status": "expired" },
          { "payload.client.status": "vencido" }
        ]
      },
      {
        $set: {
          status: "processing",
          processingStartedAt: now,
          updatedAt: now
        }
      },
      {
        sort: { createdAt: 1 },
        returnDocument: "after"
      }
    );

    if (!event) {
      break;
    }

    processedCount += 1;
    await processClaimedEvent(collection, event);
  }

  return processedCount;
}

async function processClaimedEvent(
  collection: Collection<HostingShutdownEventDocument>,
  event: WithId<HostingShutdownEventDocument>
): Promise<void> {
  const payload = event.payload || {};
  const info = describePayload(payload);

  try {
    const result = await processHostingEventPayload(payload);
    if (result.result === "nao_encontrado") {
      throw new Error(result.message);
    }

    const now = new Date().toISOString();

    await collection.updateOne(
      { _id: event._id },
      {
        $set: {
          status: "processed",
          processedAt: now,
          updatedAt: now,
          processingError: null
        }
      }
    );

    console.log(`[hosting-event] processed eventId=${event.eventId} cliente=${result.client} projeto=${result.projectName} accessKey=${result.accessKey} acao=${result.actionType || result.result} resultado=${result.message}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    const now = new Date().toISOString();

    await collection.updateOne(
      { _id: event._id },
      {
        $set: {
          status: "failed",
          failedAt: now,
          updatedAt: now,
          processingError: message
        }
      }
    );

    logActionResult(info, "erro", message);
    console.error(`[hosting-event] failed eventId=${event.eventId} cliente=${info.client} projeto=${info.projectName} accessKey=${info.accessKey} vencimento=${info.dueAt} erro=${message}`);
  }
}
