"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { App } from "antd";

import { fetchModelDirectory } from "@/services/api/models";
import { fetchUserConfig } from "@/services/api/user-config";
import { defaultUserStorageProvider, defaultUserWebDAVStorageProvider, saveUserStorageProvider, saveUserWebDAVStorageProvider } from "@/services/image-storage";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const pathname = usePathname();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const loadPublicSettings = useConfigStore((state) => state.loadPublicSettings);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const channelMode = useConfigStore((state) => state.config.channelMode);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const isLoginPage = pathname === "/login" || pathname === "/admin/login";
    const adminRemoteTokenRef = useRef("");

    useEffect(() => {
        void loadPublicSettings();
    }, [loadPublicSettings]);

    useEffect(() => {
        if (!isLoginPage) void hydrateUser();
    }, [hydrateUser, isLoginPage]);

    useEffect(() => {
        if (!token || !user?.id || adminRemoteTokenRef.current === token) return;
        adminRemoteTokenRef.current = token;
        if (channelMode !== "remote") updateConfig("channelMode", "remote");
        void fetchModelDirectory(token)
            .then((directory) => {
                const textModels = directory.text.map((item) => item.modelId);
                const imageModels = directory.image.map((item) => item.modelId);
                const videoModels = directory.video.map((item) => item.modelId);
                const audioModels = directory.audio.map((item) => item.modelId);
                updateConfig("models", [...textModels, ...imageModels, ...videoModels, ...audioModels]);
                updateConfig("textModels", textModels);
                updateConfig("imageModels", imageModels);
                updateConfig("videoModels", videoModels);
                updateConfig("audioModels", audioModels);
                syncSelectedModels({ textModels, imageModels, videoModels, audioModels });
            })
            .catch(() => {});
    }, [channelMode, token, updateConfig, user?.id]);

    useEffect(() => {
        if (!token || !user?.id) return;
        void fetchUserConfig(token)
            .then((payload) => {
                const syncS3 = payload.modelConfig?.syncStorageConfig === true;
                const syncWebDAV = payload.modelConfig?.syncWebDAVStorageConfig === true;
                if (payload.modelConfig) {
                    Object.entries(payload.modelConfig)
                        .filter(([key]) => !["baseUrl", "apiKey", "models", "imageModels", "videoModels", "textModels", "audioModels", "localChannels", "publicChannels"].includes(key))
                        .forEach(([key, value]) => updateConfig(key as keyof AiConfig, value as never));
                    const modelConfig = payload.modelConfig as Partial<AiConfig>;
                    const modelLists = {
                        models: Array.isArray(modelConfig.models) ? modelConfig.models : undefined,
                        imageModels: Array.isArray(modelConfig.imageModels) ? modelConfig.imageModels : undefined,
                        videoModels: Array.isArray(modelConfig.videoModels) ? modelConfig.videoModels : undefined,
                        textModels: Array.isArray(modelConfig.textModels) ? modelConfig.textModels : undefined,
                        audioModels: Array.isArray(modelConfig.audioModels) ? modelConfig.audioModels : undefined,
                    };
                    Object.entries(modelLists).forEach(([key, value]) => {
                        if (value) updateConfig(key as keyof AiConfig, value as never);
                    });
                    syncSelectedModels(modelLists);
                } else {
                    syncSelectedModels();
                }
                updateConfig("syncStorageConfig", syncS3);
                updateConfig("syncWebDAVStorageConfig", syncWebDAV);
                if (syncS3 && payload.storageProvider?.s3) {
                    saveUserStorageProvider({
                        ...defaultUserStorageProvider(),
                        ...payload.storageProvider.s3,
                        type: "s3",
                    });
                }
                if (syncWebDAV && payload.storageProvider?.webdav) {
                    saveUserWebDAVStorageProvider({
                        ...defaultUserWebDAVStorageProvider(),
                        ...payload.storageProvider.webdav,
                        type: "webdav",
                    });
                }
            })
            .catch(() => {});
    }, [token, updateConfig, user?.id]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const hasLocalChannelParams = Boolean(searchParams.get("baseUrl") || searchParams.get("baseurl") || searchParams.get("apiKey") || searchParams.get("apikey"));
        if (!hasLocalChannelParams) return;
        if (!publicSettings) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        openConfigDialog(false);
        message.info("当前仅支持使用云端渠道，URL 中的本地渠道参数已忽略");
    }, [message, openConfigDialog, publicSettings, updateConfig]);

    return <>{children}</>;

    function syncSelectedModels(next?: Partial<Record<"textModels" | "imageModels" | "videoModels" | "audioModels", string[]>>) {
        const config = useConfigStore.getState().config;
        const models = {
            textModels: next?.textModels || config.textModels,
            imageModels: next?.imageModels || config.imageModels,
            videoModels: next?.videoModels || config.videoModels,
            audioModels: next?.audioModels || config.audioModels,
        };
        const selections: Array<[keyof AiConfig, string, string[]]> = [
            ["textModel", config.textModel, models.textModels],
            ["imageModel", config.imageModel, models.imageModels],
            ["videoModel", config.videoModel, models.videoModels],
            ["audioModel", config.audioModel, models.audioModels],
        ];
        selections.forEach(([key, current, available]) => {
            if (available.length && !available.includes(current)) updateConfig(key, available[0] as never);
        });
    }
}
