import {
    CategoryChannel,
    ChannelType,
    Guild,
    GuildMember,
    OverwriteResolvable,
    PermissionsBitField,
    VoiceChannel,
    VoiceState,
} from "discord.js";

type TempVoiceRecord = {
    guildId: string;
    ownerId: string;
    limit: number;
    deleteTimer: ReturnType<typeof setTimeout> | null;
};

export type TrackedTempVoiceChannel = {
    channelId: string;
    guildId: string;
    ownerId: string;
};

type TempVoiceManagerOptions = {
    defaultCategoryId?: string;
    autoDeleteDelayMs: number;
    channelPrefix: string;
    onChannelTracked?: (tracked: TrackedTempVoiceChannel) => void | Promise<void>;
    onChannelUntracked?: (channelId: string) => void | Promise<void>;
};

const voiceAccessAllow = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.Connect,
    PermissionsBitField.Flags.Speak,
    PermissionsBitField.Flags.Stream,
    PermissionsBitField.Flags.UseVAD,
];

const voiceAccessAllowMap = {
    ViewChannel: true,
    Connect: true,
    Speak: true,
    Stream: true,
    UseVAD: true,
} as const;

const voiceAccessDenyMap = {
    ViewChannel: false,
    Connect: false,
    Speak: false,
    Stream: false,
    UseVAD: false,
} as const;

export type VoiceAccessConfig = {
    mode: "public" | "restricted";
    allowedUserIds?: string[];
    allowedRoleIds?: string[];
};

export class TempVoiceManager {
    private readonly records = new Map<string, TempVoiceRecord>();
    private readonly ownerChannels = new Map<string, string>();
    private readonly guildCategoryOverrides = new Map<string, string>();
    private readonly deleting = new Set<string>();
    private readonly reconciling = new Set<string>();

    public constructor(private readonly options: TempVoiceManagerOptions) {}

    public hydrateTrackedChannels(entries: TrackedTempVoiceChannel[]): void {
        for (const entry of entries) {
            if (!entry.channelId || !entry.guildId || !entry.ownerId) {
                continue;
            }
            if (!this.records.has(entry.channelId)) {
                this.records.set(entry.channelId, {
                    guildId: entry.guildId,
                    ownerId: entry.ownerId,
                    limit: 0,
                    deleteTimer: null,
                });
            }
            this.ownerChannels.set(entry.ownerId, entry.channelId);
        }
    }

    public setGuildCategory(guildId: string, categoryId: string): void {
        this.guildCategoryOverrides.set(guildId, categoryId);
    }

    public async updateOwnedChannelAccess(
        guild: Guild,
        ownerId: string,
        action: "allow" | "deny",
        userIds: string[],
        roleIds: string[],
    ): Promise<VoiceChannel> {
        const channel = await this.getExistingOwnerChannel(guild, ownerId);
        if (!channel) {
            throw new Error("あなたが所有している一時VCが見つかりません。先に /duo /trio /quad で作成してください。");
        }

        const normalizedUsers = new Set<string>();
        const normalizedRoles = new Set<string>();
        const botMemberId = guild.members.me?.id;

        for (const id of userIds) {
            if (id && id !== ownerId && id !== botMemberId) {
                normalizedUsers.add(id);
            }
        }

        for (const id of roleIds) {
            if (id && id !== guild.roles.everyone.id) {
                normalizedRoles.add(id);
            }
        }

        if (normalizedUsers.size === 0 && normalizedRoles.size === 0) {
            throw new Error("対象がありません。ユーザーかロールを指定してください。");
        }

        const overwrite = action === "allow" ? voiceAccessAllowMap : voiceAccessDenyMap;
        await Promise.all([
            ...[...normalizedUsers].map((userId) => channel.permissionOverwrites.edit(userId, overwrite)),
            ...[...normalizedRoles].map((roleId) => channel.permissionOverwrites.edit(roleId, overwrite)),
        ]);

        return channel;
    }

    public async createPrivateVoiceChannel(
        guild: Guild,
        owner: GuildMember,
        size: 2 | 3 | 4,
        requestedName?: string,
        accessConfig: VoiceAccessConfig = { mode: "public" },
    ): Promise<{ channel: VoiceChannel; created: boolean; renamed: boolean }> {
        const botMember = guild.members.me;
        if (!botMember) {
            throw new Error("Bot member is not ready in this guild");
        }

        const permissionOverwrites = this.buildPermissionOverwrites(guild, owner, botMember.id, accessConfig);

        const existingChannel = await this.getExistingOwnerChannel(guild, owner.id);
        if (existingChannel) {
            let renamed = false;
            const nextName = this.buildChannelName(size, owner.user.username, requestedName);

            if (existingChannel.name !== nextName) {
                await existingChannel.setName(nextName);
                renamed = true;
            }

            if (existingChannel.userLimit !== size) {
                await existingChannel.setUserLimit(size);
            }

            await existingChannel.permissionOverwrites.set(permissionOverwrites);

            const existingRecord = this.records.get(existingChannel.id);
            if (existingRecord) {
                existingRecord.limit = size;
            }

            if (existingChannel.members.size === 0) {
                this.scheduleDeletion(guild, existingChannel.id);
            } else {
                this.cancelDeletion(existingChannel.id);
            }

            return { channel: existingChannel, created: false, renamed };
        }

        const category = await this.fetchCategory(guild, this.resolveCategoryId(guild.id));

        const channelName = this.buildChannelName(size, owner.user.username, requestedName);

        const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: category.id,
            userLimit: size,
            permissionOverwrites: permissionOverwrites,
        });

        this.records.set(channel.id, { guildId: guild.id, ownerId: owner.id, limit: size, deleteTimer: null });
        this.ownerChannels.set(owner.id, channel.id);
        this.emitTracked({ channelId: channel.id, guildId: guild.id, ownerId: owner.id });

        if (channel.members.size === 0) {
            this.scheduleDeletion(guild, channel.id);
        }

        return { channel, created: true, renamed: false };
    }

    public async restoreTrackedChannels(guild: Guild): Promise<void> {
        const trackedChannelIds = [...this.records.entries()]
            .filter(([, record]) => record.guildId === guild.id)
            .map(([channelId]) => channelId);

        await Promise.all(trackedChannelIds.map((channelId) => this.reconcileChannelSafely(guild, channelId)));
    }

    public onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
        const guild = newState.guild;
        const impacted = new Set<string>();

        if (oldState.channelId) {
            impacted.add(oldState.channelId);
        }
        if (newState.channelId) {
            impacted.add(newState.channelId);
        }

        for (const channelId of impacted) {
            if (!this.records.has(channelId)) {
                continue;
            }
            void this.reconcileChannelSafely(guild, channelId);
        }
    }

    private async reconcileChannelSafely(guild: Guild, channelId: string): Promise<void> {
        if (this.reconciling.has(channelId) || !this.records.has(channelId)) {
            return;
        }

        this.reconciling.add(channelId);
        try {
            await this.reconcileChannel(guild, channelId);
        } finally {
            this.reconciling.delete(channelId);
        }
    }

    private async reconcileChannel(guild: Guild, channelId: string): Promise<void> {
        const channel = await guild.channels.fetch(channelId).catch(() => null);

        if (!channel || channel.type !== ChannelType.GuildVoice) {
            this.clearChannelRecord(channelId);
            return;
        }

        if (channel.members.size === 0) {
            this.scheduleDeletion(guild, channelId);
            return;
        }

        this.cancelDeletion(channelId);
    }

    private scheduleDeletion(guild: Guild, channelId: string): void {
        const record = this.records.get(channelId);
        if (!record || record.deleteTimer || this.deleting.has(channelId)) {
            return;
        }

        record.deleteTimer = setTimeout(async () => {
            this.deleting.add(channelId);
            try {
                const latest = await guild.channels.fetch(channelId).catch(() => null);
                if (!latest || latest.type !== ChannelType.GuildVoice) {
                    this.clearChannelRecord(channelId);
                    return;
                }

                if (latest.members.size === 0) {
                    await latest.delete("Temporary voice channel became empty");
                    this.clearChannelRecord(channelId);
                    return;
                }

                this.cancelDeletion(channelId);
            } catch {
                this.clearChannelRecord(channelId);
            } finally {
                this.deleting.delete(channelId);
            }
        }, this.options.autoDeleteDelayMs);
    }

    private cancelDeletion(channelId: string): void {
        const record = this.records.get(channelId);
        if (!record?.deleteTimer) {
            return;
        }

        clearTimeout(record.deleteTimer);
        record.deleteTimer = null;
    }

    private clearChannelRecord(channelId: string): void {
        const record = this.records.get(channelId);
        this.cancelDeletion(channelId);
        this.records.delete(channelId);
        if (record) {
            const mapped = this.ownerChannels.get(record.ownerId);
            if (mapped === channelId) {
                this.ownerChannels.delete(record.ownerId);
            }
        }
        this.emitUntracked(channelId);
    }

    private async fetchCategory(guild: Guild, categoryId: string | null): Promise<CategoryChannel> {
        if (!categoryId) {
            throw new Error("このサーバーは未設定です。/setup でカテゴリを設定してください。");
        }

        const category = await guild.channels.fetch(categoryId);
        if (!category || category.type !== ChannelType.GuildCategory) {
            throw new Error("設定されたカテゴリが見つかりません。/setup をやり直してください。");
        }
        return category;
    }

    private resolveCategoryId(guildId: string): string | null {
        return this.guildCategoryOverrides.get(guildId) ?? this.options.defaultCategoryId ?? null;
    }

    private buildChannelName(size: 2 | 3 | 4, username: string, requestedName?: string): string {
        const normalizedRequested = this.normalizeRequestedName(requestedName);
        if (normalizedRequested) {
            return normalizedRequested.slice(0, 90);
        }

        const baseName = this.sanitize(username);
        return `${this.options.channelPrefix}-${size}-${baseName}`.slice(0, 90);
    }

    private normalizeRequestedName(raw?: string): string {
        if (!raw) {
            return "";
        }
        return raw.replace(/\s+/g, " ").trim();
    }

    private buildPermissionOverwrites(
        guild: Guild,
        owner: GuildMember,
        botMemberId: string,
        accessConfig: VoiceAccessConfig,
    ): OverwriteResolvable[] {
        const overwrites: OverwriteResolvable[] = [
            {
                id: guild.roles.everyone.id,
                allow: accessConfig.mode === "public" ? voiceAccessAllow : [],
                deny: accessConfig.mode === "restricted" ? voiceAccessAllow : [],
            },
            {
                id: owner.id,
                allow: voiceAccessAllow,
            },
            {
                id: botMemberId,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.Connect,
                    PermissionsBitField.Flags.Speak,
                    PermissionsBitField.Flags.MoveMembers,
                    PermissionsBitField.Flags.ManageChannels,
                ],
            },
        ];

        if (accessConfig.mode === "restricted") {
            const users = new Set((accessConfig.allowedUserIds ?? []).filter(Boolean));
            const roles = new Set((accessConfig.allowedRoleIds ?? []).filter(Boolean));
            users.delete(owner.id);
            users.delete(botMemberId);
            roles.delete(guild.roles.everyone.id);

            for (const userId of users) {
                overwrites.push({
                    id: userId,
                    allow: voiceAccessAllow,
                });
            }

            for (const roleId of roles) {
                overwrites.push({
                    id: roleId,
                    allow: voiceAccessAllow,
                });
            }
        }

        return overwrites;
    }

    private sanitize(raw: string): string {
        return (
            raw
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, "-")
                .replace(/-+/g, "-")
                .replace(/^-|-$/g, "") || "user"
        );
    }

    private async getExistingOwnerChannel(guild: Guild, ownerId: string): Promise<VoiceChannel | null> {
        const channelId = this.ownerChannels.get(ownerId);
        if (!channelId) {
            return null;
        }

        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildVoice) {
            this.clearChannelRecord(channelId);
            return null;
        }

        const expectedCategoryId = this.resolveCategoryId(guild.id);
        if (expectedCategoryId && channel.parentId !== expectedCategoryId) {
            this.clearChannelRecord(channelId);
            return null;
        }

        const record = this.records.get(channel.id);
        if (!record) {
            this.records.set(channel.id, {
                guildId: guild.id,
                ownerId,
                limit: channel.userLimit ?? 0,
                deleteTimer: null,
            });
            this.emitTracked({ channelId: channel.id, guildId: guild.id, ownerId });
        } else {
            record.guildId = guild.id;
            record.ownerId = ownerId;
            record.limit = channel.userLimit ?? 0;
        }

        return channel;
    }

    private emitTracked(tracked: TrackedTempVoiceChannel): void {
        const result = this.options.onChannelTracked?.(tracked);
        if (result instanceof Promise) {
            void result.catch(() => null);
        }
    }

    private emitUntracked(channelId: string): void {
        const result = this.options.onChannelUntracked?.(channelId);
        if (result instanceof Promise) {
            void result.catch(() => null);
        }
    }
}
