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
