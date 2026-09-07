const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

(async () => {
  const schemaPath = path.resolve(__dirname, '..', '..', 'database', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const before = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    console.log('TABLES_BEFORE', before.rows.map((r) => r.table_name));

    await client.query('DROP SCHEMA public CASCADE;');
    await client.query('CREATE SCHEMA public;');
    await client.query(sql);

    const after = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    console.log('TABLES_AFTER', after.rows.map((r) => r.table_name));

    const count = await client.query('SELECT COUNT(*) AS total FROM users');
    console.log('USERS_COUNT', count.rows[0].total);
  } catch (err) {
    console.error('DB_ERROR', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
