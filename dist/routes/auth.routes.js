"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../config/db");
const whatsapp_service_1 = require("../services/whatsapp.service");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET;
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
// POST /auth/login  { identifier: telefone|email, password }
router.post("/login", async (req, res) => {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
        return res.status(400).json({ error: "Telefone/Email e palavra-passe são obrigatórios." });
    }
    const normalizedId = normalizePhone(identifier);
    const [user] = await (0, db_1.query)(`SELECT id, full_name, email, phone, password_hash, role, is_active
     FROM users WHERE phone = $1 OR email = $1 OR phone = $2`, [identifier, normalizedId]);
    if (!user || !user.is_active) {
        return res.status(401).json({ error: "Credenciais inválidas ou conta desactivada." });
    }
    const valid = await bcrypt_1.default.compare(password, user.password_hash);
    if (!valid) {
        return res.status(401).json({ error: "Credenciais inválidas." });
    }
    const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role, phone: user.phone }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({
        token,
        user: { id: user.id, name: user.full_name, email: user.email, phone: user.phone, role: user.role },
    });
});
// POST /auth/register  (criação de cliente — normalmente feita pelo admin, mas exposta aqui)
router.post("/register", async (req, res) => {
    const { fullName, email, phone, password, planId } = req.body;
    if (!fullName || !phone || !password || !planId) {
        return res.status(400).json({ error: "Campos obrigatórios em falta." });
    }
    const normalizedPhone = normalizePhone(phone);
    const existing = await (0, db_1.query)(`SELECT id FROM users WHERE phone = $1 OR phone = $2`, [phone, normalizedPhone]);
    if (existing.length > 0) {
        return res.status(409).json({ error: "Já existe um utilizador com este telefone." });
    }
    const passwordHash = await bcrypt_1.default.hash(password, 10);
    const [user] = await (0, db_1.query)(`INSERT INTO users (full_name, email, phone, password_hash, role)
     VALUES ($1,$2,$3,$4,'client') RETURNING id, full_name, phone`, [fullName, email ?? null, normalizedPhone, passwordHash]);
    const [plan] = await (0, db_1.query)(`SELECT duration_days FROM plans WHERE id = $1`, [planId]);
    if (!plan)
        return res.status(404).json({ error: "Plano não encontrado." });
    const [sub] = await (0, db_1.query)(`INSERT INTO subscriptions (user_id, plan_id, status, started_at, expires_at)
     VALUES ($1, $2, 'active', NOW(), NOW() + ($3 || ' days')::interval) RETURNING id`, [user.id, planId, plan.duration_days]);
    // Envia notificação WhatsApp automática com as credenciais e link de acesso
    const portalUrl = (0, whatsapp_service_1.getClientPortalUrl)();
    const message = whatsapp_service_1.messageTemplates.welcomeClient(fullName, phone, password, portalUrl);
    await (0, whatsapp_service_1.sendAndLogNotification)({
        userId: user.id,
        subscriptionId: sub ? sub.id : null,
        channel: "client",
        type: "account_created",
        phone: user.phone,
        message,
    }).catch((err) => console.error("[WhatsApp] Erro ao enviar boas-vindas ao cliente:", err));
    return res.status(201).json({ user });
});
exports.default = router;
