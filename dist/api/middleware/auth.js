"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireUser = requireUser;
function requireUser(req, res, next) {
    const userId = req.header("x-user-id");
    if (!userId) {
        res.status(401).json({ success: false, message: "Nao autenticado" });
        return;
    }
    req.userId = userId;
    next();
}
