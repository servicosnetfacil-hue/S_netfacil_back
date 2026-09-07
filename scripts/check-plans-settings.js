require('dotenv').config();
const { query, pool } = require('../dist/config/db');

async function main() {
  const plans = await query('SELECT id, name, price_aoa, is_active FROM plans ORDER BY price_aoa');
  console.log('PLANOS ATIVOS:', plans);

  const settings = await query('SELECT key, value FROM company_settings');
  console.log('CONFIGURAÇÕES DE PAGAMENTO:', settings);

  await pool.end();
}

main().catch(console.error);
