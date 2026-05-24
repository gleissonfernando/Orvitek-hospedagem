"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireDb = requireDb;
const db_1 = require("../db");
function requireDb(_req, res, next) {
    if (!(0, db_1.isMongoConnected)()) {
        res.status(503).json({
            success: false,
            message: "Banco de dados indisponivel. Inicie o MongoDB em MONGODB_URI antes de cadastrar ou remover bots."
        });
        return;
    }
    next();
}
