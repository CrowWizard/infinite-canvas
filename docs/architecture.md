# 无限画布项目架构说明

## 一、项目定位

`infinite-canvas` 是一个“无限画布 + AI 图片/视频/音频生成 + 素材库 + 提示词库 + 创作工作流”的全栈应用。

核心特征：

- 前端负责画布交互、节点编排、本地数据持久化和部分 AI 直连。
- Go 后端负责认证、业务 API、数据库、后台 AI 渠道、任务持久化和对象存储。
- 画布项目以完整 JSON 保存，不拆分节点表。
- 图片、视频、音频生成任务使用独立任务表，支持刷新页面和关闭浏览器后恢复。
- 未登录用户主要使用浏览器本地存储。
- 登录用户可将画布、素材、配置和生成记录同步到服务器。
- Docker 运行时由 Next.js 对外提供页面，并代理 `/api/*` 到内部 Go 服务。

## 二、整体系统结构

```text
+------------------------------------------------------------+
|                         浏览器客户端                       |
|                                                            |
|  Next.js App Router                                       |
|  React + TypeScript                                       |
|  Ant Design + Tailwind + lucide-react                    |
|                                                            |
|  +---------------+  +---------------+  +----------------+ |
|  | 无限画布       |  | 图片/视频工作台 |  | 提示词/素材库    | |
|  | Canvas         |  | Image/Video   |  | Prompts/Assets | |
|  +-------+-------+  +-------+-------+  +-------+--------+ |
|          |                  |                  |          |
|  +-------v----------------------------------------------+ |
|  | Zustand Store                                         | |
|  | 用户、主题、系统配置、素材、画布内部 Store             | |
|  +-----------------------+------------------------------+ |
|                          |                                 |
|  +-----------------------v------------------------------+ |
|  | services/api                                          | |
|  | API 请求、认证 Token、任务轮询、数据同步                 | |
|  +---------------+---------------------+----------------+ |
|                  |                     |                  |
|       本地直连 AI |                     | 同源 /api 请求   |
|                  |                     |                  |
|  +---------------v-----+      +--------v---------------+ |
|  | OpenAI 兼容服务       |      | Next.js API Proxy       | |
|  | 用户浏览器直接调用     |      | /api/[...path]          | |
|  +----------------------+      +------------+------------+ |
+---------------------------------------------|--------------+
                                              |
                                    Docker 内部网络
                                              |
+---------------------------------------------v--------------+
|                         Go 后端                            |
|                                                            |
|  Gin Router                                                |
|      |                                                     |
|  Middleware                                                |
|      |                                                     |
|  Handler                                                   |
|      |                                                     |
|  Service                                                   |
|      +-- AI 渠道适配                                       |
|      +-- 认证和用户                                        |
|      +-- 画布和任务                                        |
|      +-- 文件和对象存储                                    |
|      +-- 提示词和工作流                                    |
|      +-- 定时任务                                          |
|      |                                                     |
|  Repository                                                |
|      |                                                     |
|  GORM                                                      |
|      |                                                     |
|  PostgreSQL                                                |
|                                                            |
|  外部依赖：OpenAI、Gemini、Grok、MiniMax、KIE、APIMart、     |
|           MiMo、火山方舟 Agent Plan、S3/R2、WebDAV、Linux.do|
+------------------------------------------------------------+
```

## 三、目录结构

```text
infinite-canvas/
├── main.go                  Go 服务启动入口
├── config/                  环境变量和运行配置
├── router/                  Gin 路由注册
├── middleware/              登录、管理员、匿名存储鉴权
├── handler/                 HTTP 参数解析和响应封装
├── service/                 核心业务逻辑和第三方适配
├── repository/              GORM 数据访问层
├── model/                   数据模型、枚举、查询结构
├── web/                     Next.js 前端
│   ├── src/app/             页面和 App Router 路由
│   ├── src/components/      通用业务组件
│   ├── src/services/api/    API 请求模块
│   ├── src/stores/          Zustand 全局状态
│   ├── src/hooks/           公共 Hook
│   ├── src/lib/             AI、媒体、画布辅助逻辑
│   └── public/              logo、图标、3D 模型和静态资源
├── docs/                    功能、数据库、部署和操作文档
├── Dockerfile               前后端多阶段构建
├── docker-entrypoint.sh     容器内同时启动 Go 和 Next.js
├── docker-compose.yml        生产镜像运行方式
└── docker-compose.local.yml  本地源码构建方式
```

## 四、启动流程

`main.go` 的启动顺序如下：

```text
config.Load()
    ↓
service.EnsureDefaultAdmin()
    ↓
service.StartPromptSyncScheduler()
    ↓
service.StartCanvasProjectCleanupScheduler()
    ↓
handler.StartVideoTaskPoller()
    ↓
router.New().Run()
```

启动时会：

1. 加载 `.env` 和环境变量。
2. 生成或读取 JWT Secret。
3. 根据环境变量创建默认管理员。
4. 启动提示词远程同步任务。
5. 启动画布项目软删除清理任务。
6. 启动视频任务后台轮询器。
7. 监听 `PORT`，后端默认端口为 `8080`。

### Docker 启动

```text
docker-entrypoint.sh
├── PORT=8080 /app/server
└── PORT=3000 node /app/web/server.js
```

容器只对外暴露 `3000`：

```text
浏览器 → Next.js :3000
             ├── 页面请求由 Next.js 处理
             └── /api/* 代理到 Go :8080
```

## 五、后端分层与模块关系

```text
HTTP 请求
   ↓
router/
   ↓
middleware/
   ↓
handler/
   ├── 解析 JSON、表单、multipart、URL 参数
   ├── 从 Context 获取用户
   ├── 调用 service
   └── 返回 OK / Fail
        ↓
service/
   ├── 参数校验和默认值处理
   ├── 权限判断
   ├── 业务流程编排
   ├── AI 和存储服务调用
   ├── 任务状态转换
   └── 调用 repository
        ↓
repository/
   ├── 创建、查询、更新、删除
   ├── GORM 条件和分页
   └── 数据库事务/查询封装
        ↓
model/
   ├── 数据表结构
   ├── 枚举
   ├── Query 分页结构
   └── 简单模型方法
```

职责边界：

- `handler` 只处理 HTTP 入参、调用 service 和返回响应。
- `service` 处理业务逻辑、校验、鉴权、默认值、时间和第三方服务调用。
- `repository` 只负责数据库访问和 GORM 查询。
- `model` 定义数据结构、枚举和简单模型方法。

## 六、鉴权体系

### 普通用户鉴权

请求通过以下 Header 传递 JWT：

```text
Authorization: Bearer <JWT>
```

流程：

```text
Authorization Header
  ↓
middleware.authUser
  ↓
service.CurrentAuthUser
  ↓
service.WithUser 写入 Request Context
  ↓
handler/service 获取当前用户
```

### 三类中间件

```text
OptionalAuth
└── 有 Token 时注入用户，无 Token 时继续访问

UserAuth
└── 要求已登录且不是 guest

AdminAuth
└── 要求 user.Role == admin
```

### 匿名存储

匿名文件使用 HttpOnly Cookie：

```text
infinite_canvas_anonymous_storage
```

Cookie 内部也是 JWT，subject 采用 `anonymous-<uuid>` 格式。匿名用户不能调用普通用户业务接口，只能访问匿名文件存储相关能力。

## 七、主要后端业务模块

### 1. 认证和用户

相关模块：

```text
handler/auth.go
service/auth.go
repository/user.go
model/user.go
middleware/admin.go
```

支持：

- 用户注册和用户名密码登录。
- JWT 会话和当前用户查询。
- 默认管理员初始化。
- Linux.do OAuth 登录。
- 用户角色、状态和禁用控制。
- 邀请关系、算力点余额和算力点日志。

### 2. 系统配置和模型渠道

相关模块：

```text
handler/settings.go
service/settings.go
repository/setting.go
model/setting.go
```

系统设置分为 `public` 和 `private` 两类：

- `public`：模型列表、默认模型、模型算力消耗、登录开关等前端可见配置。
- `private`：API Key、渠道 Base URL、OAuth Secret、对象存储密钥、提示词同步配置等后端私有配置。

支持的 AI 渠道协议包括：

```text
OpenAI、Gemini、Grok2API、MiniMax、APIMart、KIE、MiMo、火山方舟 Agent Plan
```

同一个模型存在多个渠道时，service 根据渠道权重选择渠道。

### 3. AI 图片、视频和音频

主要模块：

```text
handler/ai.go
handler/ai_direct_request.go
handler/apimart_image.go
handler/apimart_video.go
handler/kie_image.go
handler/kie_video.go
handler/mimo_audio.go
handler/minimax_video.go
service/gemini.go
service/minimax.go
service/mimo_tts.go
```

支持：

- 文生图、图生图和参考图编辑。
- 文本问答、带图问答和流式响应。
- 语音合成。
- 视频生成和异步任务查询。
- URL、Base64 和多图片结果解析。
- 多模型、多渠道和算力点计费。

AI 调用有两种模式：

```text
本地直连：浏览器 → 用户配置的 OpenAI 兼容接口
后台渠道：浏览器 → Go API → 渠道选择 → 第三方 AI 平台
```

本地直连模式的 API Key 保存在浏览器本地，不经过项目后端。

### 4. 画布

相关模块：

```text
handler/canvas_project.go
handler/canvas_task.go
service/canvas_project.go
service/canvas_image_task.go
service/canvas_audio_task.go
repository/canvas_project.go
repository/canvas_image_task.go
repository/canvas_audio_task.go
web/src/app/(user)/canvas/
```

画布项目保存为完整 JSON：

```text
CanvasProject
├── id
├── title
├── createdAt
├── updatedAt
├── nodes[]
├── connections[]
├── chatSessions[]
├── activeChatId
├── backgroundMode
└── viewport
```

支持：

- 拖动、缩放、小地图和多种背景。
- 节点框选、多选、复制、粘贴和删除。
- 节点连线以及上下游高亮。
- 撤销/重做节点、连线、视口、背景和助手会话。
- 图片、视频、音频、文本、图片组和导演台节点。
- 项目导入、导出、重命名、删除和批量删除。

### 5. 任务系统

异步任务单独存储在：

```text
canvas_image_tasks
canvas_audio_tasks
video_tasks
```

画布 JSON 负责保存画布状态，任务表负责保存运行态任务和错误信息。这样可以让任务跨越页面刷新、浏览器关闭和多设备访问继续运行或恢复。

### 6. 存储和媒体

相关模块：

```text
handler/storage.go
handler/media_reference.go
service/storage.go
service/webdav_storage.go
repository/storage.go
model/storage.go
web/src/services/file-storage.ts
web/src/services/image-storage.ts
web/src/services/webdav-direct-storage.ts
```

支持：

- 浏览器 IndexedDB。
- S3 兼容对象存储和 Cloudflare R2。
- WebDAV。
- 服务器数据库中的媒体索引。

画布节点不直接保存大体积文件，而是保存：

```text
storageKey
mimeType
bytes
naturalWidth
naturalHeight
```

`storageKey` 指向浏览器 Blob 或服务器对象存储。数据库中的 `storage_objects` 只保存文件索引、Provider、Object Key、URL、MIME、大小、哈希和用户信息。

### 7. 提示词

相关模块：

```text
handler/prompts.go
service/prompts.go
service/prompt_fetch.go
service/prompt_sync_scheduler.go
repository/prompt.go
model/prompt.go
```

功能：

- 提示词查询、搜索、分类和标签筛选。
- 管理员增删改。
- 从 GitHub 仓库同步提示词。
- 保存 Markdown 预览。
- 在图片生成、画布助手和工作流中复用。

### 8. 创作工作流

相关模块：

```text
handler/workflow.go
service/workflow.go
service/workflow_agent.go
repository/workflow.go
model/workflow.go
web/src/app/(user)/workflows/
web/src/components/workflows/
```

支持公开工作流、用户工作流、变量、步骤、参考图输入和 AI 自动草拟。

AI 草拟流程：

```text
用户描述创作目标
  ↓
选择参考图
  ↓
调用 workflow_agent
  ↓
解析 AI JSON
  ↓
规范化变量和步骤
  ↓
生成工作流草稿
  ↓
用户确认后保存
```

## 八、数据库

### 数据库技术

后端使用 GORM 统一访问数据库，并在启动时执行 `AutoMigrate`。

支持的驱动：

```text
SQLite
MySQL
PostgreSQL
```

### 主要数据表

```text
users
├── 用户账号、角色、密码哈希、算力点
├── 邀请关系
├── GitHub / Linux.do / 微信标识
└── 用户状态和登录时间

credit_logs              算力点变更记录
user_configs             用户模型、存储和同步配置
settings                 public/private 系统配置
prompts                  提示词、分类、标签和预览
assets                   后台服务器素材库
storage_objects          S3/R2/WebDAV 文件索引
canvas_projects          完整画布项目 JSON
canvas_image_tasks       画布图片异步任务
canvas_audio_tasks       画布音频异步任务
video_tasks              视频生成运行态任务
video_generation_logs    视频生成历史
image_generation_logs    图片生成历史
a i_call_logs             后端 AI 调用日志
creative_workflows       创作工作流模板
```

> 实际表名和字段以 `model/` 下模型定义及 `docs/backend/backend-database.md` 为准。

### 数据隔离

用户数据通过 JWT 中的用户身份和数据库中的 `user_id` 隔离：

```text
JWT
  ↓
user_id
  ↓
service
  ↓
repository WHERE user_id = ?
```

画布项目逻辑上使用 `(user_id, id)` 定位。

### 软删除和清理

部分历史记录和画布项目采用软删除或延迟清理，避免旧浏览器缓存重新同步时恢复已删除数据。画布项目由后台清理任务删除过期记录。

## 九、前端模块

### 页面路由

```text
web/src/app/
├── (user)/
│   ├── page.tsx             首页
│   ├── login/               登录
│   ├── canvas/              无限画布和导演台
│   ├── image/               图片生成工作台
│   ├── video/               视频生成工作台
│   ├── prompts/             前台提示词库
│   ├── assets/              我的素材
│   ├── asset-library/       服务器素材库
│   └── workflows/           创作工作流
│
├── (admin)/admin/
│   ├── users/               用户管理
│   ├── settings/            系统设置
│   ├── prompts/             提示词管理
│   ├── assets/              素材管理
│   ├── ai-logs/             AI 日志
│   └── credit-logs/         算力点日志
│
└── api/[...path]/            Next.js API 代理
```

### Zustand 状态

```text
use-user-store
└── 登录用户、Token、登录和注册状态

use-theme-store
└── 浅色/深色主题

use-config-store
└── 系统设置、模型、渠道和用户配置

use-asset-store
└── 我的素材、本地素材同步和清理

canvas stores
└── 节点、连线、视口、选择、撤销重做、助手和任务
```

### 浏览器本地存储

使用 `localforage` 管理 IndexedDB：

```text
infinite-canvas / app_state
├── infinite-canvas:canvas_store
└── infinite-canvas:asset_store

infinite-canvas / image_files
└── 图片 Blob

infinite-canvas / media_files
└── 视频和音频 Blob

infinite-canvas / image_generation_logs
└── 本地图片历史

infinite-canvas / video_generation_logs
└── 本地视频历史
```

删除画布、素材或助手会话时，清理逻辑会收集所有仍被引用的 `storageKey`，只删除未被任何对象引用的 Blob，避免误删共享媒体。

## 十、典型业务流程

### 1. 打开应用

```text
浏览器访问 :3000
  ↓
Next.js 返回页面
  ↓
client-root-init 初始化客户端状态
  ↓
请求 /api/settings
  ↓
Next.js 代理到 Go /api/settings
  ↓
读取 public settings
  ↓
初始化模型、登录开关和主题
  ↓
请求 /api/auth/me
  ↓
恢复登录用户或访客状态
```

### 2. 登录和数据同步

```text
用户登录
  ↓
获得 JWT
  ↓
保存 Token
  ↓
读取本地 IndexedDB
  ↓
读取服务器画布、素材和用户配置
  ↓
按 updatedAt 合并
  ↓
本地与服务器持续同步
```

### 3. 画布生成图片

```text
选择生成节点
  ↓
读取节点配置和上游节点
  ↓
整理 prompt、参考图和模型参数
  ↓
调用 /api/v1/images/generations
  ↓
后端校验用户身份
  ↓
选择模型渠道并处理算力点
  ↓
调用第三方 AI
  ↓
解析 URL / Base64 / 多图结果
  ↓
保存 Blob 或上传对象存储
  ↓
创建图片节点/图片组节点
  ↓
保存画布项目
```

### 4. 视频生成

```text
发起视频请求
  ↓
准备 prompt 和参考媒体
  ↓
上传必要的参考文件
  ↓
创建第三方视频任务
  ↓
写入 video_tasks
  ↓
后端轮询未完成任务
  ↓
更新 queued / processing / completed / failed
  ↓
前端获取状态
  ↓
保存视频媒体和生成历史
  ↓
创建画布视频节点
```

### 5. 提示词同步

```text
管理员开启同步
  ↓
保存 private.promptSync
  ↓
Cron 定时执行
  ↓
抓取 GitHub 仓库
  ↓
解析提示词
  ↓
写入 prompts
  ↓
前台通过 /api/prompts 查询
```

## 十一、接口清单

### 公共接口

```text
GET  /api/health
GET  /api/settings
GET  /api/storage/config
GET  /api/prompts
GET  /api/assets
GET  /api/files/:id
GET  /api/files/:id/content
GET  /api/media/references/:id
GET  /api/proxy-image

POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
GET  /api/auth/linux-do/authorize
GET  /api/auth/linux-do/callback
POST /api/admin/login
```

### 用户 AI 接口

```text
POST /api/v1/images/generations
POST /api/v1/images/edits
POST /api/v1/responses
POST /api/v1/chat/completions
POST /api/v1/audio/speech
GET  /api/v1/tts/voices

POST /api/v1/videos
GET  /api/v1/videos/:id
GET  /api/v1/videos/:id/content
GET  /api/v1/video-tasks
DELETE /api/v1/video-tasks/:id
```

### 用户画布接口

```text
GET  /api/v1/canvas/projects
POST /api/v1/canvas/projects
POST /api/v1/canvas/projects/sync
POST /api/v1/canvas/projects/delete
POST /api/v1/canvas/tasks/delete

POST /api/v1/canvas/image-tasks
GET  /api/v1/canvas/image-tasks
GET  /api/v1/canvas/image-tasks/:id
POST /api/v1/canvas/image-tasks/status
DELETE /api/v1/canvas/image-tasks/:id

POST /api/v1/canvas/audio-tasks
GET  /api/v1/canvas/audio-tasks/:id
```

### 用户数据、存储和工作流接口

```text
GET  /api/v1/user-config
POST /api/v1/user-config/model
POST /api/v1/user-config/storage

POST /api/v1/files
POST /api/v1/files/direct
DELETE /api/v1/files/:id
DELETE /api/v1/files/:id/record
POST /api/v1/media/references
POST /api/v1/storage/measure

GET  /api/v1/user-data/image-history
POST /api/v1/user-data/image-history
GET  /api/v1/user-data/assets
POST /api/v1/user-data/assets

GET    /api/v1/workflows
POST   /api/v1/workflows
POST   /api/v1/workflows/agent-draft
DELETE /api/v1/workflows/:id
```

### 生成历史接口

```text
GET    /api/v1/generation-logs/images
POST   /api/v1/generation-logs/images
POST   /api/v1/generation-logs/images/delete
DELETE /api/v1/generation-logs/images/:id

GET    /api/v1/generation-logs/videos
POST   /api/v1/generation-logs/videos
POST   /api/v1/generation-logs/videos/delete
DELETE /api/v1/generation-logs/videos/:id

POST /api/v1/ai-logs
```

### 管理员接口

```text
GET/POST    /api/admin/users
POST        /api/admin/users/:id/credits
DELETE      /api/admin/users/:id
GET/POST    /api/admin/credit-logs
DELETE      /api/admin/credit-logs/:id
GET/DELETE  /api/admin/ai-logs

GET/POST    /api/admin/settings
POST        /api/admin/settings/channel-models
POST        /api/admin/settings/channel-test
POST        /api/admin/storage/measure

GET         /api/admin/prompt-categories
POST        /api/admin/prompt-categories/sync
POST        /api/admin/prompt-categories/sync-all
GET/POST    /api/admin/prompts
POST        /api/admin/prompts/batch-delete
DELETE      /api/admin/prompts/:id

GET/POST    /api/admin/assets
DELETE      /api/admin/assets/:id
```

所有业务接口统一返回：

```json
{
  "code": 0,
  "data": {},
  "msg": "ok"
}
```

`code = 0` 表示成功，非 `0` 表示失败。业务失败通常仍返回 HTTP 200，前端应优先通过 `code` 判断业务结果。

## 十二、技术栈

### 后端

```text
Go 1.25
Gin 1.11
GORM 1.31
PostgreSQL
JWT v5
golang.org/x/crypto
Cron v3
gowebdav
godotenv
caarlos0/env
```

后端采用 REST API、JSON/multipart 请求、JWT Bearer Token、GORM AutoMigrate、后台 goroutine 轮询任务和 Cron 定时任务。

### 前端

```text
Next.js 16
React 19
TypeScript 5
Tailwind CSS 4
Ant Design 6
Zustand 5
TanStack React Query 5
Axios
localforage
lucide-react
Motion
React Markdown
CodeMirror
Photo Sphere Viewer
```

### 3D 导演台

前端还包含：

- GLB 3D 模型。
- 导演台场景、摄像机、角色和时间轴。
- 全景图环境背景。
- 关键帧和动画曲线。
- 视频导出与截图回传画布。

### 部署

```text
Docker 多阶段构建
├── Bun 构建 Next.js
├── Go 编译后端
└── Node 运行 Next.js standalone
```

## 十三、当前限制和注意事项

1. 画布项目采用单行 JSON，开发和同步简单，但不适合数据库级别的节点查询。
2. 生成任务单独建表，保证任务不随页面生命周期结束。
3. 生成历史采用完整 `payload_json`，便于恢复，但不适合对历史内部字段进行复杂查询。
4. `storageKey` 将画布节点与 Blob/对象存储解耦，避免大文件进入画布 JSON。
5. 本地直连模式下 API Key 位于浏览器本地，不是服务端密钥托管方案。
6. Seedance 参考媒体依赖 `PUBLIC_BASE_URL`，火山服务必须能够访问该地址。
7. 服务器素材库目前主要保存 URL 或文本，尚不是完整的文件上传资产系统。
8. 画布和导演台更适合桌面端，移动端触控体验仍有限。
9. 数据库使用 GORM `AutoMigrate`，当前没有承诺历史数据库结构兼容。
10. Docker 静态资源路径仍属于待验证事项，不能认为所有生产部署场景都已完全验证。
