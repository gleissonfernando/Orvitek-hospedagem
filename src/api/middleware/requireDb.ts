import type { NextFunction, Request, Response } from "express";
import { isMongoConnected } from "../db";

export function requireDb(_req: Request, res: Response, next: NextFunction): void {
  if (!isMongoConnected()) {
    res.status(503).json({
      success: false,
      message: "Banco de dados indisponivel. Inicie o MongoDB em MONGODB_URI antes de cadastrar ou remover bots."
    });
    return;
  }

  next();
}
