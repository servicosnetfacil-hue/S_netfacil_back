import { Pool } from "pg";

const isAivenConnection = (process.env.DATABASE_URL ?? "").includes("aivencloud.com");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isAivenConnection ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  console.error("[DB] Erro inesperado no pool de ligações:", err);
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}
