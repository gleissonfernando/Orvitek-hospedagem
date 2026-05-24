import type { NextFunction, Request, Response } from "express";

declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const userId = req.header("x-user-id");

  if (!userId) {
    res.status(401).json({ success: false, message: "Nao autenticado" });
    return;
  }

  req.userId = userId;
  next();
}
