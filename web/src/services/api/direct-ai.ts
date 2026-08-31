import { useUserStore } from "@/stores/use-user-store";
import type { AiConfig, DirectAIProvider } from "@/stores/use-config-store";

type DirectRequestBody = Record<string, unknown> | FormData;
type DirectImageResponse = { created?: number; data: Array<{ url?: string; b64_json?: string }> };
type DirectVideoResponse = {
    id: string;
    task_id?: string;
    video_id?: string;
    status?: string;
    progress?: number;
    video_url?: string;
    url?: string;
    error?: { message?: string };
    model?: string;
};

type APIEnvelope<T> = { code?: number; data?: T; msg?: string; message?: string };

export async function requestDirectImages(
    config: AiConfig,
    _provider: DirectAIProvider,
    endpoint: "/images/generations" | "/images/edits",
    body: DirectRequestBody,
    timeoutSeconds: number,
): Promise<DirectImageResponse> {
    const payload = await requestProxy(config, endpoint, withModel(body, config.model || config.imageModel), timeoutSeconds * 1000);
    const data = unwrap<DirectImageResponse>(payload);
    if (!data || !Array.isArray(data.data)) throw new Error("图片接口没有返回结果");
    return data;
}

export async function createDirectVideoTask(
    config: AiConfig,
    _provider: DirectAIProvider,
    body: DirectRequestBody,
): Promise<DirectVideoResponse> {
    const payload = await requestProxy(config, "/videos", withModel(body, config.model || config.videoModel));
    const task = unwrap<DirectVideoResponse>(payload);
    if (!task?.id && !task?.task_id && !task?.video_id) throw new Error("视频接口没有返回任务 ID");
    return { ...task, id: task.id || task.task_id || task.video_id, model: task.model || config.model || config.videoModel };
}

export async function pollDirectVideoTask(
    config: AiConfig,
    _provider: DirectAIProvider,
    pollId: string,
): Promise<DirectVideoResponse> {
    const model = config.model || config.videoModel;
    const payload = await requestProxy(config, `/videos/${encodeURIComponent(pollId)}`);
    const task = unwrap<DirectVideoResponse>(payload);
    if (!task) throw new Error("视频接口没有返回任务状态");
    return { ...task, id: task.id || task.task_id || task.video_id || pollId, model: task.model || model };
}

function withModel(body: DirectRequestBody, model: string): DirectRequestBody {
    if (body instanceof FormData) {
        if (!body.has("model")) body.append("model", model);
        return body;
    }
    return { ...body, model };
}

async function requestProxy(config: AiConfig, path: string, body?: DirectRequestBody, timeoutMs?: number): Promise<unknown> {
    const token = useUserStore.getState().token;
    if (!token) throw new Error("请先登录后再使用 AI 服务");
    const controller = new AbortController();
    const timeout = timeoutMs ? window.setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
        const response = await fetch(`/api/v1${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
            signal: controller.signal,
        });
        const payload = await readResponse(response);
        if (!response.ok) throw new Error(readError(payload) || `AI 接口请求失败：${response.status}`);
        if (isBusinessError(payload)) throw new Error(readError(payload) || "AI 接口请求失败");
        return payload;
    } finally {
        if (timeout !== undefined) window.clearTimeout(timeout);
    }
}

async function readResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { message: text };
    }
}

function isEnvelope(value: unknown): value is APIEnvelope<unknown> {
    return Boolean(value) && typeof value === "object" && "code" in value && ("data" in value || "msg" in value || "message" in value);
}

function isBusinessError(value: unknown): boolean {
    if (!isEnvelope(value) || value.code === undefined || value.code === 0) return false;
    return value.data === undefined && Boolean(value.msg || value.message);
}

function unwrap<T>(value: unknown): T {
    if (isEnvelope(value) && value.data !== undefined) return value.data as T;
    return value as T;
}

function readError(value: unknown): string {
    if (!value || typeof value !== "object") return "";
    const item = value as APIEnvelope<unknown> & { error?: { message?: string } };
    return item.msg || item.message || item.error?.message || "";
}
