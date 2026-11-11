# 本地运行与可选资源

## 环境要求

- macOS 是当前桌面平台。网页介绍可在其它平台打开。
- Node.js 24+ 与 npm；Pi 版本固定在 1.3.0。
- Xcode Command Line Tools、可用的 `node_api.h` 与支持当前材质接口的 macOS SDK。当前真实开发环境使用 macOS 26 或更新 SDK。
- Python 3。Blueprint 与文档抽取所需 Python 包见其各自 requirements。
- 自己的有效模型连接。打开页面和本地检查不等于发起模型请求。

## 启动桌面

```bash
npm ci
npm run build:ui
npm start
```

原生编译需要 `node_api.h`。脚本先检查 Node 安装的 include/node，再检查 ~/.local/node/include/node。如果你的 Node 发行方式未包含开发头文件，需要先补齐对应版本头文件。

应用设置中填写 Key。当前模型别名与能力由 app/model-api.mjs 的目录声明，供应商可能调整；本项目不保证别名在所有账户可用。

## 数据与覆盖参数

| 参数 | 用途 |
| --- | --- |
| AIPM_HOME | 数据根目录，默认 ~/Library/Application Support/AIPM-Workbench |
| AIPM_NODE | worker 使用的 Node 可执行文件，启动脚本自动传入 |
| AIPM_PI_PACKAGE | 可选的 Pi 包目录，默认从 npm 依赖解析 |
| AIPM_BLUEPRINT_PYTHON | 已安装 Blueprint 依赖的 Python 绝对路径 |
| AIPM_BLUEPRINT_ENV | 可选的独立 Blueprint .env 目标；默认不改写其它项目 |
| AIPM_LEMO_PYTHON | 可选的本地视频 Python 环境 |

辅助功能和屏幕录制由 macOS 按应用授权。源码构建或不同 app 实例可能需要单独授权。文件和命令任务与桌面权限分别处理。

## Blueprint 与开发流程

```bash
python3 -m venv "$HOME/.local/share/aipm-blueprint"
"$HOME/.local/share/aipm-blueprint/bin/pip" install -r app/integrations/agent-blueprint/requirements.txt
AIPM_BLUEPRINT_PYTHON="$HOME/.local/share/aipm-blueprint/bin/python" npm start
```

公开版的三份开发手册来自 ai-product-starter-kit 的 MIT 版本，保留原文与许可证；老师单独提供的文件没有公开。开发流程仍要求真人核对样例与确认阶段。

## 简历检查

该工具的源码与桌面适配保留在 app/integrations/ai-pm-resume-clinic-upstream。安装其依赖并运行 `npm run build:desktop` 生成 dist 后，在工作台侧栏打开。上游页面按需加载，模型请求接到工作台配置。PDF 与编辑器资源的完整准备步骤见其 ADAPTER.md 与 package.json。

## 视频制作

Lemo、Motion、painted-animation 的公开源码、许可证与宿主适配保留。重型模型、FFmpeg、浏览器和本机 Python 环境没有上传。

需要按相应引擎安装其 package.json 依赖及上游文档要求的本地工具。Lemo 的 runtime.json 应填写本机 Node、Python、ffmpeg、ffprobe 和浏览器路径，并在实测后设置 ready；离线语音还需取得上游许可的模型与声音文件。源码存在不代表已装好渲染环境。

宿主能创建项目、记录对话并报告环境缺项。完整渲染与语音使用前需完成引擎准备，详见上游目录 README 与 app/lemo-engine/README-WORKBENCH.md。

## 公司调研资料包

原使用者提供的 hjh-company-research 不包含明确的公开分发授权，因此不随本仓库上传。公司调研的宿主源码与页面仍在。使用完整资料检索和离线 HTML 报告前，将已授权的原包及其 SOURCE.json 放入 app/skills/hjh-company-research/。该目录的 README 说明保留，资料内容被 .gitignore 排除。

GEO 公开版使用简短的原创写作规则；课程资料仍保留在作者本机。

## 构建本地 app

```bash
npm run build:ui
npm run build:app
```

生成 dist/ORVYN.app。当前本地 app 加载当前 checkout，需要保留源码与依赖；不等同于可在任意机器直接运行的公证发行包。

## 预览介绍页

```bash
npm run site
```

打开终端输出的本机地址。介绍页无模型调用、无数据提交表单。

显示名称为 ORVYN，环境变量和默认数据目录沿用 AIPM 命名以兼容已有安装。构建后的应用为 dist/ORVYN.app；使用 `npm run build:app -- --install` 可安装到 /Applications/ORVYN.app。
