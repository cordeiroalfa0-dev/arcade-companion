import { createFileRoute } from "@tanstack/react-router";

import { createOAuthStateCookie } from "../../../lib/auth";

async function startGoogleLogin({ request }: { request: Request }) {
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  if (!clientId) {
    const origin = new URL(request.url).origin;
    return new Response(null, {
      status: 302,
      headers: { Location: `${origin}/?auth=unavailable` },
    });
  }

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/auth/google/callback`;
  const { cookie, state } = createOAuthStateCookie();

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl.toString(), "Set-Cookie": cookie },
  });
}

export const Route = createFileRoute("/api/auth/google")({
  server: { handlers: { GET: startGoogleLogin } },
});
