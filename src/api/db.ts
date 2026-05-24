import mongoose from "mongoose";
import { apiConfig } from "./config";

export async function connectMongo(): Promise<void> {
  mongoose.set("strictQuery", true);
  await mongoose.connect(apiConfig.mongoUri, {
    dbName: apiConfig.mongoDbName,
    maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 100),
    minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE || 5),
    serverSelectionTimeoutMS: 10000
  });
}

export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
