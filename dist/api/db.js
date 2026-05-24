"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectMongo = connectMongo;
exports.isMongoConnected = isMongoConnected;
const mongoose_1 = __importDefault(require("mongoose"));
const config_1 = require("./config");
async function connectMongo() {
    mongoose_1.default.set("strictQuery", true);
    await mongoose_1.default.connect(config_1.apiConfig.mongoUri, {
        dbName: config_1.apiConfig.mongoDbName,
        maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 100),
        minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE || 5),
        serverSelectionTimeoutMS: 10000
    });
}
function isMongoConnected() {
    return mongoose_1.default.connection.readyState === 1;
}
