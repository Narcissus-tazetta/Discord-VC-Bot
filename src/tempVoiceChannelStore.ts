import { Pool } from "pg";
import { TrackedTempVoiceChannel } from "./tempVoiceManager.js";

export class TempVoiceChannelStore {
    private readonly channels = new Map<string, { guildId: string; ownerId: string }>();

    public constructor(private readonly pool: Pool) {}

    public async load(): Promise<void> {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS temp_voice_channels (
                channel_id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                owner_id TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

        await this.pool.query(`
            CREATE INDEX IF NOT EXISTS idx_temp_voice_channels_guild_id
            ON temp_voice_channels (guild_id)
        `);

        const result = await this.pool.query<{ channel_id: string; guild_id: string; owner_id: string }>(
            "SELECT channel_id, guild_id, owner_id FROM temp_voice_channels",
        );

        this.channels.clear();
        for (const row of result.rows) {
            this.channels.set(row.channel_id, { guildId: row.guild_id, ownerId: row.owner_id });
        }
    }

    public entries(): TrackedTempVoiceChannel[] {
        return [...this.channels.entries()].map(([channelId, value]) => ({
            channelId,
            guildId: value.guildId,
            ownerId: value.ownerId,
        }));
    }

    public async upsert(entry: TrackedTempVoiceChannel): Promise<void> {
        this.channels.set(entry.channelId, { guildId: entry.guildId, ownerId: entry.ownerId });
        await this.pool.query(
            `
            INSERT INTO temp_voice_channels (channel_id, guild_id, owner_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (channel_id)
            DO UPDATE SET guild_id = EXCLUDED.guild_id, owner_id = EXCLUDED.owner_id
            `,
            [entry.channelId, entry.guildId, entry.ownerId],
        );
    }

    public async delete(channelId: string): Promise<void> {
        this.channels.delete(channelId);
        await this.pool.query("DELETE FROM temp_voice_channels WHERE channel_id = $1", [channelId]);
    }
}
