require("dotenv").config();

const required = [
  "DATABASE_URL",
  "JWT_SECRET",
  "WHATSAPP_API_URL",
  "WHATSAPP_INSTANCE",
  "WHATSAPP_API_KEY",
];

const missing = required.filter((key) => !process.env[key]?.trim());
const warnings = [];

if (process.env.JWT_SECRET === "NetFacil-Dev-JWT-2026-Strong-Secret") {
  warnings.push("JWT_SECRET ainda usa o segredo de desenvolvimento.");
}
if (process.env.WHATSAPP_API_KEY?.startsWith("SUBSTITUA")) {
  warnings.push("WHATSAPP_API_KEY ainda é um placeholder.");
}

if (missing.length > 0) {
  console.error(`Variáveis obrigatórias ausentes: ${missing.join(", ")}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && warnings.length > 0) {
  console.error("Configuração insegura para produção:");
  warnings.forEach((warning) => console.error(`- ${warning}`));
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn("Avisos de produção:");
  warnings.forEach((warning) => console.warn(`- ${warning}`));
}

console.log("Configuração de ambiente válida.");