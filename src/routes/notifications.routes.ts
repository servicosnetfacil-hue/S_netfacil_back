import { Router } from "express";
import { query } from "../config/db";
import { authenticate, requireAdmin } from "../middleware/auth";
import { runDailyNotificationJob } from "../jobs/notification.cron";
import { getWhatsAppConfigStatus } from "../services/whatsapp.service";

const router = Router();

router.get("/cron", async (req, res) => {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  const authorization = String(req.headers.authorization ?? "");
  const bearerSecret = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const suppliedSecret = String(req.headers["x-cron-secret"] ?? req.query.secret ?? bearerSecret).trim();

  if (!configuredSecret || suppliedSecret !== configuredSecret) {
    return res.status(401).json({ error: "Cron não autorizado." });
  }

  try {
    await runDailyNotificationJob();
    return res.json({ message: "Job de notificações executado com sucesso." });
  } catch (err: any) {
    console.error("[CRON] Erro na execução serverless:", err);
    return res.status(500).json({ error: err?.message ?? "Erro ao executar o job." });
  }
});

router.get("/health", authenticate, requireAdmin, async (_req, res) => {
  return res.json(getWhatsAppConfigStatus());
});

// GET /notifications/logs — histórico de envios (admin)
router.get("/logs", authenticate, requireAdmin, async (req, res) => {
  const { type, channel } = req.query;
  const conditions: string[] = [];
  const params: any[] = [];

  if (type) { params.push(type); conditions.push(`type = $${params.length}`); }
  if (channel) { params.push(channel); conditions.push(`channel = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const logs = await query(
    `SELECT * FROM notification_logs ${where} ORDER BY sent_at DESC LIMIT 200`,
    params
  );
  return res.json(logs);
});

// GET /notifications/settings — números que recebem instruções de rede
router.get("/settings", authenticate, requireAdmin, async (_req, res) => {
  const rows = await query<any>(
    `SELECT key, value FROM company_settings
     WHERE key IN ('internet_activation_numbers', 'internet_deactivation_numbers')`
  );
  const settings: Record<string, string> = {
    internet_activation_numbers: "",
    internet_deactivation_numbers: "",
  };
  rows.forEach((row) => {
    settings[row.key] = row.value;
  });
  return res.json(settings);
});

// PUT /notifications/settings — configurar números que recebem instruções de rede
router.put("/settings", authenticate, requireAdmin, async (req, res) => {
  const entries = [
    ["internet_activation_numbers", req.body.internet_activation_numbers],
    ["internet_deactivation_numbers", req.body.internet_deactivation_numbers],
  ] as const;

  for (const [key, value] of entries) {
    await query(
      `INSERT INTO company_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, String(value ?? "").trim()]
    );
  }

  return res.json({ message: "Configurações de notificações guardadas." });
});

// POST /notifications/run-now — dispara manualmente o job diário (admin, útil para testes)
router.post("/run-now", authenticate, requireAdmin, async (_req, res) => {
  try {
    await runDailyNotificationJob();
    return res.json({ message: "Job de notificações executado com sucesso." });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Erro ao executar o job." });
  }
});

export default router;
