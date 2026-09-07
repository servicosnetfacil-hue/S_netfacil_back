import { Router } from "express";
import { query } from "../config/db";
import { authenticate, requireAdmin } from "../middleware/auth";

const router = Router();

// GET /plans — lista pública de planos ativos (usado no Portal do Cliente)
router.get("/", async (_req, res) => {
  const plans = await query(`SELECT * FROM plans WHERE is_active = true ORDER BY price_aoa`);
  return res.json(plans);
});

// GET /plans/all — inclui inativos (admin)
router.get("/all", authenticate, requireAdmin, async (_req, res) => {
  const plans = await query(`SELECT * FROM plans ORDER BY price_aoa`);
  return res.json(plans);
});

// POST /plans
router.post("/", authenticate, requireAdmin, async (req, res) => {
  const { name, speedMbps, durationDays, priceAoa, description } = req.body;
  if (!name || !speedMbps || !priceAoa) {
    return res.status(400).json({ error: "Nome, velocidade e preço são obrigatórios." });
  }

  const [plan] = await query<any>(
    `INSERT INTO plans (name, speed_mbps, duration_days, price_aoa, description)
     VALUES ($1,$2,COALESCE($3,30),$4,$5) RETURNING *`,
    [name, speedMbps, durationDays, priceAoa, description ?? null]
  );
  return res.status(201).json(plan);
});

// PUT /plans/:id
router.put("/:id", authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, speedMbps, durationDays, priceAoa, description, isActive } = req.body;

  const [plan] = await query<any>(
    `UPDATE plans SET
       name = COALESCE($1, name), speed_mbps = COALESCE($2, speed_mbps),
       duration_days = COALESCE($3, duration_days), price_aoa = COALESCE($4, price_aoa),
       description = COALESCE($5, description), is_active = COALESCE($6, is_active)
     WHERE id = $7 RETURNING *`,
    [name, speedMbps, durationDays, priceAoa, description, isActive, id]
  );
  if (!plan) return res.status(404).json({ error: "Plano não encontrado." });
  return res.json(plan);
});

// DELETE /plans/:id
router.delete("/:id", authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const result = await query(`DELETE FROM plans WHERE id = $1 RETURNING id`, [id]);
  if (result.length === 0) return res.status(404).json({ error: "Plano não encontrado." });
  return res.status(204).send();
});

export default router;
