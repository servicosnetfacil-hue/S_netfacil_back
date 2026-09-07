"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
/**
 * POST /webhooks/whatsapp
 * Endpoint que a instância WhatsApp (Evolution API / similar) pode chamar
 * para reportar estado de entrega, mensagens recebidas, etc.
 * Ajustar o formato do payload conforme a documentação real do provedor
 * (https://whatsapp-api.electrosoftwares.com).
 */
router.post("/whatsapp", async (req, res) => {
    const event = req.body;
    console.log("[Webhook WhatsApp] Evento recebido:", JSON.stringify(event).slice(0, 500));
    // Exemplo de tratamento: se um cliente responder "PAGO" ou similar,
    // poder-se-ia notificar o admin ou marcar algo no sistema.
    // Implementar de acordo com a estrutura de evento real da API.
    return res.status(200).json({ received: true });
});
exports.default = router;
