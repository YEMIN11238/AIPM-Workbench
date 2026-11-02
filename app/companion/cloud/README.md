# 大肥鱼云端 QQ 部署资产

这里组装官方 AstrBot 和 SnowLuma，不实现聊天、人设或记忆引擎。目标是独立的 Ubuntu 22.04/24.04 x86_64 主机，基础初始化提供单 QQ 文字聊天。人格、会话历史和上下文管理使用 AstrBot 原版后台；人设、表情包、长期记忆、主动聊天和语音可按[现成大肥鱼配置包](https://github.com/zexuanw958-svg/dafeiyu-config-pack)通过原版接口配置。B 站、抖音及三平台共享记忆不在这些部署资产的验证范围内。

`compose.memory.yaml` 是同机 Ollama 的可选扩展；文件存在于部署目录时，`deploy.sh` 的检查、启动、停止与状态查询均包含它。服务仅在专属网络开放 11434，限制为 1536 MiB、1 CPU、单并发和单个已加载模型。AstrBot 使用 `http://ollama:11434/v1`，不能照抄视频本机的 `127.0.0.1`。扩展不会自动下载模型或安装 LivingMemory；首次配置后仍需分别验证 1024 维嵌入、主人会话白名单、QQ 媒体收发和跨会话记忆。

## 固定版本与已核验范围

基础镜像固定官方发布标记、索引摘要和 amd64 manifest；容器启动、QQ 登录与实际收发需分别验收。

| 官方发布镜像 | 索引摘要 | linux/amd64 manifest |
| --- | --- | --- |
| `soulter/astrbot:v4.29.3` | `sha256:c93a6d19507ba45474c3dfb82aad9d36eb432a478112f13c7e6325b5ebffc5f2` | `sha256:d6f6508af78b9d0e427c0959a2fdd1016411720aad67cfcde8719870a89ee832` |
| `motricseven7/snowluma:v2.2.0` | `sha256:34b4ec03738a698231cbad39c5650747330f5a96d953494fb6c12e1273974c0b` | `sha256:c5dce8095b09b510c432f642e14ee069479f2ffaee7871d70ad7e6c882b381c1` |

Compose 同时固定版本标签、索引摘要和 `linux/amd64` 平台。SnowLuma 官方 Docker Framework 源码核验提交为 `3f388b17f8baf47b4c2c9606b8a3121eb8599fef`。镜像是发布方构建的 QQ 桌面、Xvfb、noVNC 和进程注入环境；本项目不重打包 QQ 或 SnowLuma。

## 调用接口

部署资产可上传至固定目录 `/opt/aipm-dafeiyu`。目录可以预先创建并上传这些文件，但不能已经存在 `private/` 或 `deployment.json`。首次初始化只读取一次标准输入 JSON，唯一字段是 `deepseekApiKey`；模型名必须通过显式参数给出。

```text
python3 /opt/aipm-dafeiyu/prepare.py --directory /opt/aipm-dafeiyu --model deepseek-flash
stdin: {"deepseekApiKey":"由工作台专用凭据经 SSH 标准输入传入"}
stdout: {"ok":true,"directory":"/opt/aipm-dafeiyu","botQQ":"872713341","ownerQQ":"3202619225"}
```

上面的 stdin 是接口说明，不是将真实 Key 写入终端命令的示例。工作台应通过 SSH 子进程的标准输入直接发送 JSON，禁止写进命令参数、环境变量、日志、临时共享文件或状态快照。初始化不读取本机 DSH、工作台或云端已有的任何 API Key，也不接受 `$ENV` 形式的 Key。空值会失败，已存在私有数据会失败，均不会回退到共用 Key。

初始化不会安装依赖、拉镜像或启动软件。它创建目录 `0700` 和 JSON 文件 `0600`，生成随机的内部 OneBot Token，写入官方配置，并保留两个官方后台的首次密码生成和设密流程。云端 `private/astrbot-data/cmd_config.json` 内的 API Key 按 AstrBot 原生格式明文持久化；云端没有 macOS safeStorage 加密。

```bash
bash /opt/aipm-dafeiyu/deploy.sh preflight /opt/aipm-dafeiyu
bash /opt/aipm-dafeiyu/deploy.sh check /opt/aipm-dafeiyu
bash /opt/aipm-dafeiyu/deploy.sh up /opt/aipm-dafeiyu
bash /opt/aipm-dafeiyu/deploy.sh status /opt/aipm-dafeiyu
bash /opt/aipm-dafeiyu/deploy.sh stop /opt/aipm-dafeiyu
```

`preflight` 只检查依赖、Docker 访问权限和 Compose 语法，不要求已有私有配置，应在发送 Key 前调用。`check` 进一步检查已有配置。`up` 才会拉取固定镜像并启动。脚本先确认 Ubuntu 22.04/24.04、x86_64、Python 3、Docker Engine 和 Compose 插件；缺少依赖时明确失败，不会执行安装器或 `curl | sh`。请使用 [Docker 官方 Ubuntu 安装说明](https://docs.docker.com/engine/install/ubuntu/)。脚本不连接 SSH、不创建服务器或云付费资源。

如果初始化完成后拉取镜像失败，只需重试 `up`，不能再次执行初始化。`deployment.json` 包含专用 Key 的 SHA-256 指纹 `modelKeyFingerprint`（文件为 `0600`，不含 Key），用于确认恢复目标。恢复前可执行 `python3 prepare.py --directory /opt/aipm-dafeiyu --verify --expected-key-sha256 <本机专用Key的SHA256>`，核对实际 Key、部署元数据和本机指纹一致。指纹不应作为用户界面状态返回；遇到陌生已有私有目录时仍应停止，不得自动接管或覆盖。

## 网络与原生登录

| 云端宿主绑定 | 服务 | 工作台访问方式 |
| --- | --- | --- |
| `127.0.0.1:6185` | AstrBot 原版后台 | SSH 本地转发至工作台选择的本地端口 |
| `127.0.0.1:5099` | SnowLuma 原版 WebUI | SSH 本地转发 |
| `127.0.0.1:6081` | noVNC QQ 桌面 | SSH 本地转发后由用户扫码 |
| 不发布宿主端口 | AstrBot OneBot `6199` | SnowLuma 在专属 Compose 网络连接 `ws://astrbot:6199/ws` |

不发布 OneBot HTTP `3000`、正向 WebSocket `3001`、原始 VNC `5900` 或 `6199` 到宿主。容器仍可主动访问 QQ 和 DeepSeek 服务。不要将云端 WebUI 端口加入公网安全组；SSH 隧道由工作台主进程维护，不应由网页直接接触 SSH 凭据。

首次 `up` 后，用户需要在官方界面完成协议确认、管理员首次设密以及 bot QQ `872713341` 扫码。AstrBot 管理员用户名为 `astrbot`，初始随机密码由官方启动日志提供；SnowLuma WebUI 用户名为 `admin`，临时密码与 noVNC 随机密码同样由其官方启动输出提供。工作台若需要展示初始密码，须把它当凭据处理，不将整段日志回传到公共日志或聊天记录。不要预设固定默认密码。Compose 未设置 `SNOWLUMA_ACCEPT_EULA` 或 `SNOWLUMA_ACCEPT_PRIVACY`。

SnowLuma WebUI 使用独立会话鉴权，不需要 LuckyLillia AuthToken 或 GitHub 年限审核。AstrBot 和 SnowLuma 均保留原生登录，不生成伪造 ticket，不把 OneBot Token 当后台登录 Token。SnowLuma 的 `X-Frame-Options: DENY` 禁止 iframe；工作台应使用隔离的原生 WebContentsView/浏览器页。

固定 AstrBot `v4.29.3` 已采用 `/api/v1`：`POST /api/v1/auth/login` 接收 `username`、`password`（启用 2FA 时还需原生流程），登录服务返回 JWT，并设置 HttpOnly 的 `astrbot_dashboard_jwt` Cookie；API 也接受 `Authorization: Bearer <JWT>`。`GET /api/v1/auth/setup-status` 用于原生首次设密流程；旧 `/api/auth` 入口仍作为兼容路由保留。不要使用仅官方桌面会话可访问的 `desktop-session` 入口绕过登录。

SnowLuma `v2.2.0` 是 `POST /api/login`，`Content-Type: application/json`，请求包含 `password`，成功返回 `success`、`token`、`mustChangePassword`；后续 API 使用 `X-SnowLuma-Token`（兼容 Bearer）。其 `/avatar` Cookie 仅供头像访问，不能代替 API 会话鉴权。第一次登录、强制换密和协议确认交给原生页面；这里只列接口供状态集成核对，不自动登录或创建后台 Token。

## 官方配置字段

AstrBot `v4.29.3` 的 `AstrBotConfig` 会递归补全未提供的官方默认值。初始化只填以下经过固定版本源码核验的选项。

- `platform` 仅一个 `aiocqhttp`，`id=dafeiyu-qq`、`ws_reverse_host=0.0.0.0`、`ws_reverse_port=6199`，随机 `ws_reverse_token`。
- `provider_sources` 仅 `dafeiyu-deepseek`，`type=openai_chat_completion`、`provider_type=chat_completion`、`provider=deepseek`、`api_base=https://api.deepseek.com/v1`，`key` 是专用 Key 数组。
- 初始化时 `provider` 仅 `dafeiyu-chat`，通过 `provider_source_id=dafeiyu-deepseek` 引用该来源，模型为显式指定的 `deepseek-flash`。DeepSeek [官方文档](https://api-docs.deepseek.com/quick_start/pricing/) 当前确认此模型名可用；未发送模型请求验证用户 Key、额度或聊天质量。
- **固定版本的默认模型选择字段是 `agent_runner.config.model.provider_id=dafeiyu-chat`**，runner 为 `local`，`fallback_provider_ids=[]`。不要混用旧版 `provider_settings.default_provider_id`。`provider_pool` 也只包含这个专用模型，`reachability_check=false`，初始化不自动验证模型。
- `platform_settings.enable_id_white_list=true`，白名单只有 `dafeiyu-qq:FriendMessage:3202619225`。`wl_ignore_admin_on_group=false`、`wl_ignore_admin_on_friend=false`，防止管理员绕过；`no_permission_reply=false`，不向范围外用户发权限提示。`admins_id` 只有 `3202619225`。不添加任何群会话，默认不回复群。

网页搜索初始化为关闭。原版后台开启 `provider_settings.web_search=true` 时，恢复校验要求 `websearch_provider=deepseek`，并且 `websearch_deepseek_key` 必须是只含上述专用聊天 Key 的显式单元素数组；缺失、环境变量引用、其它 Key 或多个 Key 均会拒绝。搜索与网页抓取使用 AstrBot v4.29.3 的原生 DeepSeek 路径，不接工作台共享凭据；搜索关闭时不校验未使用的搜索配置，也不会自动开启搜索或发起测试请求。

恢复校验允许下面的可选辅助配置；它们必须直接保存在原版 `provider` 列表中，不得引用非空 `provider_source_id`。AstrBot v4.29.3 的提供商 API 把这类完整配置追加到 `provider`，只有带来源引用的模型才会合并 `provider_sources`，且模型字段会覆盖来源字段。因此 `provider_sources` 仍只能有唯一的 `dafeiyu-deepseek`，聊天模型不得自行覆盖 Key、接口、请求头或代理，默认选择和模型池仍只指向 `dafeiyu-chat`，不接受备用聊天模型。新增配置不会修改专用聊天 Key 指纹，重复标识、其它聊天来源、未知辅助提供商和未知辅助字段都会拒绝。

| 可选 `provider.id` | 必须保持的原生配置 |
| --- | --- |
| `大肥鱼记忆-本机` | `type=openai_embedding`、`provider=openai`、`provider_type=embedding`；`embedding_api_base=http://ollama:11434/v1`，`embedding_api_key=ollama` 只是本机占位值，`embedding_model` 只能为 `bge-m3` 或 `bge-m3:567m-fp16`，`embedding_dimensions=1024`，不得配置额外代理或聊天凭据 |
| `大肥鱼语音-Edge` | `type=edge_tts`、`provider=microsoft`、`provider_type=text_to_speech`；仅允许原版语音、语速、音量、音高和超时参数，不接受 Key、自定义接口或来源引用；本阶段不自动启用 Edge |
| `大肥鱼语音-豆包` | 作者包的 `type=seed_audio_tts`、`provider=volcengine`、`provider_type=text_to_speech`；接口固定 `https://openspeech.bytedance.com/api/v3/tts/create`，`resource_id` 和 `model` 都为 `seed-audio-1.0`，`credentials_file` 必须为空；`app_id` 与 `access_key` 必须为单独申请的非空字面凭据，不得引用环境变量或复用 DeepSeek Key |

豆包额外接受作者包 `tools/import_dafeiyu.py` 的 `voice == "3"` 分支使用的 `seed_audio_persona`、`seed_audio_prompt_template`、`seed_audio_format`、`seed_audio_sample_rate`、`seed_audio_max_attempts`、`seed_audio_whole_reply`、`seed_audio_reply_probability` 和 `timeout`。提示模板只接受 `{persona}`、`{text}`，必须包含 `{text}`；本阶段输出格式为 `mp3`，采样率为 8000–48000 的整数，尝试次数为 1–5 的整数，整条回复开关为布尔值，触发概率为 0–1 的有限数值。原包默认的 24000 Hz、2 次、整条回复、0.33 概率和 60 秒超时均可通过。`seed_audio_tts` 来自作者插件，不是 AstrBot v4.29.3 内置模板；允许配置通过校验不代表插件已安装、语音凭据已开通或音频生成已验证。

本地语音扩展的可选字段 `seed_audio_reference_speaker` 只允许空字符串或总长不超过 160、格式为 `ICL_[A-Za-z0-9_]+` 的字面音色 ID，不得与专用聊天 Key 相同。恢复校验不接受 URL、音频数据、路径、环境变量引用、对象或其它参考音频字段；实际生成行为和限制见[固定参考音色说明](../extensions/seed-audio-owner-control/astrbot_plugin_seed_audio_tts/README.md)。

SnowLuma 的全局 `config/onebot.json` 没有网络适配器，只有 `config/onebot_872713341.json` 的 `networks.wsClients` 包含 `url=ws://astrbot:6199/ws`、`role=Universal`、`accessToken`、`reconnectIntervalMs=5000`、`messageFormat=array`、`reportSelfMessage=false`。账号配置设为 `mode=snapshot`，避免继承额外端点；错登其他账号不会获得这个反向 WS。`statusCommand.enabled=false`，避免其 `#sl` 状态回复绕过 AstrBot 白名单。`historySync.enabled=false`。

WebUI 可由用户改变配置；部署胶水不能将“容器运行”当作“QQ 已在线”或“模型已可用”。`deploy.sh up` 前会核对部署身份、白名单与独立默认模型。真实验收仍需确认 SnowLuma 指定账号在线、AstrBot OneBot 已连接，并由主人发起一次明确的 QQ 聊天。未经真实验收不显示“已验证”。

## 给工作台接入方

1. 先上传资产并执行 `preflight`。使用现有独立的本机 `credentials.bin` 获取大肥鱼 Key；仅在用户明确部署时，将其通过 SSH 标准输入发送给 `prepare.py`。不要上传共享 DSH `.env`、整个本机数据目录或其它 Key。
2. 通过 SSH 管理三个本地转发端口，嵌入原版后台。保存连接设置与安全状态即可，不复制人设、聊天或记忆功能。网页不应拥有工作台 IPC 凭据接口。
3. `status` 返回 Compose 进程状态，不代表应用已登录、QQ 已在线或模型调用成功。官方后台鉴权和首次密码流程需要独立处理。
4. 停止使用 `stop`；不要使用 `down --volumes` 或删除 `private/`。这里的专属目录保存 QQ 登录态、AstrBot 人格/历史和专用 Key。
5. 当前初始化接口只用于新实例；后续换 Key 应先停止 AstrBot，再原子更新同一专用 `provider_sources[].key`，保留其它原生配置，随后重启。不可重新执行初始化覆盖原生数据。

## 主要源码依据

- [AstrBot v4.29.3 Compose](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/compose.yml) 与 [发布镜像工作流](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/.github/workflows/docker-image.yml)
- [AstrBot 固定版本默认配置/DeepSeek 模板](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/config/default.py)、[配置补全及首次设密](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/config/astrbot_config.py)、[模型来源合并和默认选择](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/provider/manager.py)、[Agent Runner 选项](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/config/agent_runner.py)
- [AstrBot v4.29.3 提供商 API](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/dashboard/api/providers.py)、[配置存储服务](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/dashboard/services/config_service.py)、[OpenAI Embedding 原生字段](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/provider/sources/openai_embedding_source.py) 和 [Edge TTS 原生字段](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/provider/sources/edge_tts_source.py)
- [AstrBot 白名单实现](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/astrbot/core/pipeline/whitelist_check/stage.py) 与 [OneBot 连接说明](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.3/docs/zh/platform/aiocqhttp.md)
- [SnowLuma 官方 Docker Framework](https://github.com/SnowLuma/SnowLuma.Docker.Framework/tree/3f388b17f8baf47b4c2c9606b8a3121eb8599fef)、[v2.2.0 OneBot 配置](https://github.com/SnowLuma/SnowLuma/blob/v2.2.0/packages/onebot/src/config.ts)、[反向 WS 鉴权](https://github.com/SnowLuma/SnowLuma/blob/v2.2.0/packages/onebot/src/network/ws-client-adapter.ts)、[WebUI 登录](https://github.com/SnowLuma/SnowLuma/blob/v2.2.0/packages/core/src/webui/server.ts)
- [SnowLuma 官方对接 AstrBot 说明](https://github.com/SnowLuma/SnowLumaDocs/blob/main/content/docs/guide/connect-bot.mdx) 与 [Docker 部署说明](https://github.com/SnowLuma/SnowLumaDocs/blob/main/content/docs/guide/deploy/docker.mdx)
