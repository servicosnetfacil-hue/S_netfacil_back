import { query } from "../config/db";

const WHATSAPP_BASE_URL = process.env.WHATSAPP_API_URL as string;
const WHATSAPP_INSTANCE = process.env.WHATSAPP_INSTANCE as string;
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY as string;
const ADMIN_PHONE = process.env.ADMIN_WHATSAPP_PHONE as string;

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

function getProviderError(payload: any, status: number, statusText: string, responseBody: string): string {
  const message = payload?.message ?? payload?.error ?? payload?.response?.message;
  if (Array.isArray(message)) return `HTTP ${status}: ${message.join(", ")}`;
  if (message) return `HTTP ${status}: ${String(message)}`;
  return `HTTP ${status}${statusText ? ` ${statusText}` : ""}${responseBody ? `: ${responseBody.slice(0, 500)}` : ""}`;
}

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

  // Configuração do Dispatcher via Undici ProxyAgent para o fetch nativo
  const fixieUrl = process.env.FIXIE_URL;
  let dispatcher: any = undefined;

  if (fixieUrl) {
    try {
      const { ProxyAgent } = await import("undici");
      dispatcher = new ProxyAgent(fixieUrl);
    } catch (err) {
      console.error("[WhatsApp] Erro ao carregar ProxyAgent do undici:", err);
    }
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      body: JSON.stringify({ number: recipient, text }),
      // O fetch nativo do Node.js usa 'dispatcher' em vez de 'agent'
      ...(dispatcher && { dispatcher }),
      signal: AbortSignal.timeout(Number(process.env.WHATSAPP_TIMEOUT_MS ?? 15000)),
    } as any);

    const responseBody = await response.text();
    let payload: any = null;
    try {
      payload = responseBody ? JSON.parse(responseBody) : null;
    } catch {
      // Ignora erro de JSON
    }

    if (!response.ok) {
      const error = getProviderError(payload, response.status, response.statusText, responseBody);
      console.error("[WhatsApp] Resposta da Evolution API:", {
        status: response.status,
        statusText: response.statusText,
        body: responseBody.slice(0, 1000),
        url,
      });
      return { success: false, payload, error };
    }
    return { success: true, payload };
  } catch (err: any) {
    console.error("[WhatsApp] Excepção ao chamar a Evolution API:", {
      name: err?.name,
      message: err?.message,
      url,
    });
    return { success: false, error: err?.message ?? "Erro desconhecido ao enviar WhatsApp" };
  }
}