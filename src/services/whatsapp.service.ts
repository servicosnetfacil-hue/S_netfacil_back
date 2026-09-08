import { query } from "../config/db";

const WHATSAPP_BASE_URL = process.env.WHATSAPP_API_URL as string;      // ex: https://whatsapp-api.electrosoftwares.com
const WHATSAPP_INSTANCE = process.env.WHATSAPP_INSTANCE as string;     // ex: hunter-5915bd6e0ff30b99dc4558dc6e3b17b4
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY as string;       // NUNCA hardcode em produção — usar variável de ambiente
const ADMIN_PHONE = process.env.ADMIN_WHATSAPP_PHONE as string;        // número do admin, formato 2449XXXXXXXX

function normalizePhone(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (digits.length === 9) return `244${digits}`;
  if (digits.length === 12 && digits.startsWith("244")) return digits;
  return "";
}

interface SendResult {
  success: boolean;
  payload?: any;
  error?: string;
}

function getProviderError(payload: any, status: number): string {
  const message = payload?.message ?? payload?.error ?? payload?.response?.message;
  if (Array.isArray(message)) return `HTTP ${status}: ${message.join(", ")}`;
  if (message) return `HTTP ${status}: ${String(message)}`;
  return `HTTP ${status}`;
}

/**
 * Envia uma mensagem de texto via WhatsApp usando a API configurada.
 * Não lança exceção — devolve { success:false, error } para que o cron
 * job continue a processar os restantes clientes mesmo se um envio falhar.
 */
export async function sendWhatsAppMessage(number: string, text: string): Promise<SendResult> {
  const baseUrl = WHATSAPP_BASE_URL?.trim();
  const instance = WHATSAPP_INSTANCE?.trim();
  const apiKey = WHATSAPP_API_KEY?.trim();
  const recipient = normalizePhone(number);

  if (!baseUrl || !instance || !apiKey) {
    return { success: false, error: "API WhatsApp não configurada no ambiente." };
  }
  if (!recipient) {
    return { success: false, error: `Número WhatsApp inválido: ${number}` };
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(instance)}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
      },
      body: JSON.stringify({ number: recipient, text }),
      signal: AbortSignal.timeout(Number(process.env.WHATSAPP_TIMEOUT_MS ?? 15000)),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return { success: false, payload, error: getProviderError(payload, response.status) };
    }
    return { success: true, payload };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "Erro desconhecido ao enviar WhatsApp" };
  }
}

/**
 * Envia a mensagem e regista o resultado em notification_logs.
 * A restrição UNIQUE (subscription_id, type, dia) na BD evita duplicados
 * caso o cron corra mais que uma vez no mesmo dia.
 */
export async function sendAndLogNotification(params: {
  userId: number | null;
  subscriptionId: number | null;
  channel: "client" | "admin";
  type:
    | "account_created"
    | "reminder_7d"
    | "reminder_3d"
    | "reminder_1d"
    | "expired_client"
    | "admin_summary_1d"
    | "admin_summary_0d"
    | "payment_approved_client"
    | "payment_approved_admin"
    | "payment_rejected_client"
    | "account_suspended_client";
  phone: string;
  message: string;
}): Promise<SendResult> {


  const result = await sendWhatsAppMessage(params.phone, params.message);

  if (!result.success) {
    console.error(`[WhatsApp] Falha no envio para ${formatPhoneDisplay(params.phone)}: ${result.error ?? "resposta inválida do provedor"}`);
  }

  try {
    await query(
      `INSERT INTO notification_logs
         (user_id, subscription_id, channel, type, phone, message, success, response_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT DO NOTHING`,
      [
        params.userId,
        params.subscriptionId,
        params.channel,
        params.type,
        params.phone,
        params.message,
        result.success,
        result.payload ? JSON.stringify(result.payload) : null,
      ]
    );
  } catch (err) {
    console.error("[WhatsApp] Falha ao gravar log de notificação:", err);
  }

  return result;
}

export function getAdminPhone(): string {
  return ADMIN_PHONE;
}

export function getWhatsAppConfigStatus() {
  const apiKey = WHATSAPP_API_KEY?.trim() ?? "";
  return {
    configured: Boolean(WHATSAPP_BASE_URL?.trim() && WHATSAPP_INSTANCE?.trim() && apiKey),
    baseUrl: WHATSAPP_BASE_URL?.trim() || null,
    instanceConfigured: Boolean(WHATSAPP_INSTANCE?.trim()),
    instance: WHATSAPP_INSTANCE?.trim() || null,
    apiKeyFingerprint: apiKey.length >= 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : null,
    adminPhone: formatPhoneDisplay(ADMIN_PHONE),
  };
}

export function getClientPortalUrl(): string {
  return "/login";
}

export async function getConfiguredNotificationNumbers(key: string): Promise<string[]> {
  const [setting] = await query<any>(`SELECT value FROM company_settings WHERE key = $1`, [key]);
  return String(setting?.value ?? "")
    .split(/[;,\n]+/)
    .map((number) => number.trim())
    .filter(Boolean);
}

export function formatPhoneDisplay(phone: string): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("244")) {
    const local = digits.slice(3);
    return `+244 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }
  if (digits.length === 9) {
    return `+244 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return phone;
}

// ------------------------------------------------------------
// Modelos de mensagem (PT-AO, tom directo e claro)
// ------------------------------------------------------------
export const messageTemplates = {
  welcomeClient: (name: string, phone: string, password: string, portalUrl: string) =>
    `Olá ${name}!  Bem-vindo à *NetFácil*!\n\n` +
    `A sua conta de cliente foi criada com sucesso.\n\n` +
    `🔑 *As suas credenciais de acesso:*\n` +
    `• *Telefone / Login:* ${formatPhoneDisplay(phone)}\n` +
    `• *Palavra-passe:* ${password}\n\n` +
    `🌐 *Aceda ao Portal do Cliente aqui:*\n${portalUrl}\n\n` +
    `Guarde estes dados em segurança. Se precisar de ajuda, entre em contacto connosco!`,


  reminder7d: (name: string, planName: string, expiresAt: string) =>
    `Olá ${name}! 👋 O seu plano *${planName}* na NetFácil vence em 7 dias (${expiresAt}).\n\n` +
    `⚠️ *AVISO IMPORTANTE:* Ao efetuar a renovação, certifique-se de transferir para as coordenadas oficiais corretas e pagar o VALOR EXATO correspondente ao seu plano. Caso contrário, o seu pagamento será considerado *INVÁLIDO* pelo sistema e poderá ocorrer em perda de valores.`,

  reminder3d: (name: string, planName: string, expiresAt: string, iban: string, expressNumber: string) =>
    `Olá ${name}, o seu plano *${planName}* vence em 3 dias (${expiresAt}).\n\n` +
    `💳 *Transferência (IBAN):* ${iban}\n📱 *Express:* ${expressNumber}\n\n` +
    `⚠️ *ATENÇÃO:* Transfira apenas para as coordenadas corretas e o *VALOR EXATO* do seu plano. Pagamentos com valores divergentes serão recusados e poderão causar perda de valores. Submeta o comprovativo em PDF no Portal do Cliente após pagar.`,

  reminder1d: (name: string, expiresAt: string) =>
    `⚠️ Atenção ${name}: o seu plano vence amanhã (${expiresAt}). Renove hoje para evitar a suspensão do sinal.\n\n` +
    `⚠️ *Lembrete:* Certifique-se de transferir para as coordenadas corretas e o VALOR EXATO do seu plano para evitar a recusa do pagamento e a perda de valores.`,

  expiredClient: (name: string) =>
    `🔴 ${name}, o seu plano expirou hoje. O sinal será suspenso até efetuar o pagamento.\n\n` +
    `⚠️ *Aviso de Pagamento:* Ao efetuar a transferência, certifique-se de usar as coordenadas oficiais corretas e pagar o VALOR EXATO do seu plano para garantir a validação sem perda de valores.`,


  adminSummary1d: (list: { name: string; phone: string; planName: string }[]) =>
    `📋 *Resumo NetFácil* — planos que vencem amanhã (${list.length}):\n` +
    list.map((c) => `• ${c.name} (${c.phone}) — ${c.planName}`).join("\n"),

  adminSummary0d: (list: { name: string; phone: string; planName: string }[]) =>
    `🔴 *Ação necessária* — planos que expiraram hoje, suspender sinal (${list.length}):\n` +
    list.map((c) => `• ${c.name} (${c.phone}) — ${c.planName}`).join("\n"),

  paymentApprovedClient: (name: string, planName: string, amount: string, expiresAt: string) =>
    `Olá ${name}! 🟢 O seu carregamento no valor de ${amount} AOA foi validado com sucesso!\n\n` +
    `• *Plano Ativo:* ${planName}\n` +
    `• *Nova Data de Expiração:* ${expiresAt}\n\n` +
    `O seu sinal de internet sera restabelecido dentro de 24h`,

  paymentRejectedClient: (name: string, reason: string) =>
    `Olá ${name}. 🔴 O seu comprovativo de pagamento foi rejeitado.\n\n` +
    `*Motivo:* ${reason}\n\n` +
    `Por favor, aceda ao Portal do Cliente para verificar os dados e submeter o comprovativo correto.`,

  accountSuspendedClient: (name: string) =>
    `Olá ${name}. 🔒 A sua conta NetFácil foi suspensa após 3 comprovativos inválidos. ` +
    `Contacte o administrador para solicitar a reactivação da conta.`,

  paymentApprovedAdmin: (name: string, phone: string, planName: string, amount: string, transId: string, expiresAt: string) =>
    `🔔 *Novo Pagamento Confirmado (NetFácil)*\n\n` +
    `• *Cliente:* ${name} (${formatPhoneDisplay(phone)})\n` +
    `• *Plano:* ${planName}\n` +
    `• *Montante:* ${amount} AOA\n` +
    `• *Nº Transação:* ${transId}\n` +
    `• *Expira em:* ${expiresAt}`,
};

