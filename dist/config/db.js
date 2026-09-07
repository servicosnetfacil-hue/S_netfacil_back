"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.query = query;
const pg_1 = require("pg");
const isAivenConnection = (process.env.DATABASE_URL ?? "").includes("aivencloud.com");
exports.pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isAivenConnection ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
});
exports.pool.on("error", (err) => {
    console.error("[DB] Erro inesperado no pool de ligações:", err);
});
async function query(text, params) {
    const result = await exports.pool.query(text, params);
    return result.rows;
}
