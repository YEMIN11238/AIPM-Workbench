# Harness 架构与代码导览

## 四个层次

| 层次 | 职责 | 代码入口 |
| --- | --- | --- |
| 桌面交互 | 聊天、侧栏、项目、模型选择与产物展示 | app/v2/app.mjs、app/v2/modules.mjs |
| ORVYN Harness | IPC 来源校验、生命周期、权限、任务限制与模块适配 | app/main.mjs、app/pi-ipc.mjs |
| Pi 执行 | 在项目上下文中调用文件、编辑、命令及工作台工具 | app/pi-service.mjs、app/pi-worker.mjs |
| 专用任务 | 产品开发、Blueprint、调研、GEO、视频及简历 | app/*-service.mjs、app/resume-clinic/ |

## 从一句需求到产物

1. 界面将指令提交给当前会话，草稿和已有对话按会话保留。
2. 宿主确定工作目录、当前模型与执行限制，再启动隔离的 Pi worker。
3. worker 调用模型与工具，通过受限消息向宿主请求桌面操作或工作台方法。
4. 重要操作等待用户确认；结果与实际文件进入执行记录。
5. 用户在专页或产物列表核对结果，继续修改或者进入下一阶段。

## 关键模块

- `model-api.mjs` 与 `model-ipc.mjs` 管理主要模型路由和持久选择。大肥鱼作为独立远程后台，保留独立凭证。
- `pi-execution-limits.mjs` 与 `pi-cost-guard.mjs` 处理执行限制和费用上界；估算并非供应商实账。
- `computer-service.mjs` 与 `native-computer.mm` 读取辅助功能、截取窗口及执行支持的桌面动作，受 macOS 授权限制。
- `starter-service.mjs` 管理开发阶段、决策、证据和真人确认。
- `blueprint-product-service.mjs` 与 Python bridge 适配上游方案、骨架与验证流程。
- `company-research-service.mjs`、`company-research-report.mjs` 管理调研来源、报告版本与导出。
- `video-studio-service.mjs` 和 `video-studio-production.mjs` 将模型创作交接给本机制片；`video-media.mjs` 为播放器提供受限媒体读取。
- `resume-clinic-loader.mjs` 按需加载完整简历宿主，独立模块未安装完整时在页内报错，不阻断工作台启动。

## 状态与数据

数据默认写入用户目录，不放在 Git checkout。公司调研和视频分别绑定自身会话与版本；专用产品开发保存阶段记录。不同模块目前并不共享一个全局阶段状态，也没有统一的全产品成功率。

主要模型密钥留在 Electron 主进程，桌面页面通过受限 IPC 调用。应用使用系统加密机制保存凭据。公开仓库不包含已保存密钥或私人项目。

## 公开版运行适配

`runtime-paths.mjs` 解析 Node、Pi 包和数据目录，移除了作者机器的必需绝对路径。依赖在根目录安装，源码位于 app/。macOS 原生桥由 `build-native.mjs` 本机编译，`.app` 构建仍加载本 checkout，并非已经签名公证的独立安装包。

## ORVYN 名称兼容

公开名称为 ORVYN。现有应用标识、内部 IPC 与媒体协议、AIPM_* 环境变量和数据目录继续沿用，避免影响已有安装。macOS 启动时先保留旧名称供 Electron 初始化 Safe Storage，再在 ready 事件切换为 ORVYN；已有加密凭据无需重写。
