function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3040),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: requireEnv("DATABASE_URL"),

  siteEngineSecret: requireEnv("SITE_ENGINE_SECRET"),
  leadbaseApiUrl: requireEnv("LEADBASE_API_URL"),

  sessionSecret: requireEnv("SESSION_SECRET"),
  customerSessionSecret: requireEnv("CUSTOMER_SESSION_SECRET"),

  // Chỉ dùng 1 lần lúc seed tài khoản admin đầu tiên (services/seedAdmin.ts) — không bắt buộc
  // sau đó, các lần khởi động sau không cần (đã có User trong DB).
  adminEmail: process.env.ADMIN_EMAIL ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",

  smsProvider: process.env.SMS_PROVIDER ?? "",
  smsApiKey: process.env.SMS_API_KEY ?? "",
  smsApiSecret: process.env.SMS_API_SECRET ?? "",
};
