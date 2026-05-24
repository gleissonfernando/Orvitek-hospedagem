import { Router } from "express";
import { z } from "zod";
import { apiConfig, assertSnowflake } from "../config";
import { requireUser } from "../middleware/auth";
import { encryptToken } from "../security/tokenCrypto";
import { upsertUserBot } from "../storage/userBotStore";

const router = Router();

const mockSchema = z.object({
  guildId: z.string().trim(),
  targetUserId: z.string().trim(),
  clientId: z.string().trim()
});

router.use(requireUser);

router.post("/mock-user-bot", async (req, res) => {
  if (apiConfig.nodeEnv === "production" || !apiConfig.enableDevMockBots) {
    res.status(404).json({ success: false, message: "Rota nao encontrada" });
    return;
  }

  const parsed = mockSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Dados invalidos" });
    return;
  }

  const { guildId, targetUserId, clientId } = parsed.data;

  try {
    assertSnowflake(guildId, "guildId");
    assertSnowflake(targetUserId, "targetUserId");
    assertSnowflake(clientId, "clientId");
  } catch {
    res.status(400).json({ success: false, message: "Dados invalidos" });
    return;
  }

  await upsertUserBot({
    userId: req.userId,
    guildId,
    targetUserId,
    clientId,
    encryptedToken: encryptToken("TOKEN_FALSO_DE_DESENVOLVIMENTO"),
    botUsername: "bot-mock",
    botId: clientId,
    status: "offline"
  });

  res.json({
    success: true,
    message: "Bot mock cadastrado com sucesso",
    bot: {
      clientId,
      guildId,
      targetUserId,
      status: "offline"
    }
  });
});

export { router as devMockBotsRouter };
