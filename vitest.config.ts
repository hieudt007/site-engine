import { defineConfig } from "vitest/config";

// config.ts doi hoi nhieu bien env ngay luc import (throw neu thieu) du test khong dung toi het -
// gia tri that (DATABASE_URL...) van lay tu env that cua CI/local khi co, chi dien throwaway cho
// cac bien BAT BUOC ma test khong quan tam gia tri thuc.
export default defineConfig({
  test: {
    env: {
      SITE_ENGINE_SECRET: process.env.SITE_ENGINE_SECRET || "ci-throwaway-site-engine-secret",
      LEADBASE_API_URL: process.env.LEADBASE_API_URL || "http://localhost:8000",
      LEADBASE_OAUTH_CLIENT_ID: process.env.LEADBASE_OAUTH_CLIENT_ID || "ci-throwaway-oauth-client-id",
      SESSION_SECRET: process.env.SESSION_SECRET || "ci-throwaway-session-secret-not-for-prod-use",
      CUSTOMER_SESSION_SECRET: process.env.CUSTOMER_SESSION_SECRET || "ci-throwaway-customer-session-secret",
      NODE_ENCRYPTION_KEY: process.env.NODE_ENCRYPTION_KEY || "base64:MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
    },
  },
});
