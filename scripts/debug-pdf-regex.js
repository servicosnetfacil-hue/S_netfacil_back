const sampleText = `Comprovativo Digital
Detalhe da operação realizada através do canal MULTICAIXA Express.
Data - Hora 2026-09-07 10:21:26
Operação Pagamento de Serviços
Entidade 10116 - CONECTANDO SOC PREST DE SERV DE PAGAMENT
Referência 929754355
Montante 9.500,00 Kz
Transacção 10793680
Descrição ** PAYPAY AFRICA REFERÊNCIA: 929 754 355 MONTANTE:
9500.00 CARREGAMENTO PAGO 042000000000068398335 **
BCI - Mudamos por si
Mantenha a sua conta activa, actualize-a
Caso necessite de obter alguma informação, contacte por favor a nossa linha de apoio MULTICAIXA (24h):
(+244) 222 641 840 | 923 168 840
IBAN: 000500001694174610115 | 500289******0313`;

const entityMatch = sampleText.match(/(?:Entidade|ENTIDADE)[\s:]*([0-9]{5,10})/i);
const entity = entityMatch ? entityMatch[1] : null;

const refMatch = sampleText.match(/(?:Refer[eê]ncia|Ref\.?)[\s:]*([0-9]{5,20})/i);
const reference = refMatch ? refMatch[1] : null;

const transMatch =
  sampleText.match(/(?:Transa[cç][ãa]o|Transa|Opera[cç][ãa]o|N[ºo\.]?\s*(?:de\s*)?Transa[cç][ãa]o)[\s:]*([0-9]{5,20})/i) ||
  sampleText.match(/Transa[^\d\n\r]*?([0-9]{5,20})/i);
const transactionId = transMatch ? transMatch[1] : null;

let amount = null;
const amountMatch =
  sampleText.match(/(?:Montante|Valor|Quantia|Total)[\s:]*([0-9\.\,\s]+)\s*(?:Kz|AOA)?/i) ||
  sampleText.match(/([0-9]{1,3}(?:[\.\s][0-9]{3})*\,[0-9]{2})\s*(?:Kz|AOA)?/i);

if (amountMatch && amountMatch[1]) {
  const cleanStr = amountMatch[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = parseFloat(cleanStr);
  if (!isNaN(parsed) && parsed > 0) amount = parsed;
}

console.log('ENTITY:', entity);
console.log('REFERENCE:', reference);
console.log('TRANSACTION ID:', transactionId);
console.log('AMOUNT RAW MATCH:', amountMatch && amountMatch[1]);
console.log('AMOUNT PARSED:', amount);
