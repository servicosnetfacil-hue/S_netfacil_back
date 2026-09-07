"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../config/db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
/** Converte o filtro de período num intervalo SQL. */
function periodCondition(period) {
    switch (period) {
        case "today": return `created_at::date = CURRENT_DATE`;
        case "week": return `created_at >= date_trunc('week', CURRENT_DATE)`;
        case "month": return `created_at >= date_trunc('month', CURRENT_DATE)`;
        case "year": return `created_at >= date_trunc('year', CURRENT_DATE)`;
        default: return `created_at >= date_trunc('month', CURRENT_DATE)`;
    }
}
// GET /finance/summary?period=today|week|month|year
router.get("/summary", auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const period = req.query.period ?? "month";
    const cond = periodCondition(period);
    const [totals] = await (0, db_1.query)(`SELECT COALESCE(SUM(amount_aoa),0) AS total_revenue, COUNT(*) AS total_payments
     FROM payments WHERE status = 'approved' AND ${cond}`);
    const byPlan = await (0, db_1.query)(`SELECT pl.name AS plan_name, COALESCE(SUM(p.amount_aoa),0) AS revenue, COUNT(*) AS quantity
     FROM payments p JOIN plans pl ON pl.id = p.plan_id
     WHERE p.status = 'approved' AND ${cond.replace(/created_at/g, "p.created_at")}
     GROUP BY pl.name ORDER BY revenue DESC`);
    const byMethod = await (0, db_1.query)(`SELECT method, COALESCE(SUM(amount_aoa),0) AS revenue, COUNT(*) AS quantity
     FROM payments WHERE status = 'approved' AND ${cond}
     GROUP BY method`);
    return res.json({
        period,
        totalRevenue: Number(totals.total_revenue),
        totalPayments: Number(totals.total_payments),
        byPlan,
        byMethod,
    });
});
// GET /finance/export?period=month&format=csv
router.get("/export", auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const period = req.query.period ?? "month";
    const cond = periodCondition(period);
    const rows = await (0, db_1.query)(`SELECT p.id, u.full_name AS cliente, pl.name AS plano, p.method AS metodo,
            p.amount_aoa AS valor_aoa, p.status, p.created_at
     FROM payments p
     JOIN users u ON u.id = p.user_id
     JOIN plans pl ON pl.id = p.plan_id
     WHERE p.status = 'approved' AND ${cond.replace(/created_at/g, "p.created_at")}
     ORDER BY p.created_at DESC`);
    const header = "ID,Cliente,Plano,Metodo,Valor (AOA),Estado,Data\n";
    const csv = rows
        .map((r) => [r.id, r.cliente, r.plano, r.metodo, r.valor_aoa, r.status, new Date(r.created_at).toLocaleString("pt-AO")]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","))
        .join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="netfacil-financas-${period}.csv"`);
    return res.send(header + csv);
});
// GET /finance/settings — obter coordenadas de pagamento da empresa
router.get("/settings", async (_req, res) => {
    const rows = await (0, db_1.query)(`SELECT key, value FROM company_settings`);
    const settings = {
        payment_entity: "10116",
        payment_reference: "929754355",
        company_iban: "AO06 0000 0000 0000 0000 0000 0",
        company_express: "244900000000",
    };
    rows.forEach((r) => {
        settings[r.key] = r.value;
    });
    return res.json(settings);
});
// PUT /finance/settings — configurar coordenadas de pagamento (admin)
router.put("/settings", auth_1.authenticate, auth_1.requireAdmin, async (req, res) => {
    const { payment_entity, payment_reference, company_iban, company_express } = req.body;
    const entries = [
        ["payment_entity", payment_entity],
        ["payment_reference", payment_reference],
        ["company_iban", company_iban],
        ["company_express", company_express],
    ];
    for (const [key, val] of entries) {
        if (val !== undefined && val !== null) {
            await (0, db_1.query)(`INSERT INTO company_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, String(val).trim()]);
        }
    }
    const rows = await (0, db_1.query)(`SELECT key, value FROM company_settings`);
    const updated = {};
    rows.forEach((r) => {
        updated[r.key] = r.value;
    });
    return res.json(updated);
});
exports.default = router;
