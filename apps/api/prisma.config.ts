import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Generation/validation needs no database. Migrations use a direct connection.
const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --import tsx prisma/seed.ts',
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
