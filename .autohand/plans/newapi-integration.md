# NewAPI 集成改造计划

## 目标

将 NewAPI 作为 Infinite Canvas 的唯一身份认证和模型服务来源：

- 移除注册流程，登录由 Infinite Canvas 服务端中转到 NewAPI。
- 浏览器只持有 Infinite Canvas 自己的登录态。
- NewAPI 的密码、Session/Cookie、Token Key 只由服务端处理。
- `ai_models` 由 Infinite Canvas 服务端自行维护。
- 四类模型列表统一由 Infinite Canvas 服务端返回。
- 禁止浏览器直连 NewAPI、其他 OpenAI 兼容接口或本地模型。

## 重要约束

- NewAPI 登录接口接收原始密码，必须通过 HTTPS 传输。
- NewAPI 数据库中的用户密码是单向哈希，无法用于重新登录。
- 为支持 Session 失效后的自动恢复，Infinite Canvas 必须保存用户密码的服务端可逆加密副本，不能只保存哈希，也不能保存明文。
- NewAPI Session/Cookie 按用户保存并优先复用，失效后使用加密密码重新登录并覆盖旧值。
- Token Key 按可恢复凭据保存；当前方案使用服务端加密保存，绝不返回浏览器或写入日志。
- 每个用户只保留一份当前 NewAPI Session/Cookie。
- Token 必须有启用/禁用状态，模型请求前检查状态。
- 工作区已有未提交修改，不回滚或覆盖无关改动。

## 数据库设计

### users

只保存 Infinite Canvas 用户基础信息和 NewAPI 身份映射：

```text
id
newapi_user_id          唯一索引
username                NewAPI 用户名
display_name
avatar_url              可选
status
last_login_at
created_at
updated_at
```

不保存密码、Session/Cookie 或 Token Key。

### user_newapi_credentials

每个用户一条 NewAPI 凭据与会话记录：

```text
id
user_id                         唯一索引，关联 users.id
newapi_username
password_ciphertext             可逆加密后的密码
password_nonce
password_version
session_cookie_ciphertext       可逆加密后的 Session/Cookie
session_cookie_nonce
session_expires_at
reauth_required                 密码失效后设为 true
last_sync_at
last_error                      仅保存脱敏错误摘要
created_at
updated_at
```

加密主密钥通过环境变量提供，例如 `USER_CREDENTIAL_ENCRYPTION_KEY`。密码、Cookie、Token Key 不得出现在 API 响应、普通日志、错误日志或审计日志中。

### user_newapi_tokens

一个用户可拥有多个 NewAPI Token，但最多一个默认 Token：

```text
id
user_id
newapi_token_id                 用户维度唯一
name
token_key                      完整 Token Key，服务端加密保存
is_enabled                      Token 是否允许使用
is_default
expired_at
last_synced_at
created_at
updated_at
```

约束：

- 每个用户最多一个 `is_default = true`。
- 模型请求前检查 `is_enabled` 和过期状态。
- `token_key` 不返回前端、不写日志。
- 手动刷新后以 NewAPI 实际状态覆盖本地记录。

### ai_models

由 Infinite Canvas 服务端自行维护的四类模型目录：

```text
id
model_id                        唯一，例如 gpt-4.1
display_name
model_type                      text / image / video / audio
provider                        可选，默认 newapi
enabled
sort_order
capabilities                    JSON，可选
created_at
updated_at
```

第一阶段不自动同步 NewAPI 全局模型列表，由管理员或数据库初始化维护。

### user_ai_models

保存用户可访问的模型权限：

```text
id
user_id
ai_model_id
is_enabled
created_at
updated_at
```

模型请求必须同时通过以下检查：用户有效、Token 启用、模型全局启用、用户模型权限启用。

## 认证流程

### 首次登录

```text
浏览器提交 username + password
        -> Infinite Canvas 服务端登录 NewAPI
        -> 保存 NewAPI 用户 ID、用户名、显示信息
        -> 加密保存密码
        -> 加密保存 NewAPI Session/Cookie
        -> 同步用户 Token、Token 状态和模型权限
        -> 签发 Infinite Canvas JWT
        -> 浏览器只接收 Infinite Canvas 登录态
```

### 日常请求

```text
浏览器 -> Infinite Canvas API
        -> 验证 Infinite Canvas JWT
        -> 查询当前用户默认 Token
        -> 检查 Token 是否启用
        -> 检查模型全局状态和用户权限
        -> 服务端使用 Token Key 请求 NewAPI
        -> 返回结果
```

### Session 失效恢复

1. 请求 NewAPI 时优先携带已保存的 Session/Cookie。
2. NewAPI 返回未授权或 Session 失效时，使用加密密码重新登录。
3. 登录成功后覆盖旧 Session/Cookie。
4. 仅重试当前操作一次，避免无限重试。
5. 密码失效时设置 `reauth_required = true`，要求用户重新输入 NewAPI 密码。
6. 不在每次模型请求前重新登录，避免产生多余 NewAPI Session。

### 退出登录

退出登录只清理 Infinite Canvas JWT。是否注销 NewAPI 取决于 NewAPI 是否提供可靠的会话注销接口；本地保存的 NewAPI Session/Cookie 不因普通退出而删除，以便后续复用。

## 后端接口

### 认证

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

移除前端注册入口和 `/api/auth/register` 的使用，后端注册接口停用。

### 模型目录

优先采用聚合接口：

```text
GET /api/models
```

响应按能力分类：

```json
{
  "code": 0,
  "data": {
    "text": [
      { "id": "gpt-4.1", "name": "GPT-4.1" }
    ],
    "image": [],
    "video": [],
    "audio": []
  },
  "msg": ""
}
```

如前端实际需要，也可以提供以下类型接口，内部复用同一模型查询服务：

```text
GET /api/models/text
GET /api/models/image
GET /api/models/video
GET /api/models/audio
```

接口只返回当前用户有权限且服务端启用的模型，不返回任何凭据或 NewAPI 地址。

### 同步与 Token 状态

```text
POST /api/account/newapi/sync
GET  /api/account/newapi/token/status
POST /api/account/newapi/token/refresh
```

第一阶段只实现登录同步和手动刷新同步，暂不实现定时同步。

同步内容：

- NewAPI 用户信息、额度、分组等必要状态。
- 用户 Token 列表、Token ID、Token 状态、默认 Token。
- 用户模型权限。
- `last_sync_at` 和脱敏错误状态。

Token 状态接口只能返回安全状态，例如 `tokenId`、`enabled`、`updatedAt`，不能返回 `token_key`。

## AI 服务端代理

前端不再读取或保存 `baseUrl`、`apiKey`、`localChannels`、本地模型列表或自定义模型地址。

建议统一提供：

```text
POST /api/ai/chat/completions
POST /api/ai/images/generations
POST /api/ai/videos/generations
POST /api/ai/audio/speech
```

后端按以下顺序处理：

1. 验证 Infinite Canvas JWT。
2. 获取用户默认 Token。
3. 校验 Token 启用状态和有效期。
4. 校验目标模型的全局状态和用户权限。
5. 解密 Token Key。
6. 服务端请求 NewAPI Relay 接口。
7. 将普通响应或流式响应返回浏览器。

## NewAPI Client

新增统一的服务端 NewAPI Client，集中负责：

- 用户名密码登录。
- Session/Cookie 保存、携带和更新。
- 用户信息查询。
- 用户 Token 查询和状态同步。
- Token Key 刷新。
- NewAPI Relay 模型请求。
- 认证失效检测和一次性重新登录重试。

Handler 只负责 HTTP 入参和响应，业务流程放在 service，NewAPI HTTP 访问集中在 client/service 层。

## 前端改造

- 删除注册入口、注册页跳转和注册 API 调用。
- 登录表单只提交到 Infinite Canvas `/api/auth/login`。
- 删除本地模型、Base URL、API Key 和渠道配置。
- 四类模型选择器统一调用 `/api/models` 或对应类型接口。
- 所有模型请求改为调用 Infinite Canvas `/api/ai/...`。
- Token 页面只展示启用状态、Token ID、同步时间等安全信息。
- `reauth_required` 时提供重新输入 NewAPI 密码的操作。
- 不在浏览器 Cookie、localStorage、IndexedDB 或日志中保存 NewAPI 密码、Session/Cookie、Token Key。

## 实施顺序

1. 定义五张 GORM Model，并更新数据库文档。
2. 增加凭据加密工具和环境配置。
3. 实现 NewAPI Client：登录、Session 复用、重新登录、Token 查询和刷新。
4. 改造登录流程，签发 Infinite Canvas JWT。
5. 停用注册接口并移除前端注册入口。
6. 实现登录同步和手动刷新同步。
7. 实现服务端维护的 `ai_models` 与用户模型权限接口。
8. 将 AI 请求改为服务端 NewAPI Relay 代理。
9. 清除前端本地模型和 API Key 配置。
10. 补充认证失效、Token 禁用、无权限模型和重新认证测试。

## 验收标准

- 浏览器无法获取 NewAPI 密码、Session/Cookie、Token Key 或服务地址。
- 前端无注册入口，不能调用本地注册接口。
- 用户可以使用 NewAPI 账号登录 Infinite Canvas。
- Session 有效时不会重复登录 NewAPI。
- Session 失效后可使用加密密码自动恢复一次。
- 密码失效后设置 `reauth_required` 并提示重新认证。
- 禁用或过期 Token 无法发起模型请求。
- 四类模型列表完全由 Infinite Canvas 服务端返回。
- `ai_models` 不依赖前端本地配置，模型请求不能绕过服务端直连 NewAPI。
