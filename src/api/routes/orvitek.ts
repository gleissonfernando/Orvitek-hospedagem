import { Router } from "express";
import { apiConfig } from "../config";
import { createFiveMFacToken } from "../services/FiveMFacTokenStore";
import { shutdownHostingFromPayload } from "../services/HostingShutdownProcessor";

const router = Router();

function isAuthorized(authorization?: string): boolean {
  if (!apiConfig.orvitekHostingBotToken) {
    return false;
  }

  return authorization === `Bearer ${apiConfig.orvitekHostingBotToken}`;
}

function debug(message: string): void {
  if (apiConfig.orvitekHostingBotDebug) {
    console.log(`[orvitek/desligar] ${message}`);
  }
}

router.post("/desligar", async (req, res) => {
  debug("POST recebido do Orvitek Vendas");

  if (!isAuthorized(req.header("authorization"))) {
    debug("token invalido");
    res.status(401).json({
      ok: false,
      message: "Nao autorizado"
    });
    return;
  }

  debug("token validado");
  debug(`payload recebido=${JSON.stringify(req.body || {})}`);
  debug(`accessKey consultada=${req.body?.hosting?.accessKey || ""}`);

  try {
    const result = await shutdownHostingFromPayload(req.body || {});

    if (result.result === "nao_encontrado") {
      const body = {
        ok: false,
        message: "Bot não encontrado para essa accessKey",
        eventId: result.eventId,
        accessKey: result.accessKey
      };
      debug(`resposta enviada=${JSON.stringify(body)}`);
      res.status(404).json(body);
      return;
    }

    const body = {
      ok: true,
      message: "Bot desligado com sucesso",
      eventId: result.eventId,
      accessKey: result.accessKey
    };
    debug("bot desligado");
    debug(`resposta enviada=${JSON.stringify(body)}`);
    res.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    console.log(`[orvitek/desligar] eventId=${req.body?.eventId || "sem_eventId"} userId=${req.body?.client?.userId || "sem_userId"} projectName=${req.body?.hosting?.projectName || "sem_projectName"} accessKey=${req.body?.hosting?.accessKey || "sem_accessKey"} action=${req.body?.action?.type || "sem_action"} resultado=erro error=${message}`);
    const body = {
      ok: false,
      message: "Erro ao desligar bot",
      error: message
    };
    debug(`resposta enviada=${JSON.stringify(body)}`);
    res.status(500).json(body);
  }
});

router.post("/fivem-fac-token", async (req, res) => {
  if (!isAuthorized(req.header("authorization"))) {
    res.status(401).json({
      ok: false,
      message: "Nao autorizado"
    });
    return;
  }

  const guildId = String(req.body?.guildId || "").trim();
  const token = String(req.body?.token || "").trim();
  const createdBy = String(req.body?.createdBy || "orvitek-main-bot").trim();

  if (!/^\d{17,20}$/.test(guildId)) {
    res.status(400).json({
      ok: false,
      message: "guildId invalido"
    });
    return;
  }

  if (!/^\d{4}$/.test(token)) {
    res.status(400).json({
      ok: false,
      message: "token precisa ter exatamente 4 digitos"
    });
    return;
  }

  try {
    const record = createFiveMFacToken({ guildId, token, createdBy });
    res.json({
      ok: true,
      token,
      status: record.status,
      guildId
    });
  } catch (error) {
    res.status(409).json({
      ok: false,
      message: error instanceof Error ? error.message : "Nao foi possivel registrar o token"
    });
  }
});

export { router as orvitekRouter };
