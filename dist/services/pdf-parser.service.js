"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePaymentProofPdf = parsePaymentProofPdf;
const fs_1 = __importDefault(require("fs"));
/**
 * Extrai os dados do comprovativo em formato PDF (Express / Transferência bancária).
 * Procura por Montante, Transacção, Referência e Entidade no texto do PDF a partir do Buffer ou ficheiro.
 */
async function parsePaymentProofPdf(dataInput) {
    try {
        // O parser só é carregado quando há upload; evita falhas no arranque serverless.
        const { PDFParse } = require("pdf-parse");
        const dataBuffer = typeof dataInput === "string" ? fs_1.default.readFileSync(dataInput) : dataInput;
        const parser = new PDFParse({ data: dataBuffer });
        const pdfData = await parser.getText();
        const text = pdfData.text || "";
        await parser.destroy();
        // 1. Extração de Entidade (ex: "Entidade 10116 - NetFácil" ou "Entidade: 10116")
        const entityMatch = text.match(/(?:Entidade|ENTIDADE)[\s:]*([0-9]{5,10})/i);
        const entity = entityMatch ? entityMatch[1] : null;
        // 2. Extração de Referência (ex: "Referência 929754355", "Referencia: 929754355" ou "Ref: 929754355")
        const refMatch = text.match(/(?:Refer[eê]ncia|Ref\.?)[\s:]*([0-9]{5,20})/i);
        const reference = refMatch ? refMatch[1] : null;
        // 3. Extração de Transacção (ex: "Transacção 14417751", "Transação: 14417751" ou "Operação: 14417751")
        const transMatch = text.match(/(?:Transa[cç][ãa]o|Transa|Opera[cç][ãa]o|N[ºo\.]?\s*(?:de\s*)?Transa[cç][ãa]o)[\s:]*([0-9]{5,20})/i) ||
            text.match(/Transa[^\d\n\r]*?([0-9]{5,20})/i);
        const transactionId = transMatch ? transMatch[1] : null;
        // 4. Extração de Montante (ex: "Montante 5.000,00 Kz", "Valor: 5.000,00 AOA" ou "5 000,00 Kz")
        let amount = null;
        const amountMatch = text.match(/(?:Montante|Valor|Quantia|Total)[\s:]*([0-9\.\,\s]+)\s*(?:Kz|AOA)?/i) ||
            text.match(/([0-9]{1,3}(?:[\.\s][0-9]{3})*\,[0-9]{2})\s*(?:Kz|AOA)?/i);
        if (amountMatch && amountMatch[1]) {
            const cleanStr = amountMatch[1].replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
            const parsed = parseFloat(cleanStr);
            if (!isNaN(parsed) && parsed > 0) {
                amount = parsed;
            }
        }
        return {
            amount,
            transactionId,
            reference,
            entity,
            rawText: text,
        };
    }
    catch (err) {
        console.error("[PDF Parser] Erro ao extrair texto do PDF:", err);
        return {
            amount: null,
            transactionId: null,
            reference: null,
            entity: null,
            rawText: "",
        };
    }
}
