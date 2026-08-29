"use client";

import { App, Card, Select, Spin, Switch, Table, Tag, Typography } from "antd";
import { useEffect, useState } from "react";

import { fetchAdminUserModels, fetchAdminUsers, saveAdminUserModel, type AdminUser, type AdminUserModelData } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

export default function AdminUserModelsPage() {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [userId, setUserId] = useState<string>();
    const [data, setData] = useState<AdminUserModelData>();
    const [loading, setLoading] = useState(false);

    const loadData = async (id: string) => {
        if (!token) return;
        setLoading(true);
        try {
            setData(await fetchAdminUserModels(token, id));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载用户模型失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!token) return;
        void fetchAdminUsers(token, { pageSize: 100 })
            .then((result) => setUsers(result.items))
            .catch((error) => message.error(error instanceof Error ? error.message : "加载用户失败"));
    }, [message, token]);

    useEffect(() => {
        if (userId) void loadData(userId);
        else setData(undefined);
    }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

    const updatePermission = async (modelId: string, enabled: boolean) => {
        if (!token || !userId) return;
        try {
            await saveAdminUserModel(token, userId, modelId, enabled);
            await loadData(userId);
            message.success("模型权限已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新模型权限失败");
        }
    };

    return (
        <main style={{ padding: 24 }}>
            <Card
                title="用户模型权限"
                extra={
                    <Select
                        showSearch
                        allowClear
                        placeholder="选择用户"
                        style={{ width: 300 }}
                        optionFilterProp="label"
                        options={users.map((user) => ({ value: user.id, label: `${user.displayName || user.username} (${user.username})` }))}
                        onChange={setUserId}
                    />
                }
            >
                <Typography.Paragraph type="secondary">未设置用户权限时，模型跟随全局启用状态；设置后以用户权限为准。</Typography.Paragraph>
                <Spin spinning={loading}>
                    <Table
                        rowKey="id"
                        pagination={false}
                        dataSource={data?.models || []}
                        columns={[
                            { title: "模型", dataIndex: "displayName", render: (value: string, item) => value || item.modelId },
                            { title: "模型 ID", dataIndex: "modelId" },
                            { title: "类型", dataIndex: "modelType", render: (value: string) => <Tag>{value}</Tag> },
                            { title: "Provider", dataIndex: "provider", render: (value: string) => value || "-" },
                            { title: "全局状态", dataIndex: "enabled", render: (enabled: boolean) => <Tag color={enabled ? "success" : "default"}>{enabled ? "启用" : "禁用"}</Tag> },
                            {
                                title: "用户权限",
                                dataIndex: "userEnabled",
                                render: (enabled: boolean | undefined, item) => <Switch checked={enabled ?? item.enabled} checkedChildren="启用" unCheckedChildren="禁用" onChange={(checked) => void updatePermission(item.id, checked)} />,
                            },
                        ]}
                        locale={{ emptyText: userId ? "暂无全局模型" : "请先选择用户" }}
                    />
                </Spin>
            </Card>
        </main>
    );
}
