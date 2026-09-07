"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const db_1 = require("../config/db");
const auth_1 = require("../middleware/auth");
const whatsapp_service_1 = require("../services/whatsapp.service");
const router = (0, express_1.Router)();
function normalizePhone(val) {
    if (!val)
        return val;
    const clean = val.trim();
    const digits = clean.replace(/\D/g, "");
    if (digits.length === 9)
        return `244${digits}`;
    if (digits.length === 12 && digits.startsWith("244"))
        return digits;
    return clean;
}
/** Calcula o estado textual + contagem de dias/horas restantes a partir de expires_at. */
function computeCountdown(expiresAt) {
    const diffMs = new Date(expiresAt).getTime() - Date.now();
    const totalHours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return { days, hours, isExpired: diffMs <= 0 };
}
// GET /clients/me — dashboard do cliente autenticado
router.get("/me", auth_1.authenticate, async (req, res) => {
    const [sub] = await (0, db_1.query)(`SELECT s.id, s.status, s.expires_at, p.name AS plan_name, p.speed_mbps, p.price_aoa
     FROM subscriptions s
     JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id = $1
     ORDER BY s.expires_at DESC LIMIT 1`, [req.user.id]);
    if (!sub)
        return res.status(404).json({ error: "Nenhuma subscrição encontrada." });
    const countdown = computeCountdown(sub.expires_at);
    return res.json({
        plan: { name: sub.plan_name, speedMbps: sub.speed_mbps, priceAoa: sub.price_aoa },
        status: countdown.isExpired ? "expired" : sub.status,
        expiresAt: sub.expires_at,
        countdown,
    });
});
// GET /clients/metrics/overview — métricas do dashboard geral (admin)
router.get("/metrics/overview", auth_1.authenticate, auth_1.requireAdmin, async (_req, res) => {
    const [activeClients] = await (0, db_1.query)(`SELECT COUNT(DISTINCT u.id) AS count FROM users u
     JOIN subscriptions s ON s.user_id = u.id
     WHERE u.role = 'client' AND u.is_active = true AND s.status IN ('active','expiring_soon')`);
    const [expiringToday] = await (0, db_1.query)(`SELECT COUNT(*) AS count FROM subscriptions WHERE DATE(expires_at) = CURRENT_DATE`);
    const [pendingProofs] = await (0, db_1.query)(`SELECT COUNT(*) AS count FROM payments WHERE status = 'pending'`);
    const [rejectedPayments] = await (0, db_1.query)(`SELECT COUNT(*) AS count FROM payments WHERE status = 'rejected'`);
    const [monthlyRevenue] = await (0, db_1.query)(`SELECT COALESCE(SUM(amount_aoa),0) AS total FROM payments
     WHERE status = 'approved' AND created_at >= date_trunc('month', CURRENT_DATE)`);
    return res.json({
        activeClients: Number(activeClients.count),
        expiringToday: Number(expiringToday.count),
        rejectedPayments: Number(rejectedPayments.count),
        monthlyRevenue: Number(monthlyRevenue.total),
    });
});
// GET /clients — listar clientes (admin) com filtros
router.get("/", auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { name, phone, planId, status } = req.query;
    const conditions = [`u.role = 'client'`];
    const params = [];
    if (name) {
        params.push(`%${name}%`);
        conditions.push(`u.full_name ILIKE $${params.length}`);
    }
    if (phone) {
        params.push(`%${phone}%`);
        conditions.push(`u.phone ILIKE $${params.length}`);
    }
    if (planId) {
        params.push(planId);
        conditions.push(`s.plan_id = $${params.length}`);
    }
    if (status) {
        params.push(status);
        conditions.push(`s.status = $${params.length}`);
    }
    const rows = await (0, db_1.query)(`SELECT u.id, u.full_name, u.phone, u.email, u.address, u.is_active, u.created_at,
            s.id AS subscription_id, s.status, s.expires_at, s.plan_id,
            p.name AS plan_name, p.price_aoa
     FROM users u
     LEFT JOIN LATERAL (
       SELECT * FROM subscriptions s WHERE s.user_id = u.id ORDER BY expires_at DESC LIMIT 1
     ) s ON true
     LEFT JOIN plans p ON p.id = s.plan_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY u.full_name`, params);
    return res.json(rows);
});
// GET /clients/:id — ficha do cliente com histórico
router.get("/:id", auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const [client] = await (0, db_1.query)(`SELECT id, full_name, email, phone, is_active, created_at FROM users WHERE id = $1 AND role = 'client'`, [id]);
    if (!client)
        return res.status(404).json({ error: "Cliente não encontrado." });
    const subscription = await (0, db_1.query)(`SELECT s.*, p.name AS plan_name FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id = $1 ORDER BY s.expires_at DESC LIMIT 1`, [id]);
    const payments = await (0, db_1.query)(`SELECT id, amount_aoa, method, status, rejection_reason, created_at
     FROM payments WHERE user_id = $1 ORDER BY created_at DESC`, [id]);
    return res.json({ ...client, subscription: subscription[0] ?? null, payments });
});
// POST /clients — criar cliente (admin)
router.post("/", auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { fullName, email, phone, password, planId, address } = req.body;
    if (!fullName || !phone || !password || !planId) {
        return res.status(400).json({ error: "Campos obrigatórios em falta." });
    }
    const normalizedPhone = normalizePhone(phone);
    const passwordHash = await bcrypt_1.default.hash(password, 10);
    const [user] = await (0, db_1.query)(`INSERT INTO users (full_name, email, phone, password_hash, role, address)
     VALUES ($1,$2,$3,$4,'client',$5) RETURNING id, full_name, phone`, [fullName, email ?? null, normalizedPhone, passwordHash, address ?? null]);
    const [plan] = await (0, db_1.query)(`SELECT duration_days FROM plans WHERE id = $1`, [planId]);
    if (!plan)
        return res.status(404).json({ error: "Plano não encontrado." });
    const [sub] = await (0, db_1.query)(`INSERT INTO subscriptions (user_id, plan_id, status, started_at, expires_at)
     VALUES ($1, $2, 'active', NOW(), NOW() + ($3 || ' days')::interval) RETURNING id`, [user.id, planId, plan.duration_days]);
    // Envia notificação WhatsApp automática com as credenciais e link de acesso
    const portalUrl = (0, whatsapp_service_1.getClientPortalUrl)();
    const message = whatsapp_service_1.messageTemplates.welcomeClient(fullName, user.phone, password, portalUrl);
    (0, whatsapp_service_1.sendAndLogNotification)({
        userId: user.id,
        subscriptionId: sub ? sub.id : null,
        channel: "client",
        type: "account_created",
        phone: user.phone,
        message,
    }).catch((err) => console.error("[WhatsApp] Erro ao enviar boas-vindas ao cliente:", err));
    return res.status(201).json(user);
});
// PUT /clients/:id — editar cliente (dados, plano e redefinição de palavra-passe)
router.put("/:id", auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { fullName, email, phone, address, password, planId, expiresAt } = req.body;
    const normalizedPhone = phone ? normalizePhone(phone) : null;
    let passwordHash = undefined;
    if (password && typeof password === "string" && password.trim().length > 0) {
        passwordHash = await bcrypt_1.default.hash(password, 10);
    }
    const [updated] = await (0, db_1.query)(`UPDATE users SET
       full_name = COALESCE($1, full_name),
       email = COALESCE($2, email),
       phone = COALESCE($3, phone),
       address = COALESCE($4, address),
       password_hash = CASE WHEN $5::text IS NOT NULL THEN $5::text ELSE password_hash END
     WHERE id = $6 AND role = 'client'
     RETURNING id, full_name, email, phone, address, is_active`, [fullName ?? null, email ?? null, normalizedPhone ?? null, address ?? null, passwordHash ?? null, id]);
    if (!updated)
        return res.status(404).json({ error: "Cliente não encontrado." });
    if (planId) {
        const [plan] = await (0, db_1.query)(`SELECT duration_days FROM plans WHERE id = $1`, [planId]);
        if (plan) {
            const [sub] = await (0, db_1.query)(`SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY expires_at DESC LIMIT 1`, [id]);
            if (sub) {
                await (0, db_1.query)(`UPDATE subscriptions SET plan_id = $1 WHERE id = $2`, [planId, sub.id]);
            }
            else {
                await (0, db_1.query)(`INSERT INTO subscriptions (user_id, plan_id, status, started_at, expires_at)
           VALUES ($1, $2, 'active', NOW(), NOW() + ($3 || ' days')::interval)`, [id, planId, plan.duration_days]);
            }
        }
    }
    if (expiresAt) {
        await (0, db_1.query)(`UPDATE subscriptions SET expires_at = $1,
       status = CASE WHEN $1::timestamptz > NOW() THEN 'active' ELSE 'expired' END::subscription_status
       WHERE user_id = $2 AND id = (SELECT id FROM subscriptions WHERE user_id = $2 ORDER BY expires_at DESC LIMIT 1)`, [expiresAt, id]);
    }
    // Se a palavra-passe foi redefinida, envia notificação WhatsApp ao cliente
    if (password && typeof password === "string" && password.trim().length > 0) {
        const portalUrl = (0, whatsapp_service_1.getClientPortalUrl)();
        const message = whatsapp_service_1.messageTemplates.welcomeClient(updated.full_name, updated.phone, password, portalUrl);
        (0, whatsapp_service_1.sendAndLogNotification)({
            userId: updated.id,
            subscriptionId: null,
            channel: "client",
            type: "account_created",
            phone: updated.phone,
            message,
        }).catch((err) => console.error("[WhatsApp] Erro ao enviar credenciais actualizadas ao cliente:", err));
    }
    return res.json(updated);
});
// PATCH /clients/:id/toggle-active — ativar/desativar (bloquear)
router.patch("/:id/toggle-active", auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const [updated] = await (0, db_1.query)(`UPDATE users SET is_active = NOT is_active WHERE id = $1 AND role = 'client'
     RETURNING id, is_active`, [id]);
    if (!updated)
        return res.status(404).json({ error: "Cliente não encontrado." });
    return res.json(updated);
});
// PATCH /clients/:id/reactivate — reactivar conta e limpar contador de comprovativos inválidos
router.patch("/:id/reactivate", auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const [updated] = await (0, db_1.query)(`UPDATE users SET is_active = true, rejected_proof_attempts = 0
     WHERE id = $1 AND role = 'client'
     RETURNING id, is_active, rejected_proof_attempts`, [req.params.id]);
    if (!updated)
        return res.status(404).json({ error: "Cliente não encontrado." });
    return res.json(updated);
});
// DELETE /clients/:id — apagar cliente
router.delete("/:id", auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const result = await (0, db_1.query)(`DELETE FROM users WHERE id = $1 AND role = 'client' RETURNING id`, [id]);
    if (result.length === 0)
        return res.status(404).json({ error: "Cliente não encontrado." });
    return res.status(204).send();
});
exports.default = router;
