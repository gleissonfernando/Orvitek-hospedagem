"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkHostingRegistrationPermission = checkHostingRegistrationPermission;
const mongoose_1 = __importDefault(require("mongoose"));
const config_1 = require("../config");
function debug(message) {
    if (config_1.apiConfig.orvitekHostingBotDebug) {
        console.log(`[hosting-permission] ${message}`);
    }
}
function log(message) {
    console.log(`[hosting-permission] ${message}`);
}
function getPermissionsCollection() {
    if (!mongoose_1.default.connection.db) {
        throw new Error("MongoDB nao esta conectado para consultar permissoes de hospedagem.");
    }
    return mongoose_1.default.connection.db.collection(config_1.apiConfig.hostingRegistrationPermissionsCollection);
}
async function checkHostingRegistrationPermission(accessKey) {
    debug(`consultando accessKey=${accessKey}`);
    const permission = await getPermissionsCollection().findOne({ accessKey });
    const allowed = Boolean(permission?.allowed === true && permission.status === "paid");
    debug(`permissao encontrada=${Boolean(permission)} allowed=${permission?.allowed ?? "n/a"} status=${permission?.status ?? "n/a"} resultado=${allowed}`);
    if (!permission) {
        log(`accessKey nao encontrada: ${accessKey}`);
    }
    else if (!allowed) {
        log(`accessKey existe mas nao libera: ${accessKey} allowed=${permission.allowed} status=${permission.status}`);
    }
    return {
        allowed,
        found: Boolean(permission),
        accessKey,
        status: permission?.status
    };
}
