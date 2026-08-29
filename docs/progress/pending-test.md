---
title: 待测试
description: 当前版本已实现但仍需人工验证的变更项
---

# 待测试

## PostgreSQL 专用构建

- SQLite 和 MySQL 驱动已从后端构建依赖中移除。
- 验证 `go build -o infinite-canvas-server .` 可以完成编译。
- 配置 PostgreSQL `STORAGE_DRIVER` 和 `DATABASE_DSN` 后启动服务。
- 验证数据库自动建库、`AutoMigrate` 和 `/api/health`。


## Manage 模型与 NewAPI Token 管理

- `/admin/users` 的用户详情可查看同步 Token 元数据、全局模型和用户模型启用状态。
- `/admin/models` 支持全局模型新增、编辑、启停、排序和删除。
- 需要使用管理员账号验证 Token 元数据不包含明文 TokenKey，并验证用户模型权限开关对 `/api/models` 查询结果的影响。


## NewAPI 用户同步

- 登录用户可调用 `POST /api/auth/newapi/sync` 手动刷新 NewAPI Session 和 Token 元数据。
- Session 失效时，服务端使用加密密码自动重新登录并更新 Session；失败会记录重新认证状态。
- 同步接口只返回用户名、Token 数量、同步时间和错误状态，不返回密码、Cookie 或 TokenKey。
