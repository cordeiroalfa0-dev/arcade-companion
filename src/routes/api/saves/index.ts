import { createFileRoute } from "@tanstack/react-router";

import { isSameOriginRequest } from "../../../lib/auth";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ~6MB decodificado — suficiente para um save state de arcade, evita abuso.
const MAX_STATE_B64_LEN = 8_000_000;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function readSaveSession(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  try {
    const db = await admin();
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return null;
    return {
      uid: data.user.id,
      email: data.user.email ?? "",
      name: "",
      picture: "",
      exp: 0,
    };
  } catch {
    return null;
  }
}

async function get({ request }: { request: Request }) {
  const session = await readSaveSession(request);
  if (!session) return json({ ok: false, error: "Não autenticado." }, 401);

  const url = new URL(request.url);
  const rom = url.searchParams.get("rom") || "";
  const core = url.searchParams.get("core") || "";
  if (!rom || !core) return json({ ok: false, error: "rom e core são obrigatórios." }, 400);

  const db = await admin();
  const { data, error } = await db
    .from("mga_saves")
    .select("state_b64, preview, saved_at, date_str")
    .eq("user_id", session.uid)
    .eq("rom", rom)
    .eq("core", core)
    .maybeSingle();
  if (error) return json({ ok: false, error: error.message }, 500);
  const save = data
    ? {
        stateB64: data.state_b64,
        preview: data.preview || "",
        savedAt: Number(data.saved_at),
        dateStr: data.date_str || "",
      }
    : null;
  return json({ ok: true, save });
}

async function upsert({ request }: { request: Request }) {
  if (!isSameOriginRequest(request)) return json({ ok: false, error: "Origem inválida." }, 403);
  const session = await readSaveSession(request);
  if (!session) return json({ ok: false, error: "Não autenticado." }, 401);

  const body = await request.json().catch(() => null);
  const rom = String(body?.rom || "");
  const core = String(body?.core || "");
  const stateB64 = String(body?.stateB64 || "");
  const preview = typeof body?.preview === "string" ? body.preview.slice(0, 300_000) : "";
  const savedAt = Number(body?.savedAt) || Date.now();
  const dateStr = typeof body?.dateStr === "string" ? body.dateStr : "";

  if (!rom || !core) return json({ ok: false, error: "Dados de save inválidos." }, 400);
  if (!stateB64 || stateB64.length > MAX_STATE_B64_LEN) {
    return json({ ok: false, error: "Estado do save vazio ou grande demais." }, 413);
  }

  const db = await admin();
  const { error } = await db.from("mga_saves").upsert({
    user_id: session.uid,
    rom,
    core,
    state_b64: stateB64,
    preview,
    saved_at: savedAt,
    date_str: dateStr,
  });
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true });
}

async function remove({ request }: { request: Request }) {
  if (!isSameOriginRequest(request)) return json({ ok: false, error: "Origem inválida." }, 403);
  const session = await readSaveSession(request);
  if (!session) return json({ ok: false, error: "Não autenticado." }, 401);

  const url = new URL(request.url);
  const rom = url.searchParams.get("rom") || "";
  const core = url.searchParams.get("core") || "";
  if (!rom || !core) return json({ ok: false, error: "Parâmetros inválidos." }, 400);

  const db = await admin();
  const { error } = await db
    .from("mga_saves")
    .delete()
    .eq("user_id", session.uid)
    .eq("rom", rom)
    .eq("core", core);
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true });
}

export const Route = createFileRoute("/api/saves/")({
  server: { handlers: { GET: get, POST: upsert, DELETE: remove } },
});
