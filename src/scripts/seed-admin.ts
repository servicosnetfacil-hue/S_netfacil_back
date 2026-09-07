import "dotenv/config";
import bcrypt from "bcrypt";
import { pool } from "../config/db";

// Cria (ou actualiza a palavra-passe de) o utilizador administrador.
// Uso: npm run seed:admin -- "Nome Admin" NetFacil_Master NetFacil_Master "Netfacil@123456"
async function main() {
  const args = process.argv.slice(2);
  const fullName = args[0] ?? "Administrador NetFácil";
  const phone = args[1] ?? "NetFacil_Master";
  const email = args[2] ?? "NetFacil_Master";
  const password = args[3] ?? "Netfacil@123456";

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO users (full_name, email, phone, password_hash, role)
     VALUES ($1, $2, $3, $4, 'admin')
     ON CONFLICT (phone) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name, email = EXCLUDED.email, role = 'admin'
     RETURNING id, full_name, email, phone, role`,
    [fullName, email, phone, passwordHash]
  );

  console.log("Administrador criado/actualizado:", result.rows[0]);
  await pool.end();
}


main().catch((err) => {
  console.error("Falha ao criar administrador:", err);
  process.exit(1);
});
