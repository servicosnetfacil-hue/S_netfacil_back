import cron from "node-cron";
import { query } from "../config/db";
import {
  sendAndLogNotification,
  getAdminPhone,
  messageTemplates,
  getConfiguredNotificationNumbers,
} from "../services/whatsapp.service";

const IBAN = process.env.COMPANY_IBAN ?? "AO06 0000 0000 0000 0000 0000 0";
const EXPRESS_NUMBER = process.env.COMPANY_EXPRESS_NUMBER ?? "244900000000";

interface ExpiringRow {
  subscription_id: number;
  user_id: number;
  full_name: string;
  phone: string;
  plan_name: string;
  expires_at: string;
  days_left: number;
}

async function getSubscriptionsExpiringIn(days: number): Promise<ExpiringRow[]> {
  return query<ExpiringRow>(
    `SELECT s.id AS subscription_id, u.id AS user_id, u.full_name, u.phone,
            p.name AS plan_name, s.expires_at,
            EXTRACT(DAY FROM (s.expires_at - NOW()))::int AS days_left
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     JOIN plans p ON p.id = s.plan_id
     WHERE s.status IN ('active','expiring_soon')
       AND DATE(s.expires_at) = DATE(NOW() + ($1 || ' days')::interval)`,
    [days]
  );
}

async function getSubscriptionsExpiredToday(): Promise<ExpiringRow[]> {
  return query<ExpiringRow>(
    `SELECT s.id AS subscription_id, u.id AS user_id, u.full_name, u.phone,
            p.name AS plan_name, s.expires_at, 0 AS days_left
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     JOIN plans p ON p.id = s.plan_id
     WHERE s.status <> 'expired'
       AND DATE(s.expires_at) = DATE(NOW())`
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-AO");
}

async function runDailyNotificationJob() {
  console.log(`[CRON] Início da verificação diária — ${new Date().toISOString()}`);

  // ---------- 7 dias antes ----------
  for (const c of await getSubscriptionsExpiringIn(7)) {
    await sendAndLogNotification({
      userId: c.user_id,
      subscriptionId: c.subscription_id,
      channel: "client",
      type: "reminder_7d",
      phone: c.phone,
      message: messageTemplates.reminder7d(c.full_name, c.plan_name, formatDate(c.expires_at)),
    });
  }

  // ---------- 3 dias antes ----------
  for (const c of await getSubscriptionsExpiringIn(3)) {
    await sendAndLogNotification({
      userId: c.user_id,
      subscriptionId: c.subscription_id,
      channel: "client",
      type: "reminder_3d",
      phone: c.phone,
      message: messageTemplates.reminder3d(c.full_name, c.plan_name, formatDate(c.expires_at), IBAN, EXPRESS_NUMBER),
    });
  }

  // ---------- 1 dia antes ----------
  const expiringTomorrow = await getSubscriptionsExpiringIn(1);
  for (const c of expiringTomorrow) {
    await sendAndLogNotification({
      userId: c.user_id,
      subscriptionId: c.subscription_id,
      channel: "client",
      type: "reminder_1d",
      phone: c.phone,
      message: messageTemplates.reminder1d(c.full_name, formatDate(c.expires_at)),
    });
    await query(`UPDATE subscriptions SET status='expiring_soon' WHERE id=$1`, [c.subscription_id]);
  }

  if (expiringTomorrow.length > 0) {
    await sendAndLogNotification({
      userId: null,
      subscriptionId: null,
      channel: "admin",
      type: "admin_summary_1d",
      phone: getAdminPhone(),
      message: messageTemplates.adminSummary1d(
        expiringTomorrow.map((c) => ({ name: c.full_name, phone: c.phone, planName: c.plan_name }))
      ),
    });
  }

  // ---------- Dia do vencimento ----------
  const expiredToday = await getSubscriptionsExpiredToday();
  for (const c of expiredToday) {
    await sendAndLogNotification({
      userId: c.user_id,
      subscriptionId: c.subscription_id,
      channel: "client",
      type: "expired_client",
      phone: c.phone,
      message: messageTemplates.expiredClient(c.full_name),
    });
    await query(`UPDATE subscriptions SET status='suspended' WHERE id=$1`, [c.subscription_id]);
  }

  const deactivationNumbers = await getConfiguredNotificationNumbers("internet_deactivation_numbers");
  for (const number of deactivationNumbers) {
    if (expiredToday.length === 0) break;
    await sendAndLogNotification({
      userId: null,
      subscriptionId: null,
      channel: "admin",
      type: "admin_summary_0d",
      phone: number,
      message: messageTemplates.adminSummary0d(
        expiredToday.map((c) => ({ name: c.full_name, phone: c.phone, planName: c.plan_name }))
      ),
    });
  }

  if (expiredToday.length > 0) {
    await sendAndLogNotification({
      userId: null,
      subscriptionId: null,
      channel: "admin",
      type: "admin_summary_0d",
      phone: getAdminPhone(),
      message: messageTemplates.adminSummary0d(
        expiredToday.map((c) => ({ name: c.full_name, phone: c.phone, planName: c.plan_name }))
      ),
    });
  }

  console.log(
    `[CRON] Concluído — 7d:${(await getSubscriptionsExpiringIn(7)).length} envios processados, ` +
      `1d:${expiringTomorrow.length}, expirados hoje:${expiredToday.length}`
  );
}

/** Regista o cron diário no fuso configurado para o ambiente. */
export function scheduleNotificationJob() {
  cron.schedule("0 8 * * *", () => {
    runDailyNotificationJob().catch((err) =>
      console.error("[CRON] Erro na execução do job de notificações:", err)
    );
  }, { timezone: "Africa/Luanda" });

  console.log("[CRON] Job de notificações agendado para 08:00 (Africa/Luanda).");
}

// Exportado para permitir execução manual / testes (ex: rota /notifications/run-now)
export { runDailyNotificationJob };
