import { Pool } from "pg";

export function createDatabasePool(databaseUrl: string): Pool {
    const requiresSsl = databaseUrl.includes("supabase.com") || /sslmode=require/i.test(databaseUrl);

    return new Pool({
        connectionString: databaseUrl,
        ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
    });
}
