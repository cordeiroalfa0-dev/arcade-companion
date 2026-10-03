import { createFileRoute } from "@tanstack/react-router";

import { isSameOriginRequest } from "../../../lib/auth";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

// ~6MB decodificado — suficiente para um save state de arcade, evita abuso.
const MAX_STATE_B64_LEN = 8_000_000;
const MAX_ROM_LEN = 160;
const MAX_CORE_LEN = 80;
const MAX_DATE_STR_LEN = 80;

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
  if (!rom || !core || rom.length > MAX_ROM_LEN || core.length > MAX_CORE_LEN) {
    return json({ ok: false, error: "rom e core são obrigatórios e devem ser válidos." }, 400);
  }

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
  const requestedSavedAt = Number(body?.savedAt);
  const savedAt =
    Number.isFinite(requestedSavedAt) && requestedSavedAt > 0 ? requestedSavedAt : Date.now();
  const dateStr = typeof body?.dateStr === "string" ? body.dateStr.slice(0, MAX_DATE_STR_LEN) : "";

  if (!rom || !core || rom.length > MAX_ROM_LEN || core.length > MAX_CORE_LEN) {
    return json({ ok: false, error: "Dados de save inválidos." }, 400);
  }
  if (!stateB64 || stateB64.length > MAX_STATE_B64_LEN) {
    return json({ ok: false, error: "Estado do save vazio ou grande demais." }, 413);
  }

  const db = await admin();
  type UpsertRpc = (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: Array<{ stored?: boolean; saved_at?: number }> | null;
    error: { code?: string; message: string } | null;
  }>;
  const { data: result, error } = await (db.rpc as unknown as UpsertRpc)("mga_upsert_save", {
    p_user_id: session.uid,
    p_rom: rom,
    p_core: core,
    p_state_b64: stateB64,
    p_preview: preview,
    p_saved_at: savedAt,
    p_date_str: dateStr,
  });
  if (error) {
    // Compatibilidade temporária com ambientes que ainda não aplicaram a
    // migração da função atômica: valida antes e confirma depois do upsert.
    if (error.code !== "42883" && error.code !== "PGRST202") {
      return json({ ok: false, error: error.message }, 500);
    }
    const { data: current, error: readError } = await db
      .from("mga_saves")
      .select("saved_at")
      .eq("user_id", session.uid)
      .eq("rom", rom)
      .eq("core", core)
      .maybeSingle();
    if (readError) return json({ ok: false, error: readError.message }, 500);
    if (current && Number(current.saved_at) > savedAt) {
      return json(
        { ok: true, stored: false, reason: "newer_remote", savedAt: Number(current.saved_at) },
        409,
      );
    }
    const fallback = await db.from("mga_saves").upsert({
      user_id: session.uid,
      rom,
      core,
      state_b64: stateB64,
      preview,
      saved_at: savedAt,
      date_str: dateStr,
    });
    if (fallback.error) return json({ ok: false, error: fallback.error.message }, 500);
    return json({ ok: true, stored: true, savedAt });
  }
  const stored = Array.isArray(result) ? result[0]?.stored !== false : true;
  const remoteSavedAt = Array.isArray(result) ? Number(result[0]?.saved_at || savedAt) : savedAt;
  return json(
    { ok: true, stored, savedAt: remoteSavedAt, reason: stored ? undefined : "newer_remote" },
    stored ? 200 : 409,
  );
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
