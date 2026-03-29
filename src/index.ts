import {
    ChannelType,
    Client,
    Events,
    GatewayIntentBits,
    GuildMember,
    Interaction,
    MessageFlags,
    PermissionFlagsBits,
    Role,
    REST,
    Routes,
    User,
} from "discord.js";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { slashCommands, VOICE_PRESETS } from "./commands.js";
import { appConfig } from "./config.js";
import { GuildSettingsStore } from "./guildSettingsStore.js";
import { TempVoiceManager, VoiceAccessConfig } from "./tempVoiceManager.js";
import { TempVoiceChannelStore } from "./tempVoiceChannelStore.js";

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const tempVoiceChannelStore = new TempVoiceChannelStore(resolve(process.cwd(), "data/temp-voice-channels.json"));

const manager = new TempVoiceManager({
    defaultCategoryId: appConfig.defaultVoiceCategoryId,
    autoDeleteDelayMs: appConfig.autoDeleteDelayMs,
    channelPrefix: appConfig.channelPrefix,
    onChannelTracked: (tracked) => tempVoiceChannelStore.upsert(tracked),
    onChannelUntracked: (channelId) => tempVoiceChannelStore.delete(channelId),
});
const settingsStore = new GuildSettingsStore(resolve(process.cwd(), "data/guild-settings.json"));

const deleteDelaySec = Math.floor(appConfig.autoDeleteDelayMs / 1000);
const ephemeralDeleteDelayMs = 30_000;
const healthPort = Number(process.env.PORT ?? "8000");

function startHealthServer(): void {
    const server = createServer((req, res) => {
        if (req.url === "/health" || req.url === "/") {
            res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
            res.end("ok");
            return;
        }

        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
    });

    server.listen(healthPort, () => {
        console.log(`Health server listening on :${healthPort}`);
    });
}

function scheduleEphemeralDelete(interaction: Interaction): void {
    setTimeout(() => {
        if (!interaction.isRepliable()) {
            return;
        }
        void interaction.deleteReply().catch(() => null);
    }, ephemeralDeleteDelayMs);
}

async function deployCommands(): Promise<void> {
    const rest = new REST({ version: "10" }).setToken(appConfig.token);
    const guilds = await client.guilds.fetch();
    await Promise.all(
        guilds.map(async (_partial, guildId) => {
            await rest.put(Routes.applicationGuildCommands(appConfig.clientId, guildId), {
                body: slashCommands.map((command) => command.toJSON()),
            });
        }),
    );
}

function collectAccessTargets(interaction: Interaction): { userIds: string[]; roleIds: string[] } {
    if (!interaction.isChatInputCommand()) {
        return { userIds: [], roleIds: [] };
    }

    const userIds = new Set<string>();
    const roleIds = new Set<string>();

    const directUser = interaction.options.getUser("allow_user");
    const directRole = interaction.options.getRole("allow_role");
    if (directUser) {
        userIds.add(directUser.id);
    }
    if (directRole) {
        roleIds.add(directRole.id);
    }

    const targets = [
        interaction.options.getMentionable("target1"),
        interaction.options.getMentionable("target2"),
        interaction.options.getMentionable("target3"),
        interaction.options.getMentionable("target4"),
        interaction.options.getMentionable("target5"),
    ];

    for (const target of targets) {
        if (!target) {
            continue;
        }
        if (target instanceof Role) {
            roleIds.add(target.id);
            continue;
        }
        if (target instanceof GuildMember) {
            userIds.add(target.id);
            continue;
        }
        if (target instanceof User) {
            userIds.add(target.id);
        }
    }

    return { userIds: [...userIds], roleIds: [...roleIds] };
}

async function handlePresetCommand(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) {
        return;
    }

    const preset = VOICE_PRESETS.find((item) => item.name === interaction.commandName);
    if (!preset) {
        return;
    }

    if (!interaction.guild) {
        await interaction.reply({
            content: "このコマンドはサーバー内でのみ使用できます。",
            flags: MessageFlags.Ephemeral,
        });
        scheduleEphemeralDelete(interaction);
        return;
    }

    const member = interaction.member;
    if (!(member instanceof GuildMember)) {
        await interaction.reply({ content: "メンバー情報の取得に失敗しました。", flags: MessageFlags.Ephemeral });
        scheduleEphemeralDelete(interaction);
        return;
    }

    const requestedName = interaction.options.getString("name", true).trim();
    const accessMode = interaction.options.getString("access") ?? "public";
    const targets = collectAccessTargets(interaction);

    let accessConfig: VoiceAccessConfig;
    if (accessMode === "public") {
        accessConfig = { mode: "public" };
    } else {
        const allowedUserIds = targets.userIds;
        const allowedRoleIds = targets.roleIds;

        if (allowedUserIds.length === 0 && allowedRoleIds.length === 0) {
            await interaction.reply({
                content: "access を 限定 にする場合は allow_user または allow_role を最低1つ指定してください。",
                flags: MessageFlags.Ephemeral,
            });
            scheduleEphemeralDelete(interaction);
            return;
        }

        accessConfig = {
            mode: "restricted",
            allowedUserIds,
            allowedRoleIds,
        };
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const result = await manager.createPrivateVoiceChannel(
            interaction.guild,
            member,
            preset.userLimit,
            requestedName,
            accessConfig,
        );
        const channel = result.channel;

        const currentChannel = member.voice.channel;
        if (currentChannel && currentChannel.type === ChannelType.GuildVoice) {
            await member.voice.setChannel(channel).catch(() => null);
        }

        await interaction.editReply({
            content: result.created
                ? `作成完了: ${channel.toString()}\nこのVCの参加範囲は${accessConfig.mode === "public" ? "全員" : "限定"}で、空室が${deleteDelaySec}秒続くと自動削除されます。`
                : result.renamed
                  ? `既存のあなたのVC設定を更新しました: ${channel.toString()}\n参加範囲は${accessConfig.mode === "public" ? "全員" : "限定"}、空室が${deleteDelaySec}秒続くと自動削除されます。`
                  : `既存のあなたのVCはこちらです: ${channel.toString()}\n参加範囲は${accessConfig.mode === "public" ? "全員" : "限定"}、空室が${deleteDelaySec}秒続くと自動削除されます。`,
        });
        scheduleEphemeralDelete(interaction);
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        await interaction.editReply({
            content: `VC作成に失敗しました: ${message}`,
        });
        scheduleEphemeralDelete(interaction);
    }
}

async function handleAccessCommand(interaction: Interaction): Promise<boolean> {
    if (!interaction.isChatInputCommand() || !["allow", "deny"].includes(interaction.commandName)) {
        return false;
    }

    if (!interaction.guild) {
        await interaction.reply({
            content: "このコマンドはサーバー内でのみ使用できます。",
            flags: MessageFlags.Ephemeral,
        });
        scheduleEphemeralDelete(interaction);
        return true;
    }

    const member = interaction.member;
    if (!(member instanceof GuildMember)) {
        await interaction.reply({ content: "メンバー情報の取得に失敗しました。", flags: MessageFlags.Ephemeral });
        scheduleEphemeralDelete(interaction);
        return true;
    }

    const targets = collectAccessTargets(interaction);
    if (targets.userIds.length === 0 && targets.roleIds.length === 0) {
        await interaction.reply({
            content: "対象がありません。allow_user / allow_role / target1-5 のいずれかを指定してください。",
            flags: MessageFlags.Ephemeral,
        });
        scheduleEphemeralDelete(interaction);
        return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const action = interaction.commandName === "allow" ? "allow" : "deny";
        const channel = await manager.updateOwnedChannelAccess(
            interaction.guild,
            member.id,
            action,
            targets.userIds,
            targets.roleIds,
        );
        await interaction.editReply({
            content:
                action === "allow"
                    ? `アクセス許可を更新しました: ${channel.toString()}\nユーザー${targets.userIds.length}件、ロール${targets.roleIds.length}件を許可しました。`
                    : `アクセス拒否を更新しました: ${channel.toString()}\nユーザー${targets.userIds.length}件、ロール${targets.roleIds.length}件を拒否しました。`,
        });
        scheduleEphemeralDelete(interaction);
    } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        await interaction.editReply({ content: `更新に失敗しました: ${message}` });
        scheduleEphemeralDelete(interaction);
    }

    return true;
}

async function handleSetupCommand(interaction: Interaction): Promise<boolean> {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "setup") {
        return false;
    }

    if (!interaction.guild || !interaction.guildId) {
        await interaction.reply({
            content: "このコマンドはサーバー内でのみ使用できます。",
            flags: MessageFlags.Ephemeral,
        });
        scheduleEphemeralDelete(interaction);
        return true;
    }

    const member = interaction.member;
    if (!(member instanceof GuildMember)) {
        await interaction.reply({ content: "メンバー情報の取得に失敗しました。", flags: MessageFlags.Ephemeral });
        scheduleEphemeralDelete(interaction);
        return true;
    }

    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
            content: "このコマンドはサーバー管理権限が必要です。",
            flags: MessageFlags.Ephemeral,
        });
        scheduleEphemeralDelete(interaction);
        return true;
    }

    const category = interaction.options.getChannel("category", true);
    if (category.type !== ChannelType.GuildCategory) {
        await interaction.reply({ content: "カテゴリチャンネルを指定してください。", flags: MessageFlags.Ephemeral });
        scheduleEphemeralDelete(interaction);
        return true;
    }

    manager.setGuildCategory(interaction.guildId, category.id);
    await settingsStore.set(interaction.guildId, { categoryId: category.id });

    await interaction.reply({
        content: `設定完了: 一時VCの作成先を ${category.toString()} にしました。`,
        flags: MessageFlags.Ephemeral,
    });
    scheduleEphemeralDelete(interaction);

    await manager.restoreTrackedChannels(interaction.guild).catch(() => null);
    return true;
}

client.once(Events.ClientReady, async (readyClient) => {
    try {
        await settingsStore.load();
        await tempVoiceChannelStore.load();
        manager.hydrateTrackedChannels(tempVoiceChannelStore.entries());
        for (const [guildId, setting] of settingsStore.entries()) {
            manager.setGuildCategory(guildId, setting.categoryId);
        }
        await deployCommands();
        const guilds = await readyClient.guilds.fetch();
        await Promise.all(
            guilds.map(async (_partial, guildId) => {
                const guild = await readyClient.guilds.fetch(guildId);
                await manager.restoreTrackedChannels(guild).catch(() => null);
            }),
        );
        console.log(`Logged in as ${readyClient.user.tag}`);
    } catch (error) {
        console.error("Startup failed", error);
    }
});

client.on(Events.InteractionCreate, (interaction) => {
    void handleSetupCommand(interaction).then((handled) => {
        if (handled) {
            return;
        }
        void handleAccessCommand(interaction).then((accessHandled) => {
            if (accessHandled) {
                return;
            }
            void handlePresetCommand(interaction);
        });
    });
});

client.on(Events.GuildCreate, () => {
    void deployCommands().catch((error) => {
        console.error("Command deploy failed", error);
    });
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    manager.onVoiceStateUpdate(oldState, newState);
});

startHealthServer();

client.login(appConfig.token).catch((error) => {
    console.error("Login failed", error);
    process.exitCode = 1;
});
