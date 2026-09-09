const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  console.log('Atualizando tabela company_settings e pagamentos...');

  await client.query(`
    CREATE TABLE IF NOT EXISTS company_settings (
      key VARCHAR(50) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    INSERT INTO company_settings (key, value) VALUES
      ('payment_entity', '10116'),
      ('payment_reference', '929754355'),
      ('company_iban', 'AO06 0000 0000 0000 0000 0000 0'),
      ('company_express', '244900000000')
    ON CONFLICT (key) DO NOTHING;
  `);

  await client.query(`
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(100);
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS extracted_entity VARCHAR(50);
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS extracted_reference VARCHAR(50);
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS extracted_amount NUMERIC(12,2);
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS auto_validated BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS rejected_proof_attempts INTEGER NOT NULL DEFAULT 0;
  `);

  await client.query(`
    INSERT INTO company_settings (key, value) VALUES
      ('internet_activation_numbers', ''),
      ('internet_deactivation_numbers', '')
    ON CONFLICT (key) DO NOTHING;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_transaction_id ON payments(transaction_id);
  `);

  await client.query("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'account_activated_client'");
  await client.query("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_approved_client'");
  await client.query("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_approved_admin'");
  await client.query("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_rejected_client'");
  await client.query("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'account_suspended_client'");

  console.log('Tabelas e enums atualizados com sucesso!');
  await client.end();
}

main().catch((err) => {
  console.error('Erro ao atualizar base de dados:', err);
  process.exit(1);
});
