const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  await client.query("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'account_created'");
  console.log("ENUM notification_type actualizado com sucesso!");
  await client.end();
}

main().catch((err) => {
  console.error("Erro ao actualizar ENUM:", err);
  process.exit(1);
});
