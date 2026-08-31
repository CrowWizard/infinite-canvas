"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { apiGet } from "@/services/api/request";
import type { AdminPublicSettings } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

export type ModelChannel = {
    id: string;
    protocol: "openai" | "gemini" | "grok2api" | "metaso" | "apimart" | "kie" | "mimo";
    name: string;
    baseUrl: string;
    apiKey: string;
    models: string[];
};

export type VideoMultiPromptItem = { prompt: string; duration: string };
export type VideoElementReference = { id: string; kind: "image" | "video" | "audio"; name: string; type: string; dataUrl?: string; url?: string; storageKey?: string; bytes?: number; width?: number; height?: number; durationMs?: number };
export type VideoElementItem = { name: string; description: string; references: VideoElementReference[] };

export type AiConfig = {
    channelMode: "remote";
    baseUrl: string;
    apiKey: string;
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    grokTtsVoice: string;
    grokTtsLanguage: string;
    grokTtsFormat: string;
    grokTtsSpeed: string;
    glmTtsVoice: string;
    glmTtsFormat: string;
    glmTtsSpeed: string;
    mimoTtsVoice: string;
    mimoTtsFormat: string;
    mimoVoiceDesignPrompt: string;
    geminiTtsVoice: string;
    videoSeconds: string;
    videoMode: string;
    videoNegativePrompt: string;
    videoMultiShot: string;
    videoShotType: string;
    videoMultiPrompt: VideoMultiPromptItem[];
    videoElementList: VideoElementItem[];
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    videoCharacterOrientation: string;
    systemPrompt: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
    quality: string;
    size: string;
    videoSize: string;
    count: string;
    canvasImageCount: string;
    timeout: string;
    apiMode: string;
    streamImages: string;
    streamPartialImages: string;
    responseFormatB64Json: string;
    codexCli: string;
    systemPrompts: {
        image: string;
        video: string;
        text: string;
        workflow: string;
        workflowAgent: string;
    };
    publicChannels: Array<{ id?: string; protocol?: ModelChannel["protocol"]; name?: string; baseUrl?: string; models?: string[]; weight?: number; timeout?: number; enabled?: boolean; remark?: string }>;
    syncStorageConfig: boolean;
    syncWebDAVStorageConfig: boolean;
    activeChannelId: string;
    imageChannelId: string;
    videoChannelId: string;
    textChannelId: string;
    audioChannelId: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
export type ModelCapability = "image" | "video" | "text" | "audio";

export const defaultConfig: AiConfig = {
    channelMode: "remote",
    baseUrl: "https://api.openai.com",
    apiKey: "",
    model: "gpt-image-2",
    imageModel: "gpt-image-2",
    videoModel: "grok-imagine-video",
    textModel: "gpt-5.5",
    audioModel: "gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    grokTtsVoice: "eve",
    grokTtsLanguage: "auto",
    grokTtsFormat: "mp3",
    grokTtsSpeed: "1",
    glmTtsVoice: "tongtong",
    glmTtsFormat: "wav",
    glmTtsSpeed: "1",
    mimoTtsVoice: "冰糖",
    mimoTtsFormat: "wav",
    mimoVoiceDesignPrompt: "",
    geminiTtsVoice: "Kore",
    videoSeconds: "6",
    videoMode: "std",
    videoNegativePrompt: "",
    videoMultiShot: "false",
    videoShotType: "intelligence",
    videoMultiPrompt: [{ prompt: "", duration: "1" }],
    videoElementList: [{ name: "", description: "", references: [] }],
    vquality: "720",
    videoGenerateAudio: "false",
    videoWatermark: "false",
    videoCharacterOrientation: "video",
    systemPrompt: "",
    models: [],
    imageModels: [],
    videoModels: [],
    textModels: [],
    audioModels: [],
    quality: "auto",
    size: "1:1",
    videoSize: "1280x720",
    count: "1",
    canvasImageCount: "1",
    timeout: "600",
    apiMode: "images",
    streamImages: "",
    streamPartialImages: "1",
    responseFormatB64Json: "",
    codexCli: "",
    systemPrompts: {
        image: "",
        video: "",
        text: "",
        workflow: "",
        workflowAgent: "",
    },
    publicChannels: [],
    syncStorageConfig: false,
    syncWebDAVStorageConfig: false,
    activeChannelId: "",
    imageChannelId: "",
    videoChannelId: "",
    textChannelId: "",
    audioChannelId: "",
};

type ConfigStore = {
    config: AiConfig;
    publicSettings: AdminPublicSettings | null;
    isPublicSettingsLoading: boolean;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    loadPublicSettings: () => Promise<void>;
    isAiConfigReady: (config: AiConfig, model: string, capability?: ModelCapability) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

function resolveEffectiveConfig(config: AiConfig, modelChannel: AdminPublicSettings["modelChannel"] | null) {
    const channelMode = "remote" as const;
    if (!modelChannel) {
        return { ...config, channelMode, publicChannels: [] };
    }
    const mergeModels = (configured: string[], remote: string[]) => Array.from(new Set([...configured, ...remote]));
    const models = mergeModels(config.models, modelChannel.availableModels || []);
    const textModels = mergeModels(config.textModels, filterChannelModelsByCapability(modelChannel.channels || [], "text", modelChannel.availableModels || []));
    const imageModels = mergeModels(config.imageModels, filterChannelModelsByCapability(modelChannel.channels || [], "image", modelChannel.availableModels || []));
    const videoModels = mergeModels(config.videoModels, filterChannelModelsByCapability(modelChannel.channels || [], "video", modelChannel.availableModels || []));
    const audioModels = mergeModels(config.audioModels, filterChannelModelsByCapability(modelChannel.channels || [], "audio", modelChannel.availableModels || []));
    const fallbackTextModel = validDefault(modelChannel.defaultTextModel, textModels) || preferredModel(textModels, isTextModelName) || textModels[0] || "";
    const fallbackModel = validDefault(modelChannel.defaultModel, textModels) || fallbackTextModel;
    const fallbackImageModel = validDefault(modelChannel.defaultImageModel, imageModels) || preferredModel(imageModels, isImageModelName);
    const fallbackVideoModel = validDefault(modelChannel.defaultVideoModel, videoModels) || preferredModel(videoModels, isVideoModelName);
    const fallbackAudioModel = preferredModel(audioModels, isAudioModelName);
    return {
        ...config,
        channelMode,
        models,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        model: textModels.includes(config.model) ? config.model : fallbackModel,
        imageModel: imageModels.includes(config.imageModel) ? config.imageModel : fallbackImageModel,
        videoModel: videoModels.includes(config.videoModel) ? config.videoModel : fallbackVideoModel,
        textModel: textModels.includes(config.textModel) ? config.textModel : fallbackTextModel || fallbackModel,
        audioModel: audioModels.includes(config.audioModel) ? config.audioModel : fallbackAudioModel,
        systemPrompt: modelChannel.systemPrompt,
        publicChannels: modelChannel.channels || [],
    };
}

function validDefault(model: string, models: string[]) {
    return models.includes(model) ? model : "";
}

function preferredModel(models: string[], predicate: (model: string) => boolean) {
    return models.find(predicate) || "";
}

function isVideoModelName(model: string) {
    const value = model.toLowerCase();
    return (
        value.includes("video") ||
        value.includes("seedance") ||
        value.includes("sora") ||
        value.includes("veo") ||
        value.includes("kling") ||
        value.includes("hailuo") ||
        value.includes("minimax") ||
        value.includes("skyreels") ||
        value.includes("happyhorse") ||
        value.includes("runway") ||
        value.includes("aleph") ||
        value.includes("vidu") ||
        value.includes("pixverse") ||
        value.includes("omni-flash") ||
        value.includes("gemini-omni-video") ||
        value.includes("veo3.1") ||
        value.includes("veo-3.1") ||
        value.includes("infinitalk") ||
        value.includes("wan2-5") ||
        value.includes("wan2.5") ||
        value.includes("wan2-6") ||
        value.includes("wan2.6") ||
        value.includes("wan2-7") ||
        value.includes("wan2.7") ||
        value.includes("wan2-7-r2v") ||
        value.includes("wan2.7-r2v") ||
        value.includes("wan2-7-videoedit") ||
        value.includes("wan2.7-videoedit") ||
        value.includes("wan/2-5") ||
        value.includes("wan/2-6") ||
        value.includes("wan/2-7-text-to-video") ||
        value.includes("wan/2-7-image-to-video") ||
        value.includes("wan/2-7-videoedit") ||
        value.includes("wan/2-7-r2v") ||
        (value.includes("grok-imagine") && (value.includes("/upscale") || value.includes("/extend")))
    );
}

function isImageModelName(model: string) {
    const value = model.toLowerCase();
    return (
        !isVideoModelName(model) &&
        !isAudioModelName(model) &&
        (value.includes("image") ||
            value.includes("nano-banana") ||
            value.includes("seedream") ||
            value.includes("gpt-image") ||
            value.includes("cogview") ||
            value.includes("dall-e") ||
            value.includes("dalle") ||
            value.includes("imagen") ||
            value.includes("gemini-2.5-flash") ||
            value.includes("gemini-3-pro") ||
            value.includes("gemini-3.1-flash") ||
            value.includes("flux") ||
            value.includes("kontext") ||
            value.includes("4o-image") ||
            value.includes("4o image") ||
            value.includes("gpt-4o-image") ||
            value.includes("z-image") ||
            value.includes("qwen/image") ||
            value.includes("qwen2/image") ||
            value.includes("qwen/text-to-image") ||
            value.includes("qwen2/text-to-image") ||
            value.includes("ideogram") ||
            value.includes("recraft") ||
            value.includes("sdxl") ||
            value.includes("stable-diffusion") ||
            value.includes("midjourney") ||
            value.includes("wan2-7-image") ||
            value.includes("wan2.7-image") ||
            value.includes("wan/2-7-image") ||
            value.includes("topaz/image") ||
            value.includes("gemini-omni-character") ||
            (value.includes("grok-imagine") && !value.includes("video")))
    );
}

function isAudioModelName(model: string) {
    const value = model.toLowerCase();
    return (
        value.includes("audio") ||
        value.includes("tts") ||
        value.includes("speech") ||
        value.includes("voice") ||
        value.includes("music") ||
        value.includes("sound") ||
        value.includes("elevenlabs") ||
        value.includes("suno") ||
        value.includes("lyrics") ||
        value.includes("vocal") ||
        value.includes("midi") ||
        value.includes("wav")
    );
}

function isTextModelName(model: string) {
    return !isImageModelName(model) && !isVideoModelName(model) && !isAudioModelName(model);
}

export function modelMatchesCapability(model: string, capability?: ModelCapability, protocol = "") {
    if (!capability) return true;
    if (protocol === "gemini") {
        const value = model.toLowerCase();
        const video = /^models\/veo-|^veo-/.test(value);
        const audio = value.includes("tts");
        const image = !video && !audio && value.includes("image");
        if (capability === "video") return video;
        if (capability === "audio") return audio;
        if (capability === "image") return image;
        return !video && !audio && !image;
    }
    if (capability === "image") return isImageModelName(model);
    if (capability === "video") return isVideoModelName(model);
    if (capability === "audio") return isAudioModelName(model);
    return isTextModelName(model);
}

export function filterModelsByCapability(models: string[], capability?: ModelCapability, protocol = "") {
    return capability ? models.filter((model) => modelMatchesCapability(model, capability, protocol)) : models;
}

export function filterChannelModelsByCapability(channels: Array<{ protocol?: ModelChannel["protocol"]; models: string[] }>, capability: ModelCapability, allowedModels?: string[]) {
    const allowed = allowedModels ? new Set(allowedModels) : null;
    return normalizeModelList(channels.flatMap((channel) => filterModelsByCapability(channel.models, capability, channel.protocol || ""))).filter((model) => !allowed || allowed.has(model));
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    const directoryModels = {
        text: config.textModels,
        image: config.imageModels,
        video: config.videoModels,
        audio: config.audioModels,
    }[capability];
    if (directoryModels.length) return directoryModels;
    const channels = config.publicChannels.map((channel) => ({ protocol: channel.protocol, models: channel.models || [] }));
    return filterChannelModelsByCapability(channels, capability, config.models);
}

function isAiConfigReady(config: AiConfig, model: string, capability?: ModelCapability) {
    if (!model.trim()) return false;
    if (capability && selectableModelsByCapability(config, capability).includes(model)) return true;
    if (config.models.includes(model)) return true;
    return config.publicChannels.some((channel) => (channel.models || []).includes(model));
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            publicSettings: null,
            isPublicSettingsLoading: false,
            isConfigOpen: false,
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            loadPublicSettings: async () => {
                if (get().isPublicSettingsLoading) return;
                set({ isPublicSettingsLoading: true });
                try {
                    set({ publicSettings: await apiGet<AdminPublicSettings>("/api/settings") });
                } finally {
                    set({ isPublicSettingsLoading: false });
                }
            },
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false) => set({ isConfigOpen: true, shouldPromptContinue }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({ config: state.config }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                const publicChannels = Array.isArray(config.publicChannels) ? config.publicChannels : [];
                const publicModels = normalizeModelList(publicChannels.flatMap((channel) => channel.models || []));
                const models = publicModels.length ? publicModels : normalizeModelList(config.models);
                const imageModels = publicChannels.length ? filterChannelModelsByCapability(publicChannels, "image") : normalizeModelList(config.imageModels);
                const videoModels = publicChannels.length ? filterChannelModelsByCapability(publicChannels, "video") : normalizeModelList(config.videoModels);
                const textModels = publicChannels.length ? filterChannelModelsByCapability(publicChannels, "text") : normalizeModelList(config.textModels);
                const audioModels = publicChannels.length ? filterChannelModelsByCapability(publicChannels, "audio") : normalizeModelList(config.audioModels);
                return {
                    ...current,
                    config: {
                        ...config,
                                            models,
                        baseUrl: "",
                        apiKey: "",
                        imageChannelId: config.imageChannelId || publicChannels[0]?.id || "",
                        videoChannelId: config.videoChannelId || publicChannels[0]?.id || "",
                        textChannelId: config.textChannelId || publicChannels[0]?.id || "",
                        audioChannelId: config.audioChannelId || publicChannels[0]?.id || "",
                        activeChannelId: config.activeChannelId || "",
                        syncStorageConfig: config.syncStorageConfig === true,
                        syncWebDAVStorageConfig: config.syncWebDAVStorageConfig === true,
                        channelMode: "remote",
                        imageModel: config.imageModel || config.model,
                        videoModel: config.videoModel || "grok-imagine-video",
                        textModel: config.textModel || config.model,
                        audioModel: config.audioModel || defaultConfig.audioModel,
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        grokTtsVoice: config.grokTtsVoice || defaultConfig.grokTtsVoice,
                        grokTtsLanguage: config.grokTtsLanguage || defaultConfig.grokTtsLanguage,
                        grokTtsFormat: config.grokTtsFormat || defaultConfig.grokTtsFormat,
                        grokTtsSpeed: config.grokTtsSpeed || defaultConfig.grokTtsSpeed,
                        glmTtsVoice: config.glmTtsVoice || defaultConfig.glmTtsVoice,
                        glmTtsFormat: config.glmTtsFormat || defaultConfig.glmTtsFormat,
                        glmTtsSpeed: config.glmTtsSpeed || defaultConfig.glmTtsSpeed,
                        geminiTtsVoice: config.geminiTtsVoice || defaultConfig.geminiTtsVoice,
                        systemPrompts: config.systemPrompts?.image ? config.systemPrompts : defaultConfig.systemPrompts,
                        audioInstructions: config.audioInstructions || "",
                        videoSeconds: config.videoSeconds || "6",
                        videoMode: config.videoMode || "std",
                        videoNegativePrompt: config.videoNegativePrompt || "",
                        videoMultiShot: config.videoMultiShot || "false",
                        videoShotType: config.videoShotType || "intelligence",
                        videoMultiPrompt: Array.isArray(config.videoMultiPrompt) && config.videoMultiPrompt.length ? config.videoMultiPrompt : defaultConfig.videoMultiPrompt,
                        videoElementList: Array.isArray(config.videoElementList) && config.videoElementList.length ? config.videoElementList : defaultConfig.videoElementList,
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "false",
                        videoWatermark: config.videoWatermark || "false",
                        videoCharacterOrientation: config.videoCharacterOrientation === "image" ? "image" : "video",
                        canvasImageCount: config.canvasImageCount || "1",
                        imageModels,
                        videoModels,
                        textModels,
                        audioModels,
                    },
                };
            },
        },
    ),
);

function normalizeModelList(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    const modelChannel = useConfigStore((state) => state.publicSettings?.modelChannel || null);
    return useMemo(() => resolveEffectiveConfig(config, modelChannel), [config, modelChannel]);
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeVersionedBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") || lowerBaseUrl.endsWith("/api/paas/v4") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeVersionedBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        for (const versionPath of ["/api/plan/v3", "/api/paas/v4"]) {
            const versionIndex = lowerPath.indexOf(versionPath);
            if (versionIndex < 0) continue;
            const end = versionIndex + versionPath.length;
            if (lowerPath.length !== end && lowerPath[end] !== "/") continue;
            url.pathname = path.slice(0, end);
            url.search = "";
            url.hash = "";
            return url.toString().replace(/\/+$/, "");
        }
        return baseUrl;
    } catch {
        return baseUrl;
    }
}

export function channelIdForActiveModel(config: AiConfig) {
    const channels = config.publicChannels;
    const selectedChannelId =
        config.model === config.imageModel ? config.imageChannelId : config.model === config.videoModel ? config.videoChannelId : config.model === config.audioModel ? config.audioChannelId : config.model === config.textModel ? config.textChannelId : "";
    const selectedChannel = channels.find((channel) => channel.id === selectedChannelId);
    if (selectedChannel?.protocol === "gemini") return selectedChannelId;
    if (!selectedChannel) {
        const geminiChannel = channels.find((channel) => channel.protocol === "gemini" && (channel.models || []).includes(config.model));
        if (geminiChannel) return geminiChannel.id || "";
    }
    if (modelMatchesCapability(config.model, "image") && config.imageChannelId) return config.imageChannelId;
    if (modelMatchesCapability(config.model, "video") && config.videoChannelId) return config.videoChannelId;
    if (modelMatchesCapability(config.model, "audio") && config.audioChannelId) return config.audioChannelId;
    if (modelMatchesCapability(config.model, "text") && config.textChannelId) return config.textChannelId;
    if (config.activeChannelId) return config.activeChannelId;
    if (config.model === config.videoModel) return config.videoChannelId;
    if (config.model === config.textModel) return config.textChannelId;
    if (config.model === config.audioModel) return config.audioChannelId;
    return config.imageChannelId;
}

export function publicChannelForActiveModel(config: AiConfig): ModelChannel | undefined {
    const channels = config.publicChannels;
    const channel = channels.find((item) => item.id === channelIdForActiveModel(config)) || channels.find((item) => (item.models || []).includes(config.model)) || channels[0];
    if (!channel) return undefined;
    return {
        id: channel.id || "",
        protocol: channel.protocol || "openai",
        name: channel.name || "云端渠道",
        baseUrl: channel.baseUrl || "",
        apiKey: "",
        models: channel.models || [],
    };
}

export function channelProtocolForConfig(config: AiConfig): ModelChannel["protocol"] {
    const channel = config.publicChannels.find((item) => item.id === channelIdForActiveModel(config)) || config.publicChannels[0];
    return channel?.protocol || "openai";
}

export type DirectAIProvider = "kie" | "apimart";

export function directAIProviderForConfig(config: AiConfig): DirectAIProvider | null {
    const protocol = channelProtocolForConfig(config);
    return protocol === "kie" || protocol === "apimart" ? protocol : null;
}
