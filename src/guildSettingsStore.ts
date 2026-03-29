import { Pool } from "pg";

export type GuildSetting = {
    categoryId: string;
};

export class GuildSettingsStore {
    private readonly guilds = new Map<string, GuildSetting>();

    public constructor(private readonly pool: Pool) {}

    public async load(): Promise<void> {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS guild_settings (
                guild_id TEXT PRIMARY KEY,
                category_id TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

        const result = await this.pool.query<{ guild_id: string; category_id: string }>(
            "SELECT guild_id, category_id FROM guild_settings",
        );

        this.guilds.clear();
        const guilds = this.guilds;
        for (const { guild_id, category_id } of result.rows) {
            guilds.set(guild_id, { categoryId: category_id });
        }
    }

    public get(guildId: string): GuildSetting | undefined {
        return this.guilds.get(guildId);
    }

    public entries(): IterableIterator<[string, GuildSetting]> {
        return this.guilds.entries();
    }

    public async set(guildId: string, setting: GuildSetting): Promise<void> {
        this.guilds.set(guildId, setting);
        await this.pool.query(
            `
            INSERT INTO guild_settings (guild_id, category_id, updated_at)
            VALUES ($1, $2, now())
            ON CONFLICT (guild_id)
            DO UPDATE SET category_id = EXCLUDED.category_id, updated_at = now()
            `,
            [guildId, setting.categoryId],
        );
    }
}
