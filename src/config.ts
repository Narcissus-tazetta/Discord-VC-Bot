import { config as loadDotEnv } from "dotenv";

loadDotEnv();

type AppConfig = {
    readonly token: string;
    readonly clientId: string;
    readonly defaultVoiceCategoryId?: string;
    readonly autoDeleteDelayMs: number;
    readonly channelPrefix: string;
};

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function toPositiveInt(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) {
        return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${name} must be a non-negative integer`);
    }
    return parsed;
}

export const appConfig: AppConfig = {
    token: required("BOT_TOKEN"),
    clientId: required("CLIENT_ID"),
    defaultVoiceCategoryId: process.env.VOICE_CATEGORY_ID?.trim() || undefined,
    autoDeleteDelayMs: toPositiveInt("AUTO_DELETE_DELAY_MS", 60_000),
    channelPrefix: process.env.CHANNEL_PREFIX?.trim() || "tempvc",
};
