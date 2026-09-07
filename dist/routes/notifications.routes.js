"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../config/db");
const auth_1 = require("../middleware/auth");
const notification_cron_1 = require("../jobs/notification.cron");
const whatsapp_service_1 = require("../services/whatsapp.service");
const router = (0, express_1.Router)();
router.get("/cron", async (req, res) => {
    const configuredSecret = process.env.CRON_SECRET?.trim();
    const authorization = String(req.headers.authorization ?? "");
    const bearerSecret = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    const suppliedSecret = String(req.headers["x-cron-secret"] ?? req.query.secret ?? bearerSecret).trim();
    if (!configuredSecret || suppliedSecret !== configuredSecret) {
        return res.status(401).json({ error: "Cron não autorizado." });
    }
    try {
        await (0, notification_cron_1.runDailyNotificationJob)();
        return res.json({ message: "Job de notificações executado com sucesso." });
    }
    catch (err) {
        console.error("[CRON] Erro na execução serverless:", err);
        return res.status(500).json({ error: err?.message ?? "Erro ao executar o job." });
    }
});
router.get("/health", auth_1.authenticate, auth_1.requireAdmin, async (_req, res) => {
    return res.json((0, whatsapp_service_1.getWhatsAppConfigStatus)());
});
// GET /notifications/logs — histórico de envios (admin)
router.get("/logs", auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { type, channel } = req.query;
    const conditions = [];
    const params = [];
    if (type) {
        params.push(type);
        conditions.push(`type = $${params.length}`);
    }
    if (channel) {
        params.push(channel);
        conditions.push(`channel = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const logs = await (0, db_1.query)(`SELECT * FROM notification_logs ${where} ORDER BY sent_at DESC LIMIT 200`, params);
    return res.json(logs);
});
// GET /notifications/settings — números que recebem instruções de rede
router.get("/settings", auth_1.authenticate, auth_1.requireAdmin, async (_req, res) => {
    const rows = await (0, db_1.query)(`SELECT key, value FROM company_settings
     WHERE key IN ('internet_activation_numbers', 'internet_deactivation_numbers')`);
    const settings = {
        internet_activation_numbers: "",
        internet_deactivation_numbers: "",
    };
    rows.forEach((row) => {
        settings[row.key] = row.value;
    });
    return res.json(settings);
});
// PUT /notifications/settings — configurar números que recebem instruções de rede
router.put("/settings", auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const entries = [
        ["internet_activation_numbers", req.body.internet_activation_numbers],
        ["internet_deactivation_numbers", req.body.internet_deactivation_numbers],
    ];
    for (const [key, value] of entries) {
        await (0, db_1.query)(`INSERT INTO company_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, String(value ?? "").trim()]);
    }
    return res.json({ message: "Configurações de notificações guardadas." });
});
// POST /notifications/run-now — dispara manualmente o job diário (admin, útil para testes)
router.post("/run-now", auth_1.authenticate, auth_1.requireAdmin, async (_req, res) => {
    try {
        await (0, notification_cron_1.runDailyNotificationJob)();
        return res.json({ message: "Job de notificações executado com sucesso." });
    }
    catch (err) {
        return res.status(500).json({ error: err?.message ?? "Erro ao executar o job." });
    }
});
exports.default = router;
