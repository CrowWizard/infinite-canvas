import { apiGet } from "@/services/api/request";

export type AIModel = {
    id: string;
    modelId: string;
    displayName: string;
    modelType: "text" | "image" | "video" | "audio";
    provider: string;
    enabled: boolean;
    sortOrder: number;
    capabilities: string;
};

export type ModelDirectory = Record<AIModel["modelType"], AIModel[]>;

export function fetchModelDirectory(token: string) {
    return apiGet<ModelDirectory>("/api/models", undefined, token);
}
