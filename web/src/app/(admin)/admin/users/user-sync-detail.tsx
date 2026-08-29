"use client";

import { App, Drawer, Space, Spin, Switch, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import { fetchAdminUserModels, saveAdminUserModel, type AdminUserModelData } from "@/services/api/admin";
import type { AdminUser } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

export function UserSyncDetail({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const [data, setData] = useState<AdminUserModelData | null>(null);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        if (!user) return;
        setLoading(true);
        try {
            setData(await fetchAdminUserModels(token, user.id));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载用户同步信息失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user && token) void load();
    }, [user, token]);

    const updatePermission = async (modelId: string, enabled: boolean) => {
        if (!user) return;
        try {
            await saveAdminUserModel(token, user.id, modelId, enabled);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新模型权限失败");
        }
    };

    return (
        <Drawer title={`同步信息：${user?.displayName || user?.username || "用户"}`} width={760} open={!!user} onClose={onClose} destroyOnClose>
            <Spin spinning={loading}>
                <Typography.Title level={5}>NewAPI Token</Typography.Title>
                <Table
                    rowKey="tokenId"
                    size="small"
                    pagination={false}
                    dataSource={data?.tokens || []}
                    columns={[
                        { title: "Token ID", dataIndex: "tokenId", ellipsis: true },
                        { title: "名称", dataIndex: "name" },
                        { title: "状态", dataIndex: "enabled", render: (enabled: boolean) => <Tag color={enabled ? "success" : "default"}>{enabled ? "启用" : "禁用"}</Tag> },
                        { title: "默认", dataIndex: "isDefault", render: (value: boolean) => (value ? <Tag color="blue">默认</Tag> : "-") },
                        { title: "过期时间", dataIndex: "expiredAt", render: (value: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "永不过期") },
                        { title: "同步时间", dataIndex: "lastSyncedAt", render: (value: string) => (value ? dayjs(value).format("YYYY-MM-DD HH:mm:ss") : "-") },
                    ]}
                    locale={{ emptyText: "暂无同步 Token" }}
                />
                <Typography.Title level={5} style={{ marginTop: 28 }}>
                    模型权限
                </Typography.Title>
                <Table
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={data?.models || []}
                    columns={[
                        {
                            title: "模型",
                            dataIndex: "modelId",
                            render: (value: string, item) => (
                                <Space direction="vertical" size={0}>
                                    <Typography.Text>{item.displayName || value}</Typography.Text>
                                    <Typography.Text type="secondary">{value}</Typography.Text>
                                </Space>
                            ),
                        },
                        { title: "类型", dataIndex: "modelType" },
                        { title: "全局状态", dataIndex: "enabled", render: (value: boolean) => (value ? <Tag color="success">启用</Tag> : <Tag>禁用</Tag>) },
                        {
                            title: "用户启用",
                            dataIndex: "userEnabled",
                            render: (value: boolean | undefined, item) => <Switch checked={value ?? item.enabled} disabled={!item.enabled} checkedChildren="启用" unCheckedChildren="禁用" onChange={(checked) => void updatePermission(item.id, checked)} />,
                        },
                    ]}
                    locale={{ emptyText: "暂无全局模型" }}
                />
            </Spin>
        </Drawer>
    );
}
