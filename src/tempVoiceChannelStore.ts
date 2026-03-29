import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TrackedTempVoiceChannel } from "./tempVoiceManager.js";

type TempVoiceChannelsFile = {
    channels: Record<string, { guildId: string; ownerId: string }>;
};

export class TempVoiceChannelStore {
    private readonly channels = new Map<string, { guildId: string; ownerId: string }>();

    public constructor(private readonly filePath: string) {}

    public async load(): Promise<void> {
        try {
            const raw = await readFile(this.filePath, "utf-8");
            const parsed = JSON.parse(raw) as TempVoiceChannelsFile;
            for (const [channelId, value] of Object.entries(parsed.channels ?? {})) {
                if (!channelId || !value?.guildId || !value?.ownerId) {
                    continue;
                }
                this.channels.set(channelId, { guildId: value.guildId, ownerId: value.ownerId });
            }
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "ENOENT") {
                throw error;
            }
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
        await this.persist();
    }

    public async delete(channelId: string): Promise<void> {
        this.channels.delete(channelId);
        await this.persist();
    }

    private async persist(): Promise<void> {
        await mkdir(dirname(this.filePath), { recursive: true });
        const payload: TempVoiceChannelsFile = {
            channels: Object.fromEntries(this.channels.entries()),
        };
        await writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf-8");
    }
}
