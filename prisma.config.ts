import "dotenv/config";
import { defineConfig } from "prisma/config";

function prismaDatabaseUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const databaseUrl = new URL(value);
  if (databaseUrl.hostname.endsWith(".pooler.supabase.com") && databaseUrl.port === "6543") {
    databaseUrl.port = "5432";
  }

  return databaseUrl.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    initShadowDb: `
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY,
        email text,
        raw_user_meta_data jsonb
      );
    `,
  },
  datasource: prismaDatabaseUrl(process.env.DATABASE_URL) ? { url: prismaDatabaseUrl(process.env.DATABASE_URL) } : undefined,
  experimental: { externalTables: true },
  tables: { external: ["auth.users"] },
});
