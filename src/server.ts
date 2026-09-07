import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";

import authRoutes from "./routes/auth.routes";
import clientsRoutes from "./routes/clients.routes";
import plansRoutes from "./routes/plans.routes";
import paymentsRoutes from "./routes/payments.routes";
import financeRoutes from "./routes/finance.routes";
import notificationsRoutes from "./routes/notifications.routes";
import webhooksRoutes from "./routes/webhooks.routes";
import { scheduleNotificationJob } from "./jobs/notification.cron";
import { pool } from "./config/db";

const app = express();
const PORT = process.env.PORT ?? 4000;

// A API é consumida por frontend local, LAN e hospedado.
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/health/db", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.json({ status: "ok", database: "connected" });
  } catch (err) {
    console.error("[Health] Falha na base de dados:", err);
    return res.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.use("/auth", authRoutes);
app.use("/clients", clientsRoutes);
app.use("/plans", plansRoutes);
app.use("/payments", paymentsRoutes);
app.use("/finance", financeRoutes);
app.use("/notifications", notificationsRoutes);
app.use("/webhooks", webhooksRoutes);

// Handler de erro genérico (ex: erros do multer no upload)
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(err?.status ?? 500).json({ error: err?.message ?? "Erro interno do servidor." });
});

app.listen(PORT, () => {
  console.log(`[NetFácil API] a correr em http://localhost:${PORT}`);
  scheduleNotificationJob();
});
