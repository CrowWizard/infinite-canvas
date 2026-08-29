"use client";

import { App, Card, Select, Spin, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import { fetchAdminUserModels, fetchAdminUsers, type AdminUser, type AdminUserModelData } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

export default function AdminNewAPITokensPage() {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [userId, setUserId] = useState<string>();
    const [data, setData] = useState<AdminUserModelData>();
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!token) return;
        void fetchAdminUsers(token, { pageSize: 100 })
            .then((result) => setUsers(result.items))
            .catch((error) => message.error(error instanceof Error ? error.message : "加载用户失败"));
    }, [message, token]);

    useEffect(() => {
        if (!token || !userId) {
            setData(undefined);
            return;
        }
        setLoading(true);
        void fetchAdminUserModels(token, userId)
            .then(setData)
            .catch((error) => message.error(error instanceof Error ? error.message : "加载 Token 失败"))
            .finally(() => setLoading(false));
    }, [message, token, userId]);

    return (
        <main style={{ padding: 24 }}>
            <Card
                title="用户 NewAPI Token"
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
                <Typography.Paragraph type="secondary">仅展示同步状态和元数据，不会返回或显示 TokenKey。</Typography.Paragraph>
                <Spin spinning={loading}>
                    <Table
                        rowKey="tokenId"
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
                        locale={{ emptyText: userId ? "该用户暂无同步 Token" : "请先选择用户" }}
                    />
                </Spin>
            </Card>
        </main>
    );
}
