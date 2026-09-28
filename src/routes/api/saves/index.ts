import { createFileRoute } from "@tanstack/react-router";

import { ensureSchema, sql } from "../../../lib/db";
import { readSession } from "../../../lib/auth";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ~6MB decodificado — suficiente para um save state de arcade, evita abuso.
const MAX_STATE_B64_LEN = 8_000_000;

async function requireAuth(request: Request) {
  return readSession(request);
}

type SaveEntry = { stateB64: string; preview: string; savedAt: number; dateStr: string };

async function get({ request }: { request: Request }) {
  const session = await requireAuth(request);
  if (!session) return json({ ok: false, error: "Não autenticado." }, 401);

  const url = new URL(request.url);
  const rom = url.searchParams.get("rom") || "";
  const core = url.searchParams.get("core") || "";
  if (!rom || !core) return json({ ok: false, error: "rom e core são obrigatórios." }, 400);

  await ensureSchema();
  const rows = await sql`
    SELECT encode(state_data, 'base64') AS state_b64, preview, saved_at, date_str
    FROM mga_saves
    WHERE user_id = ${session.uid} AND rom = ${rom} AND core = ${core}
  `;
  const row = (rows as Record<string, unknown>[])[0];
  const save: SaveEntry | null = row
    ? {
        stateB64: row["state_b64"] as string,
        preview: (row["preview"] as string) || "",
        savedAt: Number(row["saved_at"]),
        dateStr: (row["date_str"] as string) || "",
      }
    : null;
  return json({ ok: true, save });
}

async function upsert({ request }: { request: Request }) {
  const session = await requireAuth(request);
  if (!session) return json({ ok: false, error: "Não autenticado." }, 401);

  const body = await request.json().catch(() => null);
  const rom = String(body?.rom || "");
  const core = String(body?.core || "");
  const stateB64 = String(body?.stateB64 || "");
  const preview = typeof body?.preview === "string" ? body.preview.slice(0, 300_000) : "";
  const savedAt = Number(body?.savedAt) || Date.now();
  const dateStr = typeof body?.dateStr === "string" ? body.dateStr : "";

  if (!rom || !core) {
    return json({ ok: false, error: "Dados de save inválidos." }, 400);
  }
  if (!stateB64 || stateB64.length > MAX_STATE_B64_LEN) {
    return json({ ok: false, error: "Estado do save vazio ou grande demais." }, 413);
  }

  await ensureSchema();
  await sql`
    INSERT INTO mga_saves (user_id, rom, core, state_data, preview, saved_at, date_str)
    VALUES (${session.uid}, ${rom}, ${core}, decode(${stateB64}, 'base64'), ${preview}, ${savedAt}, ${dateStr})
    ON CONFLICT (user_id, rom, core)
    DO UPDATE SET
      state_data = EXCLUDED.state_data,
      preview = EXCLUDED.preview,
      saved_at = EXCLUDED.saved_at,
      date_str = EXCLUDED.date_str
  `;
  return json({ ok: true });
}

async function remove({ request }: { request: Request }) {
  const session = await requireAuth(request);
  if (!session) return json({ ok: false, error: "Não autenticado." }, 401);

  const url = new URL(request.url);
  const rom = url.searchParams.get("rom") || "";
  const core = url.searchParams.get("core") || "";
  if (!rom || !core) return json({ ok: false, error: "Parâmetros inválidos." }, 400);

  await ensureSchema();
  await sql`
    DELETE FROM mga_saves
    WHERE user_id = ${session.uid} AND rom = ${rom} AND core = ${core}
  `;
  return json({ ok: true });
}

export const Route = createFileRoute("/api/saves/")({
  server: { handlers: { GET: get, POST: upsert, DELETE: remove } },
});
