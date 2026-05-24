import { Schema, model, type InferSchemaType } from "mongoose";

const userBotSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    guildId: { type: String, required: true },
    targetUserId: { type: String, required: true },
    clientId: { type: String, required: true },
    hostingAccessKey: { type: String },
    hostingAccessGranted: { type: Boolean, default: false },
    projectName: { type: String },
    encryptedToken: { type: String, select: false },
    botUsername: { type: String, required: true },
    botId: { type: String, required: true },
    status: { type: String, enum: ["online", "offline", "error"], default: "offline" },
    planStatus: { type: String, enum: ["active", "overdue"], default: "active" },
    planStartedAt: { type: Date },
    planExpiresAt: { type: Date },
    lastPaymentAmountCents: { type: Number },
    lastPaymentAt: { type: Date }
  },
  { timestamps: true }
);

userBotSchema.index({ userId: 1, clientId: 1 }, { unique: true });
userBotSchema.index({ clientId: 1 });
userBotSchema.index({ hostingAccessKey: 1 });
userBotSchema.index({ status: 1, planExpiresAt: 1 });
userBotSchema.index({ planExpiresAt: 1 });

export type UserBotDocument = InferSchemaType<typeof userBotSchema>;
export const UserBot = model("UserBot", userBotSchema);
