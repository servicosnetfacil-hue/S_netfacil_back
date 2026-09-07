"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageTemplates = void 0;
exports.sendWhatsAppMessage = sendWhatsAppMessage;
exports.sendAndLogNotification = sendAndLogNotification;
exports.getAdminPhone = getAdminPhone;
exports.getWhatsAppConfigStatus = getWhatsAppConfigStatus;
exports.getClientPortalUrl = getClientPortalUrl;
exports.getConfiguredNotificationNumbers = getConfiguredNotificationNumbers;
exports.formatPhoneDisplay = formatPhoneDisplay;
const db_1 = require("../config/db");
const WHATSAPP_BASE_URL = process.env.WHATSAPP_API_URL; // ex: https://whatsapp-api.electrosoftwares.com
const WHATSAPP_INSTANCE = process.env.WHATSAPP_INSTANCE; // ex: hunter-5915bd6e0ff30b99dc4558dc6e3b17b4
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY; // NUNCA hardcode em produção — usar variável de ambiente
const ADMIN_PHONE = process.env.ADMIN_WHATSAPP_PHONE; // número do admin, formato 2449XXXXXXXX
function normalizePhone(number) {
    const digits = number.replace(/\D/g, "");
    return digits.length === 9 ? `244${digits}` : digits;
}
/**
 * Envia uma mensagem de texto via WhatsApp usando a API configurada.
 * Não lança exceção — devolve { success:false, error } para que o cron
 * job continue a processar os restantes clientes mesmo se um envio falhar.
 */
async function sendWhatsAppMessage(number, text) {
    const baseUrl = WHATSAPP_BASE_URL?.trim();
    const instance = WHATSAPP_INSTANCE?.trim();
    const apiKey = WHATSAPP_API_KEY?.trim();
    const recipient = normalizePhone(number);
    if (!baseUrl || !instance || !apiKey) {
        return { success: false, error: "API WhatsApp não configurada no ambiente." };
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
            return { success: false, payload, error: `HTTP ${response.status}` };
        }
        return { success: true, payload };
    }
    catch (err) {
        return { success: false, error: err?.message ?? "Erro desconhecido ao enviar WhatsApp" };
    }
}
/**
 * Envia a mensagem e regista o resultado em notification_logs.
 * A restrição UNIQUE (subscription_id, type, dia) na BD evita duplicados
 * caso o cron corra mais que uma vez no mesmo dia.
 */
async function sendAndLogNotification(params) {
    const result = await sendWhatsAppMessage(params.phone, params.message);
    try {
        await (0, db_1.query)(`INSERT INTO notification_logs
         (user_id, subscription_id, channel, type, phone, message, success, response_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT DO NOTHING`, [
            params.userId,
            params.subscriptionId,
            params.channel,
            params.type,
            params.phone,
            params.message,
            result.success,
            result.payload ? JSON.stringify(result.payload) : null,
        ]);
    }
    catch (err) {
        console.error("[WhatsApp] Falha ao gravar log de notificação:", err);
    }
    return result;
}
function getAdminPhone() {
    return ADMIN_PHONE;
}
function getWhatsAppConfigStatus() {
    return {
        configured: Boolean(WHATSAPP_BASE_URL?.trim() && WHATSAPP_INSTANCE?.trim() && WHATSAPP_API_KEY?.trim()),
        baseUrl: WHATSAPP_BASE_URL?.trim() || null,
        instanceConfigured: Boolean(WHATSAPP_INSTANCE?.trim()),
    };
}
function getClientPortalUrl() {
    return "/login";
}
async function getConfiguredNotificationNumbers(key) {
    const [setting] = await (0, db_1.query)(`SELECT value FROM company_settings WHERE key = $1`, [key]);
    return String(setting?.value ?? "")
        .split(/[;,\n]+/)
        .map((number) => number.trim())
        .filter(Boolean);
}
function formatPhoneDisplay(phone) {
    if (!phone)
        return "";
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
exports.messageTemplates = {
    welcomeClient: (name, phone, password, portalUrl) => `Olá ${name}!  Bem-vindo à *NetFácil*!\n\n` +
        `A sua conta de cliente foi criada com sucesso.\n\n` +
        `🔑 *As suas credenciais de acesso:*\n` +
        `• *Telefone / Login:* ${formatPhoneDisplay(phone)}\n` +
        `• *Palavra-passe:* ${password}\n\n` +
        `🌐 *Aceda ao Portal do Cliente aqui:*\n${portalUrl}\n\n` +
        `Guarde estes dados em segurança. Se precisar de ajuda, entre em contacto connosco!`,
    reminder7d: (name, planName, expiresAt) => `Olá ${name}! 👋 O seu plano *${planName}* na NetFácil vence em 7 dias (${expiresAt}).\n\n` +
        `⚠️ *AVISO IMPORTANTE:* Ao efetuar a renovação, certifique-se de transferir para as coordenadas oficiais corretas e pagar o VALOR EXATO correspondente ao seu plano. Caso contrário, o seu pagamento será considerado *INVÁLIDO* pelo sistema e poderá ocorrer em perda de valores.`,
    reminder3d: (name, planName, expiresAt, iban, expressNumber) => `Olá ${name}, o seu plano *${planName}* vence em 3 dias (${expiresAt}).\n\n` +
        `💳 *Transferência (IBAN):* ${iban}\n📱 *Express:* ${expressNumber}\n\n` +
        `⚠️ *ATENÇÃO:* Transfira apenas para as coordenadas corretas e o *VALOR EXATO* do seu plano. Pagamentos com valores divergentes serão recusados e poderão causar perda de valores. Submeta o comprovativo em PDF no Portal do Cliente após pagar.`,
    reminder1d: (name, expiresAt) => `⚠️ Atenção ${name}: o seu plano vence amanhã (${expiresAt}). Renove hoje para evitar a suspensão do sinal.\n\n` +
        `⚠️ *Lembrete:* Certifique-se de transferir para as coordenadas corretas e o VALOR EXATO do seu plano para evitar a recusa do pagamento e a perda de valores.`,
    expiredClient: (name) => `🔴 ${name}, o seu plano expirou hoje. O sinal será suspenso até efetuar o pagamento.\n\n` +
        `⚠️ *Aviso de Pagamento:* Ao efetuar a transferência, certifique-se de usar as coordenadas oficiais corretas e pagar o VALOR EXATO do seu plano para garantir a validação sem perda de valores.`,
    adminSummary1d: (list) => `📋 *Resumo NetFácil* — planos que vencem amanhã (${list.length}):\n` +
        list.map((c) => `• ${c.name} (${c.phone}) — ${c.planName}`).join("\n"),
    adminSummary0d: (list) => `🔴 *Ação necessária* — planos que expiraram hoje, suspender sinal (${list.length}):\n` +
        list.map((c) => `• ${c.name} (${c.phone}) — ${c.planName}`).join("\n"),
    paymentApprovedClient: (name, planName, amount, expiresAt) => `Olá ${name}! 🟢 O seu carregamento no valor de ${amount} AOA foi validado com sucesso!\n\n` +
        `• *Plano Ativo:* ${planName}\n` +
        `• *Nova Data de Expiração:* ${expiresAt}\n\n` +
        `O seu sinal de internet sera restabelecido dentro de 24h`,
    paymentRejectedClient: (name, reason) => `Olá ${name}. 🔴 O seu comprovativo de pagamento foi rejeitado.\n\n` +
        `*Motivo:* ${reason}\n\n` +
        `Por favor, aceda ao Portal do Cliente para verificar os dados e submeter o comprovativo correto.`,
    accountSuspendedClient: (name) => `Olá ${name}. 🔒 A sua conta NetFácil foi suspensa após 3 comprovativos inválidos. ` +
        `Contacte o administrador para solicitar a reactivação da conta.`,
    paymentApprovedAdmin: (name, phone, planName, amount, transId, expiresAt) => `🔔 *Novo Pagamento Confirmado (NetFácil)*\n\n` +
        `• *Cliente:* ${name} (${formatPhoneDisplay(phone)})\n` +
        `• *Plano:* ${planName}\n` +
        `• *Montante:* ${amount} AOA\n` +
        `• *Nº Transação:* ${transId}\n` +
        `• *Expira em:* ${expiresAt}`,
};
