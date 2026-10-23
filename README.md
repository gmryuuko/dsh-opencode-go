# dsh-opencode-go

将 OpenCode Go 的模型接入 DeepSeek Harness（DSH）。安装后只需填写 **token**，无需配置 API 地址、模型 ID 或协议。

适配 **DSH 0.2.1-rc.2**，需要 Node.js **22.19+**。token 是 [OpenCode Console](https://opencode.ai/auth) 中的 **Go API Key**，不是网页登录 cookie。

## 安装与使用

直接从 GitHub 安装。在终端执行：

```powershell
dsh plugin --profile web add github:gmryuuko/dsh-opencode-go#main
```

1. 启动或重启 `dsh --profile web`。
2. 打开左侧 **插件 → 已安装**，启用 `dsh-opencode-go`。
3. 打开 **设置 → OpenCode Go** 标签，在 **OpenCode Go API Key** 输入框粘贴 key，点击 **保存 API Key**。
4. 在同一标签中按需开启或关闭各个模型，开关自动保存。
5. 在会话模型选择器中选择 **OpenCode Go** 下已开启的模型。

API Key 通过 DSH 凭据服务保存，普通插件配置只保存凭据名称 `apiKeyEnv`（默认 `OPENCODE_GO_API_KEY`）和模型开关。界面只读取“是否已配置”，不会回传已保存的密钥。保存后在下一次请求生效，无需再次重启；未配置时不会提供可选模型。

DSH 当前默认凭据服务将密钥保存在 `$DSH_HOME/.credentials.yaml`，这是独立的本地明文凭据文件，并非系统钥匙串或加密保险箱。不要分享或提交该文件；Windows 上其保护取决于文件的访问权限。

旧版配置中的明文 `token` 会在启动后自动迁移：先确认凭据已持久保存，再通过宿主设置服务清除旧字段。写入失败或已有不同凭据时保留旧配置；可在设置页重新保存希望使用的 key 来完成迁移。旧版 `!!js` 表达式不会被自动改写。

从旧版更新后，请重启 DSH，以加载新的设置标签。配置入口位于 **设置 → OpenCode Go**；插件管理页仅用于安装、启用和停用插件。

模型默认全部开启，未填写 key 时也可调整开关。关闭后，模型会从会话选择器中隐藏，已有会话下一次调用该模型也会提示更换模型或重新开启；已经开始的生成不受影响。关闭的模型会保留在设置列表中，随时可重新开启。设置页与会话选择器共用宿主模型目录和离线回退。

使用其他 profile 时，将命令中的 `web` 替换为实际名称。仓库包含已构建的 `dist/`，安装时无需手动编译。本项目尚未发布到 npm。

从本地源码目录安装时，先在该目录执行 `npm ci`，再执行 `dsh plugin --profile desktop add .`（Web 版将 `desktop` 换成 `web`）。本地目录以链接方式加载，仍需安装运行依赖；已有 `dist/` 不代表依赖已安装。

## 功能

- 单一 provider：`opencode-go`，直接使用 DSH 自带的模型选择器。
- 独立 **设置 → OpenCode Go** 标签，集中管理 API Key 和各模型开关；修改即时生效。
- 自动匹配 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Google Generative AI 四种协议及各自的 API 地址。
- 复用 DSH 官方 `PiAiAdapter`，保留流式文本、思考内容、工具调用、用量统计、原生 replay 元数据，以及模型支持的图片输入和思考等级。
- 所有协议携带 DSH 身份及 `x-opencode-session`；缺少会话 ID 的辅助调用自动补齐路由标识。
- 自动从 Go 的公开 `/models` 端点同步目录，成功结果缓存 5 分钟；网络故障继续使用上次目录或内置目录。
- token 热更新；不读取 OpenCode 本地认证文件，不使用其他 provider 的环境变量凭据。

2026-10-23 的公开目录实测可匹配 **34 个模型**，包括 GLM、Kimi、DeepSeek、MiMo、MiniMax、Qwen、GPT Luna、Grok、Muse Spark、Claude Haiku 与 Gemini。模型列表由服务端决定，实际调用取决于账号权限与额度。

模型端点目前只返回 ID，没有完整协议元数据。本插件结合 pi-ai 的模型元数据确认路由；对于暂时无法确认的 ID（本次为 `omen-alpha`、`qwen3.7-max`），会跳过并记录提示。后续新增且未收录的模型需要更新插件。不同模型的上下文容量和图片支持也来自该元数据目录。

## 无界面配置

也可以在当前 profile 的 `cordis.patch.yml` 中指定凭据名称。通过设置页保存对应 key，或在启动 DSH 前设置同名环境变量；可选的 `disabledModels` 列出关闭的模型 ID：

```yaml
- id: llm-opencode-go
  config:
    apiKeyEnv: OPENCODE_GO_API_KEY
    disabledModels: [] # 例如 ['glm-5.3', 'kimi-k3']
```

例如使用 PowerShell 环境变量（该名称已有保存的凭据时，DSH 优先使用已保存值）：

```powershell
$env:OPENCODE_GO_API_KEY = '你的 OpenCode Go API Key'
dsh --profile web
```

不要同时让其他适配器注册 `opencode-go`，例如 `llm-pi-ai.providers.opencode-go`；DSH 会拒绝重复 provider。插件会明确拒绝官方 pi-ai 适配层不支持的 `stop` 参数。

## 开发与验证

```powershell
npm ci
npm run check
npm test
npm pack
```

`npm pack` 自动构建，生成 `dsh-opencode-go-0.1.0.tgz`，可用以下命令安装：

```powershell
dsh plugin --profile web add ./dsh-opencode-go-0.1.0.tgz
```

测试使用模拟 HTTP/SSE 响应，不需要 token，也不会消耗额度；覆盖四种协议的真实 SDK 请求、鉴权与会话头、UTF-8 分片、工具参数、用量与终止顺序、token 更新、取消、目录缓存及离线回退。另验证独立设置标签、凭据保存、模型开关及保存成功/失败、关闭模型后的调用拦截，并通过真实 Cordis Loader / SettingsForms 验证旧 token 迁移及失败保护、配置热更新、注册和卸载行为。

已实测公开模型目录；尚未使用真实 Go token 进行付费生成验证。

参考：[OpenCode Go 官方说明](https://opencode.ai/v2/docs/console/go/)、[DSH LLM 适配器接口](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-an-llm-adapter.md)、[DSH 插件打包与安装](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。
