import fs from "fs";

export interface ExtractedProofData {
  amount: number | null;
  transactionId: string | null;
  reference: string | null;
  entity: string | null;
  rawText: string;
  extractionError: string | null;
}

function extractMulticaixaRow(text: string) {
  const operationIndex = text.search(/Pagamento\s+de\s+Servi[cç]os/i);
  if (operationIndex < 0) return null;

  const operationText = text.slice(operationIndex, operationIndex + 400);
  const amountMatch = operationText.match(
    /\b(?:\d{1,3}(?:[.\s]\d{3})+|\d+)[,.]\d{2}\s*(?:Kz|AOA)\b/i
  );
  if (!amountMatch || amountMatch.index === undefined) return null;

  const valuesBeforeAmount = operationText.slice(0, amountMatch.index).match(/\b\d{5,20}\b/g) ?? [];
  const textAfterAmount = operationText.slice(amountMatch.index + amountMatch[0].length);
  const transactionId = textAfterAmount.match(/\b\d{5,20}\b/)?.[0] ?? null;

  return {
    entity: valuesBeforeAmount[0] ?? null,
    reference: valuesBeforeAmount[1] ?? null,
    transactionId,
    amount: amountMatch[0].match(/(?:\d{1,3}(?:[.\s]\d{3})+|\d+)[,.]\d{2}/)?.[0] ?? null,
  };
}

function parseAmount(value: string | null): number | null {
  if (!value) return null;

  const cleanValue = value.replace(/\s/g, "");
  const normalized = cleanValue.includes(",")
    ? cleanValue.replace(/\./g, "").replace(",", ".")
    : cleanValue;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * Extrai os dados do comprovativo em formato PDF (Express / Transferência bancária).
 * Procura por Montante, Transacção, Referência e Entidade no texto do PDF a partir do Buffer ou ficheiro.
 */
export async function parsePaymentProofPdf(dataInput: Buffer | string): Promise<ExtractedProofData> {
  let parser: any;
  try {
    // O parser só é carregado quando há upload; evita falhas no arranque serverless.
    const { PDFParse } = require("pdf-parse");
    const dataBuffer = typeof dataInput === "string" ? fs.readFileSync(dataInput) : dataInput;
    parser = new PDFParse({ data: dataBuffer });
    const pdfData = await parser.getText();
    const text = typeof pdfData.text === "string" ? pdfData.text : "";
    const extractionError = text.trim() ? null : "O PDF não contém texto extraível.";
    if (extractionError) {
      console.warn("[PDF Parser] O PDF foi aberto, mas não contém texto extraível.", {
        byteLength: dataBuffer.length,
      });
    }
    const rowData = extractMulticaixaRow(text);

    // 1. Extração de Entidade (ex: "Entidade 10116 - NetFácil" ou "Entidade: 10116")
    const entityMatch = text.match(/(?:Entidade)\s*[:=-]?\s*([0-9]{5,10})\b/i);
    const entity = entityMatch?.[1] ?? rowData?.entity ?? null;

    // 2. Extração de Referência (ex: "Referência 929754355", "Referencia: 929754355" ou "Ref: 929754355")
    const refMatch = text.match(/(?:Refer[eê]ncia|Ref\.?)\s*[:=-]?\s*([0-9]{5,20})\b/i);
    const reference = refMatch?.[1] ?? rowData?.reference ?? null;

    // 3. Extração de Transacção (ex: "Transacção 14417751", "Transação: 14417751" ou "Operação: 14417751")
    const transMatch =
      text.match(/(?:Transa(?:c)?(?:ç|c)?[ãa]o|Opera[cç][ãa]o|N[ºo\.]?\s*(?:de\s*)?Transa(?:c)?(?:ç|c)?[ãa]o)\s*[:=-]?\s*([0-9]{5,20})\b/i);
    const transactionId = transMatch?.[1] ?? rowData?.transactionId ?? null;

    // 4. Extração de Montante (ex: "Montante 5.000,00 Kz", "Valor: 5.000,00 AOA" ou "5 000,00 Kz")
    const amountMatch =
      text.match(/(?:Montante|Valor|Quantia|Total)\s*[:=-]?\s*((?:\d{1,3}(?:[.\s]\d{3})+|\d+)[,.]\d{2})\s*(?:Kz|AOA)?/i) ||
      text.match(/((?:\d{1,3}(?:[.\s]\d{3})+|\d+)[,.]\d{2})\s*(?:Kz|AOA)\b/i);
    const amount = parseAmount(amountMatch?.[1] ?? rowData?.amount ?? null);

    return {
      amount,
      transactionId,
      reference,
      entity,
      rawText: text,
      extractionError,
    };
  } catch (err) {
    console.error("[PDF Parser] Erro ao extrair texto do PDF:", err);
    const extractionError = err instanceof Error ? err.message : String(err);
    return {
      amount: null,
      transactionId: null,
      reference: null,
      entity: null,
      rawText: "",
      extractionError,
    };
  } finally {
    if (parser) {
      await parser.destroy().catch((err: unknown) => {
        console.error("[PDF Parser] Erro ao libertar recursos do parser:", err);
      });
    }
  }
}
