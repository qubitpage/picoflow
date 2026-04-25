import pg from "pg";
const { Pool } = pg;

const globalForDb = globalThis as unknown as { _picoflowPool?: pg.Pool };

export const db =
  globalForDb._picoflowPool ??
  new Pool({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "picoflow",
    password: process.env.DB_PASSWORD ?? "picoflow",
    database: process.env.DB_NAME ?? "picoflow",
    max: 5,
  });

if (process.env.NODE_ENV !== "production") globalForDb._picoflowPool = db;
