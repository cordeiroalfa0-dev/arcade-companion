import { createFileRoute } from "@tanstack/react-router";

import { ensureSchema, sql } from "../../../../lib/db";
import {
  clearOAuthStateCookie,
  createSessionCookie,
  readOAuthStateCookie,
} from "../../../../lib/auth";

function redirectHome(origin: string, cookies: string[] = []) {
  const headers = new Headers({ Location: `${origin}/` });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function errorPage(message: string) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;background:#000;color:#f66;padding:2rem">` +
      `<h1>Falha no login com Google</h1><p>${message}</p><p><a href="/" style="color:#0ef">Voltar</a></p></body>`,
    { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function handleCallback({ request }: { request: Request }) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return redirectHome(origin, [clearOAuthStateCookie()]);
  }

  const expectedState = readOAuthStateCookie(request);
  if (!code || !state || !expectedState || state !== expectedState) {
    return errorPage("Sessão de login expirada ou inválida. Volte e tente novamente.");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return errorPage(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET não configurados nas variáveis de ambiente da Vercel.",
    );
  }

  try {
    const redirectUri = `${origin}/api/auth/google/callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null;
    if (!tokenRes.ok || !tokenData?.access_token) {
      return errorPage("Não foi possível confirmar o login com o Google.");
    }

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = (await profileRes.json().catch(() => null)) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    } | null;
    if (!profileRes.ok || !profile?.sub || !profile.email) {
      return errorPage("Não foi possível obter os dados da conta Google.");
    }

    await ensureSchema();
    const rows = await sql`
      INSERT INTO mga_users (google_sub, email, name, avatar_url)
      VALUES (${profile.sub}, ${profile.email}, ${profile.name || ""}, ${profile.picture || ""})
      ON CONFLICT (google_sub)
      DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
      RETURNING id
    `;
    const uid = (rows[0] as { id: string }).id;

    const sessionCookie = await createSessionCookie({
      uid,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
    });

    return redirectHome(origin, [sessionCookie, clearOAuthStateCookie()]);
  } catch (error) {
    return errorPage((error as Error)?.message || "Erro inesperado ao entrar com o Google.");
  }
}

export const Route = createFileRoute("/api/auth/google/callback")({
  server: { handlers: { GET: handleCallback } },
});
