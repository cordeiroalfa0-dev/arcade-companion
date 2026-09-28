import { neon } from "@neondatabase/serverless";

function getConnectionString(): string {
  const url =
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING;
  if (!url) {
    throw new Error(
      "Banco de dados não conectado. Crie um Postgres na aba Storage do projeto na Vercel " +
        "(isso cria a variável de ambiente POSTGRES_URL automaticamente) e faça um novo deploy.",
    );
  }
  return url;
}

let sqlClient: ReturnType<typeof neon> | null = null;

/**
 * Tagged-template query helper. Usa o driver HTTP do Neon (edge-safe, sem
 * conexões TCP persistentes) — funciona tanto em runtime Node quanto Edge.
 * Retorna as linhas diretamente (array), como o driver `neon()` faz.
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!sqlClient) sqlClient = neon(getConnectionString());
  return sqlClient(strings, ...values);
}

let schemaReady: Promise<void> | null = null;

/** Garante que as tabelas existem. Roda uma vez por instância "quente". */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto;`;
      await sql`
        CREATE TABLE IF NOT EXISTS mga_users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          google_sub TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          name TEXT,
          avatar_url TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS mga_saves (
          user_id UUID NOT NULL REFERENCES mga_users(id) ON DELETE CASCADE,
          rom TEXT NOT NULL,
          core TEXT NOT NULL,
          state_data BYTEA NOT NULL,
          preview TEXT,
          saved_at BIGINT NOT NULL,
          date_str TEXT,
          PRIMARY KEY (user_id, rom, core)
        );
      `;

      // Migrações defensivas para quem já tinha as tabelas de versões
      // anteriores (login por e-mail/senha; state_b64 como TEXT; um save por
      // slot). Cada uma roda isolada e em sequência: se não se aplicar, só
      // ignora e segue.
      const migrations = [
        () => sql`ALTER TABLE mga_users ADD COLUMN IF NOT EXISTS google_sub TEXT;`,
        () => sql`ALTER TABLE mga_users ADD COLUMN IF NOT EXISTS name TEXT;`,
        () => sql`ALTER TABLE mga_users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`,
        () => sql`ALTER TABLE mga_users ALTER COLUMN password_hash DROP NOT NULL;`,
        () => sql`ALTER TABLE mga_users ADD CONSTRAINT mga_users_google_sub_key UNIQUE (google_sub);`,
        // state_b64 (TEXT, base64) -> state_data (BYTEA): guarda o mesmo
        // conteúdo em formato binário, ~25% menor e mais eficiente pro Postgres.
        () => sql`ALTER TABLE mga_saves ADD COLUMN IF NOT EXISTS state_data BYTEA;`,
        () => sql`
          UPDATE mga_saves SET state_data = decode(state_b64, 'base64')
          WHERE state_data IS NULL AND state_b64 IS NOT NULL;
        `,
        () => sql`ALTER TABLE mga_saves ALTER COLUMN state_data SET NOT NULL;`,
        () => sql`ALTER TABLE mga_saves DROP COLUMN IF EXISTS state_b64;`,
        // 1 save por usuário+jogo (era 1 por usuário+jogo+slot): mantém só o
        // registro mais recente de cada usuário+jogo antes de apertar a chave.
        () => sql`
          DELETE FROM mga_saves a USING mga_saves b
          WHERE a.user_id = b.user_id AND a.rom = b.rom AND a.core = b.core
            AND a.ctid < b.ctid;
        `,
        () => sql`ALTER TABLE mga_saves DROP CONSTRAINT IF EXISTS mga_saves_pkey;`,
        () => sql`ALTER TABLE mga_saves DROP COLUMN IF EXISTS slot;`,
        () => sql`ALTER TABLE mga_saves ADD CONSTRAINT mga_saves_pkey PRIMARY KEY (user_id, rom, core);`,
      ];
      for (const migration of migrations) {
        await migration().catch(() => {});
      }
    })().catch((err) => {
      // Se falhar (ex: banco ainda não conectado), tenta de novo na próxima chamada.
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
