const bcrypt = require('bcrypt');
const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const user = 'NetFacil_Master';
  const password = 'Netfacil@123456';
  const hash = await bcrypt.hash(password, 10);

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  // Limpa outros campos se necessário e actualiza o utilizador id=1 existente
  await client.query("UPDATE users SET email = NULL WHERE email = $1 AND id != 1", [user]);
  await client.query("UPDATE users SET phone = '000000000000' WHERE phone = $1 AND id != 1", [user]);

  const res = await client.query(
    `UPDATE users
     SET full_name = 'Administrador NetFácil',
         email = $1,
         phone = $1,
         password_hash = $2,
         role = 'admin',
         is_active = true
     WHERE id = 1
     RETURNING id, full_name, email, phone, role`,
    [user, hash]
  );

  console.log('Credenciais de Administrador actualizadas com sucesso:', res.rows[0]);



  await client.end();
}

main().catch((err) => {
  console.error('Erro ao definir credenciais:', err);
  process.exit(1);
});
