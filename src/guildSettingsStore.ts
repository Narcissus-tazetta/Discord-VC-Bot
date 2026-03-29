import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type GuildSetting = {
    categoryId: string;
};

type GuildSettingsFile = {
    guilds: Record<string, GuildSetting>;
};

export class GuildSettingsStore {
    private readonly guilds = new Map<string, GuildSetting>();

    public constructor(private readonly filePath: string) {}

    public async load(): Promise<void> {
        try {
            const raw = await readFile(this.filePath, "utf-8");
            const parsed = JSON.parse(raw) as GuildSettingsFile;
            const entries = Object.entries(parsed.guilds ?? {});
            for (const [guildId, setting] of entries) {
                if (!setting?.categoryId) {
                    continue;
                }
                this.guilds.set(guildId, { categoryId: setting.categoryId });
            }
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "ENOENT") {
                throw error;
            }
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
        await this.persist();
    }

    private async persist(): Promise<void> {
        await mkdir(dirname(this.filePath), { recursive: true });
        const payload: GuildSettingsFile = {
            guilds: Object.fromEntries(this.guilds.entries()),
        };
        await writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf-8");
    }
}
