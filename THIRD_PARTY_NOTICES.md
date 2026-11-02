# 原创工作与第三方来源

## AIPM 的原创部分

张俊豪主导本项目的产品定位、需求与优先级、任务流程、工作台信息架构和界面设计，通过 AI 辅助开发实现 AIPM 的 Electron 宿主、任务与产物管理、主要模型配置、业务模块适配、受控桌面工具集成及验证规范。新增原创部分的权利见 COPYRIGHT.md。

使用开源执行框架和专用工具属于明确的实现选择。产品原创性在上述产品与应用工作中体现，不将 Pi、上游项目、模型或第三方算法描述为自行发明。

## 已采用的项目

| 项目 | 在 AIPM 中的作用 | 来源与许可 |
| --- | --- | --- |
| Pi Agent | Agent 会话、工具和执行框架 | [earendil-works/pi](https://github.com/earendil-works/pi) · 包内 LICENSE |
| Agent Blueprint | Agent 示例、组件、方案与骨架流程 | [hubooooooo/agent-blueprint](https://github.com/hubooooooo/agent-blueprint) · MIT，© Hubo |
| AI Product Starter Kit | 开发流程规则、PRD 与公开技术手册 | [hubooooooo/ai-product-starter-kit](https://github.com/hubooooooo/ai-product-starter-kit) · MIT |
| Lemo Opuscar | 代码视频风格和制片工具 | [lemomo-ai/lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) · 代码 MIT；演示资源另见 CREDITS |
| Motion Design Prompt Generator | 动效设计方法与 Remotion 模板 | [8533502-dev/deepseek-opus-motion-skill](https://github.com/8533502-dev/deepseek-opus-motion-skill) · MIT |
| painted-animation | 水彩角色与绘画动画方法 | [tuzhechen2005/opus-video-skills](https://github.com/tuzhechen2005/opus-video-skills) · MIT；模板部分含 John Heibel 署名 |
| AI PM Resume Clinic | 简历检查、编辑与 PDF 模板 | [Innate-Labs/ai-pm-resume-clinic](https://github.com/Innate-Labs/ai-pm-resume-clinic) · MIT |
| Electron / React / Mermaid 等 | 桌面、UI 与图表 | 各依赖包的许可证 |

上游固定提交、适配说明和原许可证保存在 app/integrations 的对应目录。运行副本在 app/*-engine。p5 与其它间接依赖按自身许可分发，保留其 notices。大肥鱼依赖的云端组件和扩展另见 app/companion/upstream.json 与各扩展许可证。

## 未公开的内容

个人 Key、账号凭据、聊天、简历、公司报告、生成的视频和配乐均不包含在发布内容中。课程私有资料和用户提供的公司调研包不随仓库公开。模型权重、浏览器、FFmpeg 等运行二进制需由使用者按照各自来源和许可配置。

本项目使用的 DeepSeek 名称、模型与服务属于对应提供方，项目不表示官方关联或背书。
