import crypto from "node:crypto";
import { config } from "../config.js";

export interface PkcePair {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

// PKCE public client (system_design.md §5.1) — LeadBase Passport chỉ hỗ trợ code_challenge_method
// S256, token_endpoint_auth_method "none" cho client public (đã verify thật ở app/Services/
// WebsiteProvisionService.php createAuthorizationCodeGrantClient(confidential: false)).
export function generatePkce(): PkcePair {
  const state = crypto.randomBytes(16).toString("base64url");
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  return { state, codeVerifier, codeChallenge };
}

export function buildAuthorizeUrl(redirectUri: string, pkce: PkcePair): string {
  const url = new URL("/oauth/authorize", config.leadbaseApiUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.leadbaseOauthClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", pkce.state);
  url.searchParams.set("code_challenge", pkce.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

export interface LeadbaseUserInfo {
  id: number;
  name: string;
  email: string;
  role: "admin" | "manager" | "edit";
}

export async function exchangeCodeForUserInfo(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<LeadbaseUserInfo> {
  const tokenRes = await fetch(new URL("/oauth/token", config.leadbaseApiUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.leadbaseOauthClientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`LeadBase token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }

  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  if (!tokenBody.access_token) {
    throw new Error("LeadBase token exchange returned no access_token");
  }

  const userinfoRes = await fetch(new URL("/api/oauth/userinfo", config.leadbaseApiUrl), {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });

  if (!userinfoRes.ok) {
    throw new Error(`LeadBase userinfo failed: ${userinfoRes.status} ${await userinfoRes.text()}`);
  }

  return (await userinfoRes.json()) as LeadbaseUserInfo;
}
