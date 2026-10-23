# dsh-opencode-go

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.2-4f46e5)
![Node.js](https://img.shields.io/badge/node-%3E%3D22.19.0-339933)
![License](https://img.shields.io/badge/license-MIT-64748b)

将 **OpenCode Go** 模型接入 **DeepSeek Harness（DSH）**。安装后只需在设置页填写 **Go API Key**，即可自动匹配协议、同步模型目录并按需开关模型，无需手动配置 API 地址、模型 ID 或底层协议。

> [!IMPORTANT]
> - **凭据类型**：Token 是 [OpenCode Console](https://opencode.ai/auth) 中的 **Go API Key**，不是网页登录 Cookie。
> - **版本更新**：从旧版插件更新后，请**完全退出并重启 DSH**（包括托盘进程），以加载新的 **设置 → OpenCode Go** 标签；插件管理页仅用于安装、启用和停用插件。

---

## 快速上手

### 1. 安装插件

直接从 GitHub 安装（仓库已包含预构建 `dist/`，无需手动编译；其他环境可将 `web` 替换为 `desktop` 等实际 profile 名称）：

```powershell
dsh plugin --profile web add github:gmryuuko/dsh-opencode-go#main
```

### 2. 启用并保存 API Key

1. 启动或重启 `dsh --profile web`。
2. 打开左侧 **插件 → 已安装**，启用 `dsh-opencode-go`。
3. 打开 **设置 → OpenCode Go** 标签，在 **OpenCode Go API Key** 输入框粘贴 Key，点击 **保存 API Key**（下一次请求立即生效，无需再次重启）。

### 3. 选择与管理模型

1. 在 **设置 → OpenCode Go** 标签下方按需开启或关闭各个模型，开关自动保存。
2. 回到会话模型选择器，选择 **OpenCode Go** 下已开启的模型开始使用。

---

## 核心特性

- **单一 Provider 集成**：注册 `opencode-go`，直接对接 DSH 原生会话模型选择器与独立 **设置 → OpenCode Go** 管理页。
- **四协议自动路由**：复用 DSH 官方 `PiAiAdapter`，保留流式文本、思考内容（Reasoning）、工具调用、用量统计、原生 replay 元数据，以及模型支持的图片输入和思考等级。
- **稳定会话路由**：所有协议均携带 DSH 身份及 `x-opencode-session`；缺少会话 ID 的辅助调用会自动补齐稳定的会话路由标识。
- **目录自动同步与离线兜底**：自动从公开 `/models` 端点同步目录（成功缓存 5 分钟，失败 1 分钟后重试）；网络异常时无缝回退至上次可用目录或内置目录。
- **严格凭据隔离与热更新**：API Key 与模型开关修改即时生效；不读取 OpenCode 本地认证文件，也不回退使用其他 provider 的环境变量凭据。

### 协议路由与模型覆盖

2026-10-23 公开目录实测可匹配 **34 个模型**（实际可用列表与调用权限取决于服务端目录及账号额度）：

| 协议 (`api`) | 自动路由地址 (`baseUrl`) | 覆盖模型系列 |
| --- | --- | --- |
| `openai-completions` | `https://opencode.ai/inference/go/openai/v1` | GLM、Kimi、DeepSeek、MiMo、MiniMax（`m3.1-flash`）、Hunyuan、LongCat、Step 等 |
| `openai-responses` | `https://opencode.ai/inference/go/openai/v1` | GPT Luna、Grok、Muse Spark |
| `anthropic-messages` | `https://opencode.ai/inference/go/anthropic` | Claude Haiku、MiniMax（`m3` / `m2.5` / `m2.7`）、Qwen（`3.7-plus` / `3.8`） |
| `google-generative-ai` | `https://opencode.ai/inference/go/google/v1beta` | Gemini |

---

## 配置与安全说明

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKeyEnv` | `OPENCODE_GO_API_KEY` | DSH 凭据服务中的凭据名称；插件配置仅存引用名，不保存密钥明文 |
| `disabledModels` | `[]` | 已关闭的模型 ID 列表；模型默认全部开启 |
| `token` | `""` | 旧版兼容字段；启动后自动迁移至凭据服务并清除 |

- **凭据回显与未配置保护**：设置界面只读取“是否已配置”，不会回传已保存的密钥；未配置 API Key 时不会向模型选择器提供可选模型。
- **模型开关行为**：未填写 Key 时也可预先调整模型开关。关闭后，模型会从会话选择器中隐藏，已有会话下一次调用该模型也会拦截并提示更换模型或重新开启（已开始的生成不受影响）。关闭的模型仍保留在设置列表中，随时可重新开启；设置页与会话选择器共用宿主模型目录和离线回退。

> [!WARNING]
> DSH 当前默认凭据服务将密钥保存在 `$DSH_HOME/.credentials.yaml`，这是独立的本地明文凭据文件，并非系统钥匙串或加密保险箱。请勿分享或提交该文件；Windows 上其保护取决于文件的访问权限。

<details>
<summary><b>无界面配置（cordis.patch.yml 与环境变量）</b></summary>

可在当前 profile 的 `cordis.patch.yml` 中指定凭据名称与关闭的模型列表：

```yaml
- id: llm-opencode-go
  config:
    apiKeyEnv: OPENCODE_GO_API_KEY
    disabledModels: [] # 例如 ['glm-5.3', 'kimi-k3']
```

通过设置页保存对应 Key，或在启动 DSH 前设置同名环境变量（当该名称已有保存的凭据时，DSH 优先使用已保存值）：

```powershell
$env:OPENCODE_GO_API_KEY = '你的 OpenCode Go API Key'
dsh --profile web
```

**注意事项：**
- 不要同时让其他适配器注册 `opencode-go`（例如 `llm-pi-ai.providers.opencode-go`），DSH 会拒绝重复 provider。
- 插件会明确拒绝官方 `pi-ai` 适配层不支持的 `stop` 参数。

</details>

<details>
<summary><b>旧版明文 token 自动迁移与模型元数据规则</b></summary>

- **旧版 `token` 自动迁移**：旧版配置中的明文 `token` 会在启动后自动迁移——先确认凭据已持久保存，再通过宿主设置服务清除旧字段。若写入失败或凭据库中已有不同凭据，则保留旧配置；可在设置页重新保存希望使用的 Key 来完成迁移。旧版 `!!js` 表达式不会被自动改写。
- **公开目录元数据匹配**：公开 `/models` 端点目前只返回模型 ID，不包含完整协议元数据。本插件结合 `pi-ai` 的模型元数据确认路由、上下文容量与图片支持；对于暂时无法确认元数据的 ID（如 `omen-alpha`、`qwen3.7-max`），会自动跳过并记录日志提示，后续新增且未收录的模型需要更新插件。

</details>

<details>
<summary><b>本地源码 / 离线包安装与开发验证</b></summary>

本项目尚未发布到 npm。除直接通过 `github:gmryuuko/dsh-opencode-go#main` 安装外，也支持本地目录或离线打包安装：

**从本地源码目录安装**（本地目录以链接方式加载，即使已有 `dist/` 仍需先安装运行依赖）：

```powershell
npm ci
dsh plugin --profile desktop add .   # Web 版将 desktop 换成 web
```

**开发、检查与离线打包安装**：

```powershell
npm ci
npm run check
npm test
npm pack
dsh plugin --profile web add ./dsh-opencode-go-0.1.0.tgz
```

- **自动化测试范围**：测试使用模拟 HTTP/SSE 响应，不需要 Token，也不会消耗额度；覆盖四种协议的真实 SDK 请求、鉴权与会话头、UTF-8 分片、工具参数、用量与终止顺序、Token 更新、取消、目录缓存及离线回退。另验证独立设置标签、凭据保存、模型开关及保存成功/失败、关闭模型后的调用拦截，并通过真实 Cordis `Loader` / `SettingsForms` 验证旧 Token 迁移及失败保护、配置热更新、注册和卸载行为。
- **验证状态**：已实测公开模型目录；尚未使用真实 Go Token 进行付费生成验证。

</details>

---

## 参考资料

- [OpenCode Go 官方说明](https://opencode.ai/v2/docs/console/go/)
- [OpenCode Console（获取 Go API Key）](https://opencode.ai/auth)
- [DSH LLM 适配器接口](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-an-llm-adapter.md)
- [DSH 插件打包与安装](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
