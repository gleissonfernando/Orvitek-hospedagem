import type { Collection } from "mongodb";
import mongoose from "mongoose";
import { apiConfig } from "../config";

type HostingRegistrationPermissionDocument = {
  accessKey: string;
  allowed: boolean;
  status: string;
};

export type HostingRegistrationPermissionResult = {
  allowed: boolean;
  found: boolean;
  accessKey: string;
  status?: string;
};

function debug(message: string): void {
  if (apiConfig.orvitekHostingBotDebug) {
    console.log(`[hosting-permission] ${message}`);
  }
}

function log(message: string): void {
  console.log(`[hosting-permission] ${message}`);
}

function getPermissionsCollection(): Collection<HostingRegistrationPermissionDocument> {
  if (!mongoose.connection.db) {
    throw new Error("MongoDB nao esta conectado para consultar permissoes de hospedagem.");
  }

  return mongoose.connection.db.collection<HostingRegistrationPermissionDocument>(apiConfig.hostingRegistrationPermissionsCollection);
}

export async function checkHostingRegistrationPermission(accessKey: string): Promise<HostingRegistrationPermissionResult> {
  debug(`consultando accessKey=${accessKey}`);

  const permission = await getPermissionsCollection().findOne({ accessKey });
  const allowed = Boolean(permission?.allowed === true && permission.status === "paid");

  debug(`permissao encontrada=${Boolean(permission)} allowed=${permission?.allowed ?? "n/a"} status=${permission?.status ?? "n/a"} resultado=${allowed}`);

  if (!permission) {
    log(`accessKey nao encontrada: ${accessKey}`);
  } else if (!allowed) {
    log(`accessKey existe mas nao libera: ${accessKey} allowed=${permission.allowed} status=${permission.status}`);
  }

  return {
    allowed,
    found: Boolean(permission),
    accessKey,
    status: permission?.status
  };
}
