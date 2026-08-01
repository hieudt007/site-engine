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

  // OAuth client public/PKCE (không có secret) do LeadBase tự đăng ký lúc "Tạo Website"
  // (WebsiteProvisionService.php) — đăng nhập admin đi qua OAuth thật của LeadBase, y hệt luồng
  // AI/MCP đang dùng (system_design.md §5.1).
  leadbaseOauthClientId: requireEnv("LEADBASE_OAUTH_CLIENT_ID"),

  sessionSecret: requireEnv("SESSION_SECRET"),
  customerSessionSecret: requireEnv("CUSTOMER_SESSION_SECRET"),

  // Ma hoa API key AI provider tai DB (Agent.apiKey, SiteConfig.aiProviderKeys) - xem nodeCrypt.ts.
  nodeEncryptionKey: requireEnv("NODE_ENCRYPTION_KEY"),

  smsProvider: process.env.SMS_PROVIDER ?? "",
  smsApiKey: process.env.SMS_API_KEY ?? "",
  smsApiSecret: process.env.SMS_API_SECRET ?? "",
};
