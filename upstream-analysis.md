# 上游更新分析

> 比较基线：当前项目 `57b13aa`（`feat(canvas): add video frame capture and prompt references`）
>
> 上游仓库：`tigerowo/infinite-canvas`
>
> 分析范围：上游在当前项目之后新增的 3 个提交。开源协议变更不在本文展开。

## 一、总体结论

当前项目位于 `57b13aa`。上游在此基础上连续多出 3 个提交，最新为 `9e60175`。

这 3 个提交不是 3 条孤立 Prompt，而是三个阶段的 Agent 能力升级：

1. `6bd8b27`：文本节点改为流式文本能力，新增分组树和消息复制。
2. `cd091cc`：新增完整 Agent Skill 系统、长上下文记忆、Chat/Responses 双接口和画布节点查询。
3. `9e60175`：新增媒体自动提交开关，修复图片参考节点遗漏和顺序问题。

真正大规模新增 Prompt 的是第 2 个提交。它一次性加入 7 个默认 Skill，并将 Skill 变成可以由用户选择、由 Agent 执行、由后台维护的工作流系统。

## 二、整体代码架构

更新后的 Agent 调用链：

```text
输入框
  -> 选择 Skill / 图片引用 / 节点引用
  -> CanvasAssistantPanel.sendMessage
  -> 构建 Agent 上下文、Skill 内容、历史消息
  -> canvas-agent-runtime.runCanvasAgent
  -> 选择 Chat 或 Responses 接口
  -> 模型返回文本或工具调用
  -> 执行画布工具
  -> 创建节点、来源连线、可选提交媒体任务
  -> 保存会话、Agent 状态、协议历史和长期检查点
```

后端 Skill 管理链路：

```text
前端 API
  -> router 路由
  -> handler 解析 HTTP 参数
  -> service 鉴权、校验、路径规范化
  -> repository 使用 GORM 查询或事务写入
  -> agent_skills / agent_skill_files 表
```

## 三、第一个提交：流式文本和画布元素树

提交：

- https://github.com/tigerowo/infinite-canvas/commit/6bd8b2721b25a60fa1e09df1d76aaf62b81c2c8c

### 1. 文本模型选择逻辑

涉及文件：

- `web/src/stores/use-config-store.ts`
- `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`
- `web/src/app/(user)/canvas/components/canvas-node-prompt-panel.tsx`

新增：

```ts
resolveModelForCapability(config, currentModel, "text")
```

它不会简单使用 `config.model`，而是按能力解析模型：

```text
节点显式模型
  -> 全局 textModel
  -> 当前渠道中支持 text 的第一个模型
  -> 默认 textModel
```

这样做是因为项目同时存在图片、视频、音频、文本多种模型。文本节点如果直接复用通用模型，可能选到图片模型或不支持文本对话的模型。

文本节点弹窗和画布页中的 `buildNodeConfig`、`buildGenerationConfig` 都改用这个函数，因此两个入口的模型选择规则一致。

### 2. 文本响应改成标准 Fetch 流读取

原逻辑在 `web/src/services/api/image.ts` 中使用 Axios：

```text
onDownloadProgress
  -> 读取 responseText
  -> 自己维护 processedLength
  -> 自己拼接 buffer
  -> 按 \\n\\n 拆 SSE
  -> 解析 data:
```

新逻辑改成：

```text
fetch /chat/completions
  -> withTimeout
  -> 判断是否 event-stream
  -> readJsonServerSentEvents
  -> 读取每个 delta
  -> answer += delta
  -> onDelta(answer)
```

关键点是 `onDelta` 传递的不是单个片段，而是当前完整答案：

```ts
answer += delta;
onDelta(answer);
```

前端每收到一段内容，就将文本节点的 `metadata.content` 更新为当前完整字符串。因此画布上可以边生成边看到正文。

同时兼容非流式响应：

```text
如果是 SSE：
  choices[0].delta.content

如果是普通 JSON：
  choices[0].message.content
  或 data.choices[0].message.content
```

这使得不支持流式输出的 OpenAI 兼容接口仍能返回完整文本。

### 3. 文本节点的显示逻辑

`canvas-node.tsx` 中原本：

```ts
status === "loading"
  -> 显示 LoadingContent
```

现在改成：

```ts
status === "loading" && 没有已有 content
  -> 显示 LoadingContent

status === "loading" && 已有 content
  -> 继续显示 TextContent
```

实际行为变成：

```text
开始生成
  -> 节点显示加载状态

收到第一段文本
  -> 节点立即显示文本

继续收到文本
  -> 正文实时增长

生成完成
  -> 保留最终正文
```

同时删除了：

- `editRequestNonce`
- `onEditText`
- 节点右上角固定“生图”按钮
- 单独的“编辑文字”悬浮按钮

文本编辑能力仍然存在，只是统一使用节点正文编辑和现有对话/编辑入口，不再额外提供重复入口。

### 4. 左侧元素列表变为分组树

文件：

```text
web/src/app/(user)/canvas/components/canvas-side-panel.tsx
```

原来是：

```ts
filtered.map(node => renderRow(node))
```

现在先生成 `treeRows`：

```text
filtered 节点
  -> 找出所有 Group
  -> 根据 node.metadata.groupId 分配子节点
  -> 顶层节点保持 depth=0
  -> 组内节点变成 depth=1
  -> collapsedGroups 决定是否展示子节点
```

过滤时有一个重要逻辑：

```text
如果组本身没有命中，但组内子节点命中
  -> 仍然显示组节点
```

这样搜索组内节点时不会丢失父级结构。

点击组的箭头只修改：

```ts
collapsedGroups: Set<string>
```

并不修改画布真实节点数据，只改变左侧列表展示状态。

### 5. 消息复制

`canvas-assistant-panel.tsx` 新增：

```ts
const copyText = useCopyText();
```

只要消息不是运行状态并且有正文，就显示复制按钮。

助手消息显示：

```text
复制 + 重试
```

用户消息显示：

```text
复制
```

复制内容是完整原始文本，而不是只复制当前可见的一小段 Markdown。

## 四、第二个提交：Agent Skill 系统前端逻辑

提交：

- https://github.com/tigerowo/infinite-canvas/commit/cd091ccb93b02c6d0e08a3a121393588827eb774

这是最重要的一次更新，约增加 6000 行代码，涉及前端、后端、数据库、Agent 协议和大量 Prompt 文件。

### 1. Skill 数据结构

前端新增：

```ts
type AgentSkill = {
    id: string;
    ownerUserId: string;
    source: "system" | "user";
    name: string;
    description: string;
    coverUrl: string;
    coverStorageKey: string;
    content: string;
    enabled: boolean;
    sort: number;
    hasFiles?: boolean;
    files?: AgentSkillFile[];
}
```

附属文件：

```ts
type AgentSkillFile = {
    path: string;
    kind: "folder" | "file";
    content: string;
    sort: number;
}
```

会话新增：

```ts
activeSkills?: CanvasAgentSkillSelection[];
contextCheckpoint?: string;
```

消息新增：

```ts
skills?: CanvasAgentSkillSelection[];
skillsSelected?: boolean;
```

这里把“当前会话使用哪些 Skill”和“某条用户消息是否主动选择了 Skill”区分开：

- `activeSkills`：会话级状态，后续消息可以继续使用。
- `message.skills`：消息级记录，用于历史显示和重试。
- `skillsSelected`：控制历史消息中是否显示 Skill 芯片，避免每条消息都重复展示相同 Skill。

### 2. Skill 选择器

新增：

```text
web/src/app/(user)/canvas/components/canvas-agent-skill-popover.tsx
```

界面有两个标签：

```text
通用 | 我的
```

对应：

```ts
systemSkills
userSkills
```

选择逻辑在 `CanvasAssistantPanel.selectComposerSkill`：

```text
同一个 id + source 已存在
  -> 更新该选择

当前选择数量 >= 5
  -> 提示最多选择 5 个

否则
  -> 添加到 selectedSkills
```

Skill 会显示在输入框内部，作为不可编辑的 Chip。用户按 Backspace/Delete 删除相邻 Chip 时，`CanvasPromptChipInput` 判断它是普通节点引用还是 Skill 引用；如果是 Skill，就调用：

```ts
onSkillRemove(id, source)
```

而不是把 Skill 名称写入实际 Prompt 文本。

### 3. Skill Store 的登录态分流

文件：

```text
web/src/stores/use-agent-skill-store.ts
```

加载逻辑：

```ts
const token = useUserStore.getState().token;
const key = token || "local";
```

如果已登录：

```text
系统 Skill -> GET /api/agent-skills
用户 Skill -> GET /api/v1/agent-skills
```

如果未登录：

```text
系统 Skill -> GET /api/agent-skills
用户 Skill -> localforage
```

本地 Skill 使用：

```ts
localforage.createInstance({
    name: "infinite-canvas",
    storeName: "agent_skills"
})
```

而不是 `localStorage`，因为 Skill 正文可能较长。

加载还做了两个优化：

```text
同一身份已加载过
  -> 直接复用缓存

已有加载请求正在进行
  -> 等待同一个 Promise
```

因此多个组件同时打开 Skill 列表时，不会重复请求。

后台修改系统 Skill 后调用：

```ts
invalidateAgentSkillCache()
```

将缓存身份清空，下次打开时重新获取最新数据。

### 4. Skill 根内容如何进入模型

发送消息时，`CanvasAssistantPanel.sendMessage` 执行：

```text
读取当前选择的 Skill
  -> 从 Store 中找最新版本
  -> 校验 Skill 仍然存在且 enabled=true
  -> 提取完整 content
  -> 传给 runCanvasAgent
```

如果选中的 Skill 已被管理员停用或删除，则拒绝发送并提示用户重新选择。

在 `buildCanvasAgentSkillPrompt` 中，内容结构大致是：

```text
内置 CORE_SKILL
内置 WORKFLOW_SKILL
按当前意图加载的其他内置 Skill
用户选择的 Skill 根内容
系统 Skill 附属文件读取规则
长期检查点
事实优先级
真实画布上下文 JSON
```

Skill 内容不会先交给另一个模型总结，而是直接拼入 system prompt。这样可以保留：

- 精确字段名。
- 流程顺序。
- 用户确认门。
- 负向约束。
- 失败恢复规则。
- Prompt 模板。
- 工具使用限制。

优先级明确为：

```text
工具真实结果 > 当前画布上下文 > Agent 状态 > 用户选择的 Skill > 长期检查点
```

因此 Skill 可以规定流程，但不能伪造画布节点或覆盖工具真实结果。

### 5. 附属文件按需读取

如果当前激活的系统 Skill 有附属文件，运行时才加入：

```ts
CANVAS_AGENT_SKILL_FILE_TOOL
```

工具参数：

```ts
{
    skillId: string;
    path: string;
}
```

执行时再次检查：

```text
skillId 是否属于当前激活 Skill
source 是否为 system
```

不满足时返回：

```json
{
  "ok": false,
  "code": "skill_not_active"
}
```

满足时调用：

```ts
fetchSystemAgentSkillFile(skillId, path)
```

因此模型不能随便读取任意系统 Skill 文件，只能读取当前会话已经激活的 Skill，并且根 `SKILL.md` 必须先告诉模型应该读取哪个路径。

## 五、第二个提交：Agent Runtime 关键逻辑

文件：

```text
web/src/app/(user)/canvas/agent/canvas-agent-runtime.ts
```

这是前端 Agent 的核心调度器。

### 1. 一轮 Agent 执行流程

`runCanvasAgent` 每轮最多执行 12 步：

```text
初始化 protocolMessages
追加当前用户消息
构造当前 Skill 内容
判断是否需要 read_skill_file
循环最多 12 次：
    获取真实画布上下文
    构造 system prompt
    估算上下文长度
    必要时压缩历史
    调用 Chat / Responses
    解析文本和工具调用
    过滤未被用户要求的 arrange_nodes
    执行工具
    把工具结果追加到协议历史
    保存 checkpoint
返回助手回复
```

### 2. 工具调用来源

模型可能通过两种方式返回工具操作：

```text
原生 Tool Calling
或
JSON fallback
```

代码先取：

```ts
nativeActions = turn.toolCalls
```

如果没有原生工具调用，再使用：

```ts
parsedJson.actions
```

这保持了对旧 JSON 输出模型的兼容。

### 3. 防止模型擅自整理画布

运行时判断用户原始输入是否包含：

```text
整理、排列、排序、对齐、布局、排版、重新摆放
```

如果用户没有请求整理，但模型返回 `arrange_nodes`，则不执行。

上游还会生成一个工具结果：

```json
{
  "ok": false,
  "code": "action_not_requested",
  "message": "用户没有要求整理画布，未执行节点排列"
}
```

再把这个结果反馈给模型，让模型继续回答，而不是静默丢弃工具调用。

### 4. 运行状态保存

每次工具执行完成后调用：

```ts
emitCheckpoint()
```

保存：

```ts
{
    state,
    protocolMessages,
    contextCheckpoint
}
```

即使 Agent 在中途被中断，前面已经创建的节点、工具结果和 Agent 阶段仍然可以保存到会话中。

## 六、第二个提交：长上下文压缩逻辑

文件：

```text
web/src/app/(user)/canvas/agent/canvas-agent-memory.ts
```

### 1. 为什么要压缩

原来只是：

```ts
messages.slice(-120)
```

这有两个问题：

- 可能从工具调用和工具结果中间截断。
- 早期用户目标、已经确认的比例、风格和否决方案会丢失。

新逻辑按照完整的“用户轮次”分组：

```text
真实用户消息
  + 后续助手回复
  + 工具调用
  + 工具执行结果
```

内部工具结果形式的 user 消息：

```text
工具执行结果（只可依据这些真实结果继续）：
```

不会被错误地当成新的用户轮次。

### 2. 压缩阈值

主要参数：

```ts
MAX_AGENT_INPUT_TOKENS = 260_000
MAX_RECENT_PROTOCOL_TOKENS = 64_000
MAX_COMPACTED_CONTEXT_TOKENS = 16_000
```

处理逻辑：

```text
最近完整轮次总量 <= 64k
  -> 保留原始消息

更早的完整轮次
  -> 发给检查点模型总结

检查点 <= 16k
  -> 放入长期上下文

当前未完成轮次
  -> 始终保留
```

检查点模型只允许总结：

- 用户长期目标。
- 用户偏好。
- 已确认方案。
- 不可改变要求。
- 被否决方向。
- 未解决问题。
- 节点 ID 线索。
- 当前 Skill 和阶段线索。

明确禁止保存：

- Base64 图片。
- 虚构的工具成功结果。
- 已不存在节点的事实。
- 未验证的媒体状态。

### 3. Token 估算和校准

本地先通过 `TextEncoder` 估算 UTF-8 字节数，再除以约 3 得到粗略 token 数，并乘以默认系数 `1.25`。

真实 API 返回用量后：

```text
实际 prompt token
  -> 与本地估算比较
  -> 更新当前模型/渠道的校准系数
```

校准 key 包含：

```text
apiMode
服务类型
baseUrl
model
```

不同模型不会共用一套估算系数。

## 七、第二个提交：Chat 与 Responses 接口

文件：

```text
web/src/services/api/canvas-agent.ts
```

配置新增：

```ts
apiMode: "chat" | "responses"
```

### Chat 模式

请求结构：

```json
{
  "model": "...",
  "messages": [...],
  "tools": [...]
}
```

### Responses 模式

请求结构：

```json
{
  "model": "...",
  "instructions": "...",
  "input": [...],
  "store": false,
  "include": ["reasoning.encrypted_content"],
  "tools": [...]
}
```

协议转换规则：

```text
user/system
  -> role + content

assistant 普通文本
  -> role=assistant

assistant 工具调用
  -> type=function_call

tool 结果
  -> type=function_call_output
  -> call_id 对应原 function_call
```

Responses 返回的完整 `output` 会写入 `responseItems`。下一轮优先使用原始 `responseItems`，而不是重新拼成普通文本，从而保持 Responses API 的工具调用和推理项关联。

## 八、第二个提交：后端 Skill 模型

新增文件：

```text
model/agent_skill.go
model/agent_skill_file.go
```

`AgentSkill` 主要字段：

```go
ID
OwnerUserID
Source
Name
Description
CoverURL
CoverStorageKey
Content
Enabled
Sort
CreatedAt
UpdatedAt
```

`AgentSkillFile` 使用联合主键：

```go
SkillID
Path
```

这样同一个 Skill 内不能存在重复路径。

数据库初始化在：

```text
repository/db.go
```

将两个模型加入 GORM AutoMigrate。

## 九、第二个提交：后端 Repository 层

文件：

```text
repository/agent_skill.go
```

主要函数及职责：

```text
ListEnabledSystemAgentSkills
    只返回 source=system 且 enabled=true

ListSystemAgentSkills
    管理后台查看全部系统 Skill

ListUserAgentSkills(userID)
    只返回当前用户的 source=user Skill

GetAgentSkill(id)
    按 ID 查询 Skill

ListAgentSkillFiles(skillID)
    按 sort、path 排序读取附属文件

GetAgentSkillFile(skillID, path)
    只读取 kind=file 的文件

DeleteUserAgentSkill(id, userID)
    删除时同时限制 source 和 owner_user_id

DeleteSystemAgentSkill(id)
    事务删除附属文件和系统 Skill
```

用户删除操作的 SQL 条件类似：

```text
id = ?
AND source = 'user'
AND owner_user_id = 当前用户
```

所以用户不能通过修改 ID 删除其他用户的 Skill，也不能删除系统 Skill。

系统 Skill 保存使用：

```go
SaveAgentSkillPackage(item, files)
```

内部通过 GORM 事务执行：

```text
保存 agent_skills
  -> 删除该 Skill 旧的 agent_skill_files
  -> 插入新的附属文件
```

这样编辑目录后不会留下旧文件。

## 十、第二个提交：后端 Service 层

文件：

```text
service/agent_skill.go
```

Service 层负责业务校验，不让 Handler 直接操作数据库。

### 1. 用户鉴权

用户接口首先从 Context 读取用户：

```go
user, ok := UserFromContext(ctx)
```

没有登录用户时返回：

```text
请先登录
```

### 2. Skill 内容校验

保存时：

```text
Name 必须非空
Content 必须非空
Content 最多 20000 个 Unicode 字符
```

这里使用：

```go
utf8.RuneCountInString
```

不是字节长度，保证前端和后端对中文字符的统计一致。

### 3. 编辑权限校验

如果输入带有 ID：

```text
读取已有 Skill
  -> 必须存在
  -> source 必须匹配当前接口
  -> owner_user_id 必须匹配当前用户
```

否则返回：

```text
Skill 不存在或无权修改
```

如果没有 ID，则生成 `agent-skill-...` 并写入创建时间。

### 4. 附属路径规范化

`normalizeAgentSkillPath` 执行：

```text
反斜杠替换为 /
path.Clean
拒绝空路径
拒绝 .
拒绝 ..
拒绝 ../ 前缀
拒绝绝对路径
拒绝冒号
拒绝空字节
限制最多 191 个 Unicode 字符
```

因此以下路径会被拒绝：

```text
../../secret.txt
/absolute/path.md
C:\\file.md
```

文件类型只允许：

```text
folder
file
```

文件扩展名只允许：

```text
.md
.markdown
.txt
```

根 `SKILL.md` 被特殊处理：

```text
根 SKILL.md 只能放在 agent_skills.content
不能重复作为附属文件保存
```

## 十一、第二个提交：Handler 和 Router

Handler 文件：

```text
handler/agent_skill.go
```

Handler 只做三件事：

```text
解析 JSON / URL 参数
调用 service
返回 OK / Fail
```

系统接口：

```text
GET /api/agent-skills
GET /api/agent-skills/:id/file?path=...
```

用户接口：

```text
GET    /api/v1/agent-skills
POST   /api/v1/agent-skills
DELETE /api/v1/agent-skills/:id
```

管理员接口：

```text
GET    /api/admin/agent-skills
GET    /api/admin/agent-skills/:id/files
POST   /api/admin/agent-skills
DELETE /api/admin/agent-skills/:id
```

项目虽然使用 Gin 路由，但 Handler 仍然采用：

```go
func(w http.ResponseWriter, r *http.Request)
```

再由 `gin.WrapF(...)` 包装，这与项目已有 Handler 风格一致。

## 十二、第二个提交：默认 Skill 初始化

文件：

```text
service/agent_skill_defaults.go
```

默认 Skill 使用：

```go
//go:embed skills
var defaultAgentSkillFS embed.FS
```

应用启动时调用：

```go
service.EnsureDefaultAgentSkills()
```

初始化逻辑：

```text
检查 agent-skills-initialized
  -> 已初始化：直接返回

未初始化
  -> 查询已有系统 Skill
  -> 如果已有 Skill，只写初始化标记，不覆盖
  -> 如果没有 Skill，读取嵌入的 service/skills
  -> 解析根 SKILL.md
  -> 解析 YAML front matter
  -> 生成稳定 ID
  -> 事务写入 Skill、附属目录、初始化标记
```

稳定 ID 使用 Skill 根路径的 SHA-256 前 8 字节，因此同一个内置 Skill 每次启动生成的 ID 都不变。

初始化整体在一个事务中进行：

```text
任意 Skill 或附属文件写入失败
  -> 整体回滚
  -> 不写初始化成功标记
```

### 默认加入的 7 个 Skill

1. H3 官方默认 Skill。
2. H3 3D 动画短片生成器。
3. H3 品牌宣传视频生成器。
4. H3 合作游戏开场动画生成器。
5. H3 音乐视频字幕生成器。
6. H3 剪纸定格动画。
7. H3 极简产品广告生成器。

其中 H3 官方默认 Skill 还有两个附属参考文件：

```text
references/base-en.txt
references/ref-en.txt
```

合作游戏开场动画 Skill 也有两个附属模板：

```text
references/h3-confirmation-image-template.md
references/h3-video-prompt-template.md
```

## 十三、七个内置 Prompt/Skill 的详细逻辑

### 1. H3 官方默认 Skill

面向 MiniMax H3 的五种视频提示模式：

- T2VA：纯文本生成音视频时间线。
- I2VA：从首帧向后发展。
- FL2VA：描述首帧到尾帧之间的连续变化。
- L2VA：从合理的前置状态逐步落到尾帧。
- Ref2VA：完整参考模式。

基础模式要求使用：

```text
integrated_multimodal_description
overall_soundscape
non_diegetic_music
```

完整参考模式要求使用：

```text
subject_definitions
summary
retention_analysis
detailed_description
overall_soundscape
non_diegetic_music
```

还规定：

- 镜头必须按时间顺序描述。
- 摄像机运动要说明类型、幅度和速度。
- 说话人使用稳定的 `(S1)`、`(S2)` 编号。
- 对白放在 `<d>` 中，并保留原始语言。
- 参考图片、视频、音频和可复用主体使用稳定引用标签。
- 声音分为场景内声音、整体环境声和观众才能听见的非场景音乐。

### 2. H3 3D 动画短片生成器

完整流程：

```text
一句创意
  -> 项目简报
  -> 故事大纲
  -> 角色卡
  -> 场景卡
  -> 六列标准镜头表
  -> 镜头表自检
  -> 文本分镜或铅笔分镜
  -> 确认视频模型和分辨率
  -> 单镜头视频
  -> 片段编组
  -> BGM 和外部合成方案
```

每个高成本节点都设置确认门，包括：

- 画面比例。
- 总时长。
- 项目简报。
- 故事大纲。
- 角色卡。
- 场景卡。
- 标准镜头表。
- 镜头表自检。
- 分镜模式。
- 当前全局视频模型。
- 视频分辨率。

六列镜头表强制包含：

```text
镜头编号与时长
连续性衔接
参考锚点
Hook 类型
镜头描述（逐秒指令）
音频与对白轨
```

逐秒指令需要覆盖：

1. 动作、姿态和表情。
2. 镜头运动。
3. 空间位置。
4. 音频线索。
5. 与下一秒或下一镜的交接。

它还要求：

- 单镜不超过 15 秒。
- 单镜重要角色不超过 3 个。
- 每镜有 Hook。
- 同场景跨镜继承固定地标和光位。
- 角色卡和场景卡作为权威参考。
- 不能用 `generate_audio` 生成 BGM。
- 当前画布没有视频拼接和混音功能，只能交付真实片段编组与外部方案。

### 3. H3 品牌宣传视频生成器

流程是：

```text
上传 Logo、产品图、官网或品牌资料
  -> 建立品牌事实表
  -> 创建来源清单
  -> 选择故事脊柱
  -> 规划精确节拍
  -> 用户确认
  -> 生成图片/视频/语音资产
  -> 验证交付
```

它重点限制品牌真实性：

- 未核验的 Logo、界面、吉祥物不能仿造。
- 产品功能、指标和宣传主张不能凭空生成。
- 来源清单记录素材来源和验证状态。
- 没有真实拼接、混音能力时不能声称已经完成最终成片。

### 4. H3 合作游戏开场动画生成器

流程是：

```text
选择视觉风格
  -> 输入两个玩家名和游戏名
  -> 读取确认图模板
  -> 生成一张确认图
  -> 用户批准
  -> 读取当前视频模型
  -> 读取 H3 视频模板
  -> 生成最终视频
```

它把界面拆成两套规则：

```text
固定 UI 框架
动态视觉风格
```

固定内容包括：

- 16:9 布局。
- 玩家卡位置。
- 角色左右位置。
- 右侧菜单结构。
- Continue 主按钮。
- 玩家信息层级。

动态内容包括：

- 颜色。
- 材质。
- 光照。
- 角色渲染。
- 图标风格。
- 字体质感。
- 背景装饰。

必须防止：

- 两个角色身份互换。
- 玩家名互换。
- 角色体型趋同。
- UI 文字不可读。
- 生成出第三个角色。

### 5. H3 音乐视频字幕生成器

流程重点：

```text
锁定音乐
  -> 锁定歌词
  -> 确认 BPM 和时间点
  -> 规划多镜头时间线
  -> 设计歌词文字和人物表演
  -> 生成视频片段
  -> 按 Master Audio 对齐外部拼接
```

当视频超过 15 秒时，必须拆成多个短镜头，并使用：

- 首尾帧接续。
- 鼓点硬切。
- Match Cut。
- 相同美学 Header。
- 相同主音轨。
- 口型和歌词连续性。

它明确说明当前画布没有自动音频分析工具，因此 BPM、歌词时间点和节拍必须来自用户或外部确认，不能声称已经自动检测。

### 6. H3 剪纸定格动画

默认规则：

- 16:9 横版。
- 单段约 4 秒。
- 默认保留纸片滑动、弹入、压平和摩擦音效。
- 默认不添加 BGM、旁白和字幕。
- 先生成静帧并等待确认。
- 静帧确认后再生成停格动画。

动画过程要求：

```text
干净纸色背景
  -> 背景层进入
  -> 前景和中景纸片进入
  -> 主体元素弹入
  -> 纸片轻微回弹
  -> 压平并暂停
  -> 锁定到已批准静帧
```

它防止视频模型输出：

- 普通平滑数字图层移动。
- 牛皮纸或棕黄色脏底。
- 整体淡入。
- 复杂文字和假 UI。
- 混乱的物件飞散。

### 7. H3 极简产品广告生成器

流程是：

```text
产品图
  -> 确认款式、比例、时长和 Apple 风格
  -> 产品事实摘要
  -> 选择产品叙事脊柱
  -> 生成英文短文案
  -> 生成三张独立锚定照片
  -> 创建精确节拍分镜表
  -> 生成单一全画幅产品视频
  -> 外部音乐卡点和交付验证
```

三张锚定照片分别负责：

1. 主视觉和产品主视角。
2. 材质、结构和功能细节。
3. 结尾构图和单行英文文案。

不用四宫格锚定图，是因为视频模型可能把四宫格布局复制到最终视频中。

它还强制：

- 保留产品原始颜色和材质。
- 文案使用 3-5 个英文词。
- 同一时间只允许一条单行文案。
- 文案必须真正出现在视频中，而不是只预留后期字幕位置。
- 结尾必须是稳定的单一全画幅产品构图。
- 不把产品图、锚定图和分镜图混为同一种参考。

## 十四、前端 Agent Runtime 与媒体执行

### 1. Agent 工具处理

新增工具：

```text
query_canvas_nodes
read_skill_file
```

`query_canvas_nodes` 支持：

```text
nodeId
keyword
type
page
pageSize
```

前端只返回节点摘要：

```text
id
type
title
status
groupId
```

找到节点 ID 后，再通过 `get_node` 获取完整内容。

### 2. 媒体工具的节点创建流程

图片、视频、音频工具的执行流程统一为：

```text
创建节点
  + 写入 Prompt、模型、尺寸、参数
  + 创建 sourceNodeIds 对应的来源连线
  + 根据 autoGenerateMedia 决定是否提交任务
```

这使 Agent 可以先创建制作结构，再由用户检查。

## 十五、前端具体新增按钮和入口

### 1. 画布 Agent 输入框

涉及：

- `canvas-assistant-composer.tsx`
- `canvas-agent-skill-popover.tsx`
- `canvas-prompt-chip-input.tsx`

新增按钮和功能：

```text
Skill 按钮
```

功能：

- 查看系统 Skill。
- 查看用户 Skill。
- 搜索 Skill。
- 选择 Skill。
- 显示 Skill Chip。
- 删除 Skill Chip。
- 导入 Markdown/文本 Skill。

```text
Chat / Responses 接口切换按钮
```

功能：

```text
Chat
  -> /chat/completions

Responses
  -> /responses
```

这不是切换模型，而是切换文本模型的请求协议。

发送按钮仍然根据状态切换：

```text
未运行 -> ArrowUp -> 发送
运行中 -> Square -> 停止
```

### 2. Skill Popover

界面新增：

```text
通用 | 我的
[搜索 Skill]
```

“我的”标签新增：

- 导入按钮。
- 编辑按钮。
- 删除按钮。

编辑窗口新增：

- Skill 名称输入框。
- Skill 描述输入框。
- Skill 内容编辑区。
- 封面 URL 输入。
- 上传封面按钮。
- 移除封面按钮。
- 保存按钮。

导入逻辑：

```text
选择 .md / .markdown / .txt 文件
  -> 读取文件内容
  -> 校验不为空
  -> 校验不超过 20000 字符
  -> 未登录保存到 localforage
  -> 已登录保存到后端
  -> 自动选中该 Skill
```

### 3. Agent 对话面板

文件：

```text
web/src/app/(user)/canvas/components/canvas-assistant-panel.tsx
```

顶部新增：

```text
Agent 设置按钮
```

点击后打开 Agent 设置窗口，包含：

```text
自动生成图片/视频/音频 Switch
```

关闭时：

```text
Agent 创建媒体节点
  -> 配置 Prompt、模型、尺寸和参数
  -> 创建来源连线
  -> 不提交生成任务
  -> 节点状态为 idle
```

开启时：

```text
Agent 创建媒体节点
  -> 配置参数和来源连线
  -> 直接提交任务
  -> 节点进入 loading
```

对话消息新增：

```text
复制按钮
```

助手消息显示：

```text
复制 + 重试
```

用户消息显示：

```text
复制
```

### 4. 画布左侧节点列表

文件：

```text
canvas-side-panel.tsx
```

分组节点新增：

```text
展开/收起箭头按钮
```

同时增加：

- 子节点缩进。
- 层级连接线。
- 搜索命中子节点时保留父组。
- 点击节点后聚焦画布节点。

### 5. 文本节点和文本节点工具栏

删除或收敛的入口：

```text
文本节点内部固定“生图”按钮
文本节点悬浮工具栏中的“编辑文字”按钮
```

保留的能力：

- 文本正文编辑。
- 文本节点对话编辑。
- 字体大小调整。
- 通过统一工具栏触发文本生图。

文本正文布局改为统一四周 padding，正文可占用更大空间。

### 6. 后台菜单

文件：

```text
web/src/app/(admin)/admin/layout.tsx
```

后台左侧新增：

```text
Skill 管理
```

路径：

```text
/admin/skills
```

### 7. 后台 Skill 管理页面

文件：

```text
web/src/app/(admin)/admin/skills/page.tsx
```

页面顶部新增：

- 关键词搜索框。
- 刷新按钮。
- Skill 数量标签。
- 新增按钮。

列表显示：

```text
封面
名称
描述
状态
排序
更新时间
操作
```

每行操作：

```text
编辑
删除
```

系统 Skill 支持：

- 新增。
- 编辑。
- 启用/停用。
- 修改排序。
- 修改名称。
- 修改描述。
- 修改封面。
- 修改根 `SKILL.md`。
- 删除。

### 8. 后台 Skill 编辑器

左侧：

- 名称。
- 描述。
- 封面。
- 启用开关。
- 排序输入。
- 保存按钮。
- 附属文件目录树。

右侧：

- 当前 `SKILL.md` 或附属文件编辑区。
- 字数统计。
- 20000 字限制。

目录树新增：

```text
[创建文件夹] [创建 Markdown]
```

文件和目录悬浮后显示：

```text
[重命名] [删除]
```

支持：

- 创建文件夹。
- 创建 Markdown 文件。
- 自动补 `.md` 扩展名。
- 重命名文件。
- 重命名目录。
- 删除文件。
- 删除目录及全部子文件。
- 展开/收起目录。
- 拖拽移动文件。
- 拖拽移动目录。
- 同级拖拽排序。
- 拖入目录。
- 阻止移动到自身子目录。
- 阻止同名覆盖。
- 防止修改根 `SKILL.md` 路径。

### 9. Skill 封面功能

系统 Skill 和用户 Skill 都支持：

- 远程图片 URL。
- 本地图片上传。
- 已上传图片预览。
- 清除图片。
- 通过现有图片存储系统持久化。
- 通过 `coverStorageKey` 在刷新后重新解析地址。

没有封面时显示扳手图标。

## 十六、第三个提交：媒体自动生成开关

提交：

- https://github.com/tigerowo/infinite-canvas/commit/9e6017559ce1daa98942799af7c163897a42f2a1

新增配置：

```ts
autoGenerateMedia: boolean
```

默认值：

```ts
false
```

配置同时进入：

- 首页 Agent 配置。
- 画布页 Agent 配置。
- Agent 上下文中的 `generation.autoGenerateMedia`。

### 关闭时的工具结果

```json
{
  "ok": true,
  "submitted": false,
  "nodeId": "image-...",
  "createdNodeIds": ["image-..."],
  "connectionIds": ["connection-..."],
  "type": "image",
  "status": "idle",
  "message": "媒体节点已创建并完成参数配置，尚未提交生成"
}
```

### 开启时的工具结果

```text
创建节点和连线
  -> 调用 handleGenerateNode
  -> 提交图片/视频/音频任务
  -> 返回 submitted=true
  -> 节点进入 loading 或最终状态
```

`core.ts` 还增加了明确规则：

```text
generation.autoGenerateMedia=false 时：
    媒体工具只创建节点和来源连线
    不得重复调用工具催促提交
    不得把 idle 节点当成已生成成品
    必须停止依赖该媒体结果的后续步骤
    必须告知用户可手动提交
```

## 十七、第三个提交：图片引用顺序修复

原逻辑在已有图片节点上继续生成时，可能只传当前节点图片，或者让当前图片排在连线参考图之前。

新逻辑统一为：

```ts
const referenceImages = [
    ...generationContext.referenceImages,
    ...sourceReference,
];
```

这会带来两个结果：

1. 连线传入的参考图片不再被当前节点图片覆盖。
2. 当前节点图片仍然传递，但排在已有连线参考之后。

因此继续编辑一个图片节点时，模型可以同时收到：

```text
图片 1：角色参考图
图片 2：场景参考图
图片 3：风格参考图
图片 4：当前正在编辑的图片
```

同样逻辑应用于：

- 普通图片生成/编辑。
- 全景图片生成。
- 已有图片节点继续生成。

上游 Prompt 约束也要求：

```text
sourceNodeIds 必须按 Prompt 中的图片编号顺序排列
```

因此：

```text
连线顺序
  -> sourceNodeIds 顺序
  -> 参考图编号
  -> Prompt 中的 Picture 1 / Picture 2
```

需要保持一致。

## 十八、前端和后端之间的最终闭环

用户选择系统 Skill 后：

```text
前端 GET /api/agent-skills
  -> 后端只返回 enabled=true 的 system Skill
  -> 前端保存选中的 id
```

发送消息时：

```text
前端根据 id 读取最新 Skill
  -> 把根 content 注入 system prompt
  -> 如果 hasFiles=true，增加 read_skill_file 工具
```

模型调用附属文件时：

```text
前端检查 skillId 是否当前激活
  -> GET /api/agent-skills/:id/file?path=...
  -> 后端 service 再检查 system + enabled
  -> 规范化 path
  -> repository 读取 kind=file
  -> 返回正文
```

用户 Skill 则不开放附属文件：

```text
未登录：localforage
已登录：/api/v1/agent-skills
```

系统 Skill 和用户 Skill 共用前端选择器，但后端权限完全分开。

## 十九、风险和兼容性判断

1. 第 2 个提交是最大变更。它同时改动 Go 数据表、路由、后台页面、前端状态、Agent 协议和模型请求格式，不是简单复制几个 Prompt 文件。
2. Skill 根内容直接进入每轮 system prompt。虽然限制了单个 Skill 20,000 字符、最多选择 5 个，并增加了上下文压缩，但多个大 Skill 仍会显著增加上下文消耗和模型费用。
3. 默认 Skill 只在数据库首次初始化时导入。管理员后续删除的 Skill 不会在下一次启动时自动恢复；上游以后更新内置 Skill 时，已有数据库也不会自动升级。
4. `autoGenerateMedia=false` 是明显的行为变化。Agent 返回“创建成功”不等于媒体已经生成，依赖节点必须由用户手动提交后才可继续。
5. 第 3 个提交的图片参考修复依赖第 2 个提交新增的 Agent 配置字段，不能完全视为独立补丁。
6. 当前画布没有视频拼接、音频混音、BGM 生成和音频自动分析能力。多个 Skill 特意把这些内容定义为外部方案，防止 Agent 声称完成了实际上没有执行的工作。

## 二十、三次更新的本质

三次提交逐步补齐了 Agent 的生产链：

```text
第一次：
让文本节点能稳定流式输出，改善画布浏览和消息操作。

第二次：
让 Agent 能加载专业工作流，记住长会话，并正确读取大型画布。

第三次：
让“创建媒体节点”和“提交生成任务”分离，同时修正多图参考的顺序。
```

最终 Agent 的行为从：

```text
用户输入
  -> 模型直接决定
  -> 可能直接提交生成
```

变成：

```text
用户输入
  -> 选择专业 Skill
  -> 按 Skill 流程确认
  -> 查询真实画布
  -> 创建带来源的节点
  -> 根据开关决定是否提交
  -> 记录真实状态
  -> 长会话继续执行
```

最大的架构变化是：Agent 不再只是聊天入口，而变成了具备工作流规则、持久记忆、真实画布查询和可控媒体执行阶段的前端编排器。
