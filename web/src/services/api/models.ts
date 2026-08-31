import { apiGet, apiPost } from "@/services/api/request";

export type AIModel = {
    id: string;
    modelId: string;
    displayName: string;
    modelType: "text" | "image" | "video" | "audio";
    provider: string;
    enabled: boolean;
    sortOrder: number;
    capabilities: string;
    newApiTokenId?: string;
};

export type ModelDirectory = Record<AIModel["modelType"], AIModel[]>;

export function fetchModelDirectory(token: string) {
    return apiGet<ModelDirectory>("/api/models", undefined, token);
}


export type UserNewAPIToken = {
    tokenId: string;
    name: string;
    enabled: boolean;
    isDefault: boolean;
    expiredAt: string;
    lastSyncedAt: string;
};

export function fetchUserNewAPITokens(token: string) {
    return apiGet<UserNewAPIToken[]>("/api/v1/user-config/newapi-tokens", undefined, token);
}

export function bindUserAIModelToken(token: string, aiModelId: string, newApiTokenId: string) {
    return apiPost<boolean>("/api/v1/user-config/model-token", { aiModelId, newApiTokenId }, token);
}
