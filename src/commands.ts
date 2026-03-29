import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export type VoicePreset = {
    readonly name: "duo" | "trio" | "quad";
    readonly description: string;
    readonly userLimit: 2 | 3 | 4;
};

export const VOICE_PRESETS: readonly VoicePreset[] = [
    { name: "duo", description: "2人用の一時VCを作成", userLimit: 2 },
    { name: "trio", description: "3人用の一時VCを作成", userLimit: 3 },
    { name: "quad", description: "4人用の一時VCを作成", userLimit: 4 },
] as const;

export const setupCommand = new SlashCommandBuilder()
    .setName("setup")
    .setDescription("このサーバーで一時VCを作るカテゴリを設定")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
        option
            .setName("category")
            .setDescription("一時VCを作成するカテゴリ")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true),
    );

function addAccessTargetOptions<T>(builder: T): T {
    return (builder as SlashCommandBuilder)
        .addUserOption((option) =>
            option.setName("allow_user").setDescription("対象ユーザー（任意）").setRequired(false),
        )
        .addRoleOption((option) => option.setName("allow_role").setDescription("対象ロール（任意）").setRequired(false))
        .addMentionableOption((option) =>
            option.setName("target1").setDescription("追加対象1（ユーザーまたはロール）").setRequired(false),
        )
        .addMentionableOption((option) =>
            option.setName("target2").setDescription("追加対象2（ユーザーまたはロール）").setRequired(false),
        )
        .addMentionableOption((option) =>
            option.setName("target3").setDescription("追加対象3（ユーザーまたはロール）").setRequired(false),
        )
        .addMentionableOption((option) =>
            option.setName("target4").setDescription("追加対象4（ユーザーまたはロール）").setRequired(false),
        )
        .addMentionableOption((option) =>
            option.setName("target5").setDescription("追加対象5（ユーザーまたはロール）").setRequired(false),
        ) as T;
}

export const allowCommand = addAccessTargetOptions(
    new SlashCommandBuilder().setName("allow").setDescription("自分の一時VCにユーザー/ロールの参加を許可"),
);

export const denyCommand = addAccessTargetOptions(
    new SlashCommandBuilder().setName("deny").setDescription("自分の一時VCからユーザー/ロールの参加を拒否"),
);

export const slashCommands = [
    ...VOICE_PRESETS.map((preset) =>
        addAccessTargetOptions(
            new SlashCommandBuilder()
                .setName(preset.name)
                .setDescription(preset.description)
                .addStringOption((option) =>
                    option.setName("name").setDescription("作成するVC名").setMaxLength(90).setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName("access")
                        .setDescription("参加範囲")
                        .addChoices({ name: "全員", value: "public" }, { name: "限定", value: "restricted" })
                        .setRequired(false),
                ),
        ),
    ),
    setupCommand,
    allowCommand,
    denyCommand,
];
