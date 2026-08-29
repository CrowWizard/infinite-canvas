"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Tag } from "antd";
import { useEffect, useState } from "react";

import { deleteAdminModel, fetchAdminModels, saveAdminModel, type AdminAIModel } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const emptyModel: Partial<AdminAIModel> = { modelType: "text", enabled: true, sortOrder: 0, capabilities: "{}" };

export default function AdminModelsPage() {
    const { message, modal } = App.useApp();
    const token = useUserStore((state) => state.token);
    const [models, setModels] = useState<AdminAIModel[]>([]);
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState<Partial<AdminAIModel> | null>(null);
    const [form] = Form.useForm<Partial<AdminAIModel>>();

    const load = async () => {
        setLoading(true);
        try {
            setModels(await fetchAdminModels(token));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载模型失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (token) void load();
    }, [token]);

    const save = async () => {
        const values = await form.validateFields();
        try {
            JSON.parse(values.capabilities || "{}");
        } catch {
            message.error("Capabilities 必须是有效 JSON");
            return;
        }
        try {
            await saveAdminModel(token, values);
            message.success("模型已保存");
            setEditing(null);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存模型失败");
        }
    };

    const columns: ProColumns<AdminAIModel>[] = [
        { title: "模型 ID", dataIndex: "modelId", copyable: true },
        { title: "显示名称", dataIndex: "displayName" },
        { title: "类型", dataIndex: "modelType", render: (_, item) => <Tag>{item.modelType}</Tag> },
        { title: "Provider", dataIndex: "provider" },
        { title: "排序", dataIndex: "sortOrder", width: 80 },
        { title: "状态", dataIndex: "enabled", render: (_, item) => <Switch checked={item.enabled} disabled size="small" /> },
        {
            title: "操作",
            valueType: "option",
            width: 130,
            render: (_, item) => [
                <Button
                    key="edit"
                    type="link"
                    icon={<EditOutlined />}
                    onClick={() => {
                        setEditing(item);
                        form.setFieldsValue(item);
                    }}
                >
                    编辑
                </Button>,
                <Button
                    key="delete"
                    type="link"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() =>
                        modal.confirm({
                            title: "删除模型",
                            content: `确定删除「${item.modelId}」吗？`,
                            okText: "删除",
                            cancelText: "取消",
                            okButtonProps: { danger: true },
                            onOk: async () => {
                                await deleteAdminModel(token, item.id);
                                await load();
                            },
                        })
                    }
                >
                    删除
                </Button>,
            ],
        },
    ];

    return (
        <main style={{ padding: 24 }}>
            <ProTable<AdminAIModel>
                rowKey="id"
                loading={loading}
                columns={columns}
                dataSource={models}
                search={false}
                headerTitle="全局模型"
                toolBarRender={() => [
                    <Button key="refresh" icon={<ReloadOutlined />} onClick={() => void load()}>
                        刷新
                    </Button>,
                    <Button
                        key="add"
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => {
                            setEditing(emptyModel);
                            form.setFieldsValue(emptyModel);
                        }}
                    >
                        新增模型
                    </Button>,
                ]}
            />
            <Modal title={editing?.id ? "编辑模型" : "新增模型"} open={!!editing} onCancel={() => setEditing(null)} onOk={() => void save()} okText="保存" cancelText="取消" destroyOnClose>
                <Form form={form} layout="vertical">
                    <Form.Item name="modelId" label="模型 ID" rules={[{ required: true, message: "请输入模型 ID" }]}>
                        <Input disabled={!!editing?.id} />
                    </Form.Item>
                    <Form.Item name="displayName" label="显示名称">
                        <Input />
                    </Form.Item>
                    <Form.Item name="modelType" label="模型类型" rules={[{ required: true }]}>
                        <Select
                            options={[
                                { value: "text", label: "文本" },
                                { value: "image", label: "图片" },
                                { value: "video", label: "视频" },
                                { value: "audio", label: "音频" },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item name="provider" label="Provider">
                        <Input />
                    </Form.Item>
                    <Space style={{ width: "100%" }} align="start">
                        <Form.Item name="sortOrder" label="排序">
                            <InputNumber min={0} />
                        </Form.Item>
                        <Form.Item name="enabled" label="启用" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    </Space>
                    <Form.Item name="capabilities" label="Capabilities JSON">
                        <Input.TextArea rows={5} placeholder='{"supportsImage":true}' />
                    </Form.Item>
                </Form>
            </Modal>
        </main>
    );
}
