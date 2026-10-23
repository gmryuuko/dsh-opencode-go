# dsh-opencode-go

将 OpenCode Go 的模型接入 DeepSeek Harness（DSH）。安装后只需填写 **token**，无需配置 API 地址、模型 ID 或协议。

适配 **DSH 0.2.1-rc.2**，需要 Node.js **22.19+**。token 是 [OpenCode Console](https://opencode.ai/auth) 中的 **Go API Key**，不是网页登录 cookie。

## 安装与使用

直接从 GitHub 安装。在终端执行：

```powershell
dsh plugin --profile web add github:gmryuuko/dsh-opencode-go#main
```

1. 启动或重启 `dsh --profile web`。
2. 打开左侧 **插件 → 已安装**，启用 `dsh-opencode-go`，点击插件名称进入详情。
3. 在详情中的 **OpenCode Go API Key** 输入框粘贴 key，点击 **保存 API Key**。
4. 在会话模型选择器中选择 **OpenCode Go** 下的模型。

token 保存后在下一次请求生效，无需再次重启。启动时允许留空；填写前不会提供可选模型。token 字段标记为 secret，设置表单不会回传已保存的明文值；配置仍由 DSH 保存到当前 profile，勿分享包含 token 的 profile 文件。

首次从旧版更新到带配置页面的版本后，请重启 DSH，以加载新增的客户端入口。**设置 → 内置插件** 是运行状态清单，不是本插件的 key 输入入口。

使用其他 profile 时，将命令中的 `web` 替换为实际名称。仓库包含已构建的 `dist/`，安装时无需手动编译。本项目尚未发布到 npm。

从本地源码目录安装时，先在该目录执行 `npm ci`，再执行 `dsh plugin --profile desktop add .`（Web 版将 `desktop` 换成 `web`）。本地目录以链接方式加载，仍需安装运行依赖；已有 `dist/` 不代表依赖已安装。

## 功能

- 单一 provider：`opencode-go`，直接使用 DSH 自带的模型选择器。
- 自动匹配 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Google Generative AI 四种协议及各自的 API 地址。
- 复用 DSH 官方 `PiAiAdapter`，保留流式文本、思考内容、工具调用、用量统计、原生 replay 元数据，以及模型支持的图片输入和思考等级。
- 所有协议携带 DSH 身份及 `x-opencode-session`；缺少会话 ID 的辅助调用自动补齐路由标识。
- 自动从 Go 的公开 `/models` 端点同步目录，成功结果缓存 5 分钟；网络故障继续使用上次目录或内置目录。
- token 热更新；不读取 OpenCode 本地认证文件，不使用其他 provider 的环境变量凭据。

2026-10-23 的公开目录实测可匹配 **34 个模型**，包括 GLM、Kimi、DeepSeek、MiMo、MiniMax、Qwen、GPT Luna、Grok、Muse Spark、Claude Haiku 与 Gemini。模型列表由服务端决定，实际调用取决于账号权限与额度。

模型端点目前只返回 ID，没有完整协议元数据。本插件结合 pi-ai 的模型元数据确认路由；对于暂时无法确认的 ID（本次为 `omen-alpha`、`qwen3.7-max`），会跳过并记录提示。后续新增且未收录的模型需要更新插件。不同模型的上下文容量和图片支持也来自该元数据目录。

## 无界面配置

也可以在当前 profile 的 `cordis.patch.yml` 中覆盖插件配置，只填 token：

```yaml
- id: llm-opencode-go
  config:
    token: '你的 OpenCode Go API Key'
```

如果更希望从环境变量传入，可以在该用户 patch 中使用 DSH 支持的表达式：

```yaml
- id: llm-opencode-go
  config:
    token: !!js "process.env.OPENCODE_GO_API_KEY || ''"
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

测试使用模拟 HTTP/SSE 响应，不需要 token，也不会消耗额度；覆盖四种协议的真实 SDK 请求、鉴权与会话头、UTF-8 分片、工具参数、用量与终止顺序、token 更新、取消、目录缓存及离线回退。另验证客户端配置入口、密码输入与保存成功/失败，以及真实 Cordis Loader 中 token 热更新后的模型列表刷新、插件注册、卸载与重复注册行为。

已实测公开模型目录；尚未使用真实 Go token 进行付费生成验证。

参考：[OpenCode Go 官方说明](https://opencode.ai/v2/docs/console/go/)、[DSH LLM 适配器接口](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-an-llm-adapter.md)、[DSH 插件打包与安装](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。
