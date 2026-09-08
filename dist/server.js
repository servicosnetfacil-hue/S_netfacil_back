"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const clients_routes_1 = __importDefault(require("./routes/clients.routes"));
const plans_routes_1 = __importDefault(require("./routes/plans.routes"));
const payments_routes_1 = __importDefault(require("./routes/payments.routes"));
const finance_routes_1 = __importDefault(require("./routes/finance.routes"));
const notifications_routes_1 = __importDefault(require("./routes/notifications.routes"));
const webhooks_routes_1 = __importDefault(require("./routes/webhooks.routes"));
const notification_cron_1 = require("./jobs/notification.cron");
const db_1 = require("./config/db");
const app = (0, express_1.default)();
const PORT = process.env.PORT ?? 4000;
const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000,https://netfacil.carga.ao,https://www.netfacil.carga.ao")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin.replace(/\/+$/, ""))) {
            return callback(null, true);
        }
        return callback(new Error("Origem não autorizada pelo CORS."));
    },
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Cron-Secret"],
    optionsSuccessStatus: 204,
};
app.use((0, cors_1.default)(corsOptions));
app.options("*", (0, cors_1.default)(corsOptions));
app.use(express_1.default.json());
app.use("/uploads", express_1.default.static(path_1.default.join(process.cwd(), "uploads")));
app.get("/", (_req, res) => res.json({ service: "NetFácil API", status: "ok" }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/health/db", async (_req, res) => {
    try {
        await db_1.pool.query("SELECT 1");
        return res.json({ status: "ok", database: "connected" });
    }
    catch (err) {
        console.error("[Health] Falha na base de dados:", err);
        return res.status(503).json({ status: "error", database: "unavailable" });
    }
});
app.use("/auth", auth_routes_1.default);
app.use("/clients", clients_routes_1.default);
app.use("/plans", plans_routes_1.default);
app.use("/payments", payments_routes_1.default);
app.use("/finance", finance_routes_1.default);
app.use("/notifications", notifications_routes_1.default);
app.use("/webhooks", webhooks_routes_1.default);
// Handler de erro genérico (ex: erros do multer no upload)
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Erro interno do servidor." });
});
if (process.env.VERCEL !== "1") {
    app.listen(PORT, () => {
        console.log(`[NetFácil API] a correr em http://localhost:${PORT}`);
        (0, notification_cron_1.scheduleNotificationJob)();
    });
}
exports.default = app;
