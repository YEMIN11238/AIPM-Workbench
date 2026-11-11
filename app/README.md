# ORVYN desktop

[中文](README.zh.md) | English

## Summary

A local macOS workbench for discussing, building and operating AI products. The independent `v2/` interface opens in a spacious chat, with projects and specialist tools available when needed. Chat and AI product development execute through the installed Pi Agent SDK 1.3.0; Pi can read and change project files, run commands, use workbench modules and operate supported desktop applications after permission is granted.

Chat, resume review, company research, video creation, discovery, Blueprint, GEO and AI product development share the saved DeepSeek API key and a durable global Flash/Pro selection, initially Pro. 大肥鱼 uses its own model credential. Existing product documents, evidence, Blueprint features, GEO workflows, starter-kit materials and conversation archives remain accessible. The original Harness Web and Desktop applications remain separate products.

## Contents

- [Using the workbench](#using-the-workbench)
- [A first example](#a-first-example)
- [Features and existing projects](#features-and-existing-projects)
- [Resume review](#resume-review)
- [Video creation](#video-creation)
- [Computer operation and permissions](#computer-operation-and-permissions)
- [Appearance and credentials](#appearance-and-credentials)
- [Local runtime and data](#local-runtime-and-data)
- [Build and checks](#build-and-checks)
- [Limits](#limits)

## Using the workbench

Open `~/工作台/AIPM工作台/ORVYN.app`. This local application loads the current source checkout, so keep the checkout and its installed runtimes in place. The application version is 0.4.0 and its main window loads [v2/index.html](v2/index.html), independently of the old renderer shell.

1. Open **设置** to check the shared connection. Pro is initially selected; the current model text and small arrow at the lower right of each composer switch directly between Flash and Pro. An existing key is retained when the key field is left blank; enter a key only to configure or replace it.
2. In **聊天**, choose a work directory when working on an existing project, then describe the outcome you want. A new conversation without a selected directory receives its own workspace. Enter sends; Shift+Enter inserts a line break; ⌘N starts a new conversation.
3. Read the streamed response in the conversation. Open **执行记录** for tool arguments, results and **产物**. Use **打开目录** to inspect actual files. The composer retains an unsent draft during updates or conversation switches within the current app session.
4. Use **停止执行** to stop an owned run. When **这一步需要你确认** appears, inspect the specific operation and choose **批准这次操作** or **不执行**.
5. Open **项目** to search and filter existing project types. Open **工具** for a structured workflow. Recent Pi conversations remain in the sidebar; specialist panels also offer **用 Pi 继续讨论**.

Long tasks have no overall execution deadline by default; **停止执行** remains available. Ordinary runs allow at most 120 model requests and 120,000 output tokens; [watercolor video turns](#watercolor-illustration-and-characters) use their own smaller execution and cost limits. Cumulative input remains measured, but the old combined 400,000-token input/output ceiling is no longer the default stopping condition. Pi compacts the effective context near 80,000 tokens while retaining the original session records. A reached execution ceiling displays its specific reason and usage with **继续执行** to resume. It does not indicate exhausted API credit; actual calls remain subject to provider billing. Individual commands and network requests retain their own timeout handling so stalled operations can return control.

## Switching models

Each chat input shows **Pro/Flash ⌄** at its lower right. Selection is saved locally in `model.json`, synchronized across modules, and retained after restart. Sending waits for a pending preference save; a failed save retains the prior model and unsent draft. Running tasks retain the model captured at their start; subsequent requests use the new choice.

Pro uses `deepseek-v4-pro`; Flash uses `deepseek-flash`. Current version labels and capabilities are in [model-api.mjs](model-api.mjs); the provider may update these models. The quick-video ledger snapshots each request's model prices. Switching neither reprices historical Pro calls nor resets trial records. The separately configured remote 大肥鱼 account retains its own credential and dashboard settings.

## A first example

Create a new chat and select an empty test folder. Send this instruction:

> Make a local AI product idea notebook in this directory. Inspect the files, then create a Chinese README and an index.html that can add and delete ideas and save them in browser localStorage. Run an available local check, explain exactly what passed, and start a managed local preview if needed. Do not publish or create cloud resources.

Pi can inspect, write and test files with its real local tools. Inspect **执行记录** and **产物**, open the directory, and verify the page yourself. Continue in the same chat to request a change. A model response alone does not establish that a file, test or preview exists.

For the full product workflow, open **工具 → AI 产品开发** and create a product, or import an existing Blueprint product/plan. Start with an idea or import a Markdown, text, DOCX or PDF requirement document. Work through PRD review, technical adaptation, backend MVP, production frontend, deployment and closure. Review actual outputs and unresolved decisions before manually advancing each stage; the agent cannot supply your acceptance or human sample scores.

## Features and existing projects

The project catalog reuses existing data directories. Navigation groups functions by task and retains their records.

| Capability | Entry in the new interface | Retained scope |
|---|---|---|
| Resume review | Left sidebar 简历检查 | Original AI PM Resume Clinic review, editing and eight PDF templates; shared model and local drafts |
| Video creation | Left sidebar 视频生成 | One conversation, large embedded playback, Lemo/Motion guidance, painted-animation watercolor, storyboard editing, assets, local production and selected-version export |
| Company and client research | 工具 → 公司与客户调研 | Company, client-visit and investor-visit modes at three depths; public web/PDF collection, sources, material imports, shared Pi conversation, reports, strict structural checks, versions and offline HTML exports |
| Product discovery and documents | 工具 → 产品梳理与文档 | Requirements, competitors, MVP, initiation and PRD; evidence, stage conversations, document search, editing, version history and manual stage acceptance |
| Agent Blueprint | 工具 → Agent Blueprint | Product loop, plan/review, static project audit, revision, verification and code skeleton; all 17 components, templates, evaluations and original source materials |
| Blueprint conversations | Blueprint → 原有对话记录 | Read existing context-linked conversations and continue the discussion in Pi |
| GEO content operations | 工具 → GEO 内容运营 | Customer facts, keywords, topics, main draft, four platform variants, human review and the nine-file export package |
| AI product development | 工具 → AI 产品开发 | Complete starter-kit workflow, PRD imports, decisions, real commands/tests/model samples, human scoring, previews, evidence and deployment configuration |
| Computer and local tools | 聊天; 工具 → 电脑与本地工具 | Pi file/search/terminal tools and native macOS application inspection and interaction |

Company research starts only when the user selects **开始调研** after creating a project. Its panel and main chat share the same Pi session, model configuration and execution history. Text, PDF, Word and screenshot imports can supplement public evidence and later meeting notes. Markdown is the content source for incrementing report versions and matching offline HTML, whose navigation, source anchors, folding and printing need no CDN; opening a source link uses the network. Structural checks do not establish factual accuracy. Unreadable pages, scanned PDFs and missing evidence remain explicit gaps. The original package and pinned dependencies are recorded in [skills/hjh-company-research/SOURCE.json](skills/hjh-company-research/SOURCE.json); data lives under the workbench's `公司与客户调研/` directory.

The three user-supplied manuals form one **AI 产品开发** capability: the general stack manual guides backend work, the frontend manual guides the production interface, and the deployment manual guides release and closure. **三份手册 · 同一个开发流程** opens their full text. Originals and source hashes live in [integrations/product-manuals/2026-10-21](integrations/product-manuals/2026-10-21/SOURCE.json); projects receive copies under `docs/手册/用户提供/`. The original starter-kit rules, PRD template and manuals remain under [integrations/ai-product-starter-kit](integrations/ai-product-starter-kit/SOURCE.json).

The six-stage state, decision ledger, sample ratings and human acceptance currently belong to dedicated projects under **工具 → AI 产品开发**. Main chat can read the same manuals on demand, but does not automatically bind its selected directory to a dedicated development project or share its stage and acceptance state. Stage descriptions and documents generated in main chat do not substitute for the dedicated workflow's durable state or human approval.

Plan/review and static audit generate draft reports; a static component match is not a runtime test. Blueprint's product loop provides separate code generation, revision and verification. GEO exports require human review and do not automatically publish. Development creates a separate target product workspace and does not replace the workbench itself.

## Resume review

Select **简历检查** in the left sidebar to open the locally bundled [AI PM Resume Clinic](https://github.com/Innate-Labs/ai-pm-resume-clinic). Its review, editor and eight PDF templates remain available. Review and optimization use the workbench's saved DeepSeek connection and current Flash/Pro choice; changing the model inside the tool updates the shared preference. The first opening has an empty draft and reads no existing resume or project material. Opening the page sends no model request.

Drafts use separate local page storage. The open page retains its current review result when hidden, so editing can continue after switching to other workbench pages. Model actions require an explicit click. Hosted optimization performs at most one revision and one follow-up review per click. PDF export opens the native save dialog; cancellation produces no file. Request failures retain the original resume. Upstream criteria and scores provide review suggestions; the author still checks factual accuracy before applying changes.

Original sources, pinned revision, license and adaptation records live under [integrations/ai-pm-resume-clinic-upstream](integrations/ai-pm-resume-clinic-upstream). An isolated native view exposes only model status/selection, completion and PDF saving; credentials remain in the main process. Local editing assets work offline, while AI review and optimization require network access and a configured shared model. Reopen ORVYN after a local integration update to load the new sidebar entry.

## Video creation

The primary **视频生成** entry now opens one workspace: one history list, an embedded conversation and a large actual-film player. Lemo, Motion, painted-animation and legacy tools are production capabilities behind that workflow. Enter a brief, optionally set duration/format and visual style, and select **开始制作** to create the project and explicitly send the first model request. Revisions, progress, versions and errors stay in that same project.

### Play inside the workbench

The **成片** area supports native playback, pause, volume, seeking and fullscreen. **放大预览** hides the conversation to enlarge the player; **返回对话** restores it. Streamed messages and production progress retain the player node and playback position. Version selection governs both preview and export; the previous film remains while a new version is being made.

The player streams checked, owned media through `aipm-media` with byte-range support. It never needs an external video application or accepts an arbitrary renderer-supplied filesystem path. Changed files, symbolic links, invalidated checks and incomplete candidates do not become approved films. Missing optional posters do not block a valid movie.

### Production and checks

The background workflow combines [Lemo Opuscar](https://github.com/lemomo-ai/lemo-opuscar)'s 59 styles, direction and production tools with [Motion Design Prompt Generator](https://github.com/8533502-dev/deepseek-opus-motion-skill)'s design guidance. Pi writes code using the selected Flash/Pro model and shared API key; style selection has an automatic default. Extra paid video services do not reuse the DeepSeek key. Existing Remotion source and outputs remain preserved.

Creation and revision follow source authoring → `finish_video` handoff → managed local production. Complete style and technical guides remain available on demand instead of injecting competing build, jury and render loops into every turn. A small keyframe review precedes submission; temporary-file cleanup is not a delivery requirement. The host validates the current project, run and authored source. An accepted submission ends model authoring before another provider request; rejected submissions can be corrected. Ordinary chat does not expose the handoff tool, and normal successful authoring completion remains supported. When a call/output ceiling pauses a turn that already produced a matching candidate film, the workbench attempts local completion once without another model request and reports the specific result. Missing candidates, cancellation, informational discussion and provider errors do not qualify as completed films.

After handoff, managed local production saves stills, checks text reading time, renders, mixes sound and probes the MP4, including image variation and non-silent audio. Only passed versions enter the player. Untouched starters, title-only edits, static/silent films and readability failures do not count as completed work. Errors retain the project and prior versions and appear in the same conversation. Informational discussion does not re-render; unchanged checked versions can be reused. A checked existing film can be reused when it follows source and audio edits; an older candidate cannot replace updated source. Later successful local production supersedes an earlier pause/cancellation in the project view while preserving chat execution history; newer failures remain visible.

These are mechanical quality checks, not human aesthetic approval or a guarantee of matching Opus-tuned demonstrations. Use the conversation to revise pacing, hierarchy, text or sound and review the result.

### Watercolor illustration and characters

In the same new-video form, open **视频设置 → 画面风格**. The default **按制作要求选择** selects painted-animation when a new brief contains `水彩插画`, `水彩动画` or `painted-animation`. Select **水彩角色动画 · painted-animation** explicitly for other watercolor wording, or **其他动效风格** for the existing motion workflow. The header identifies a watercolor project as **水彩角色动画**. Mentioning watercolor in an existing project's chat does not switch its engine or overwrite its authored film.

Watercolor projects use genuine local p5.js and p5.brush drawing with pigment, bleed and ink strokes. The shared DeepSeek model authors the scene code; this workflow does not call a diffusion video API. Storyboards, original-song clips, conversation, managed production, embedded preview and export remain in the same video project. Local rendering adds no model request; creation and revision requests are still metered, and the result is not guaranteed to match Opus demonstrations.

Each watercolor conversation turn has a ¥2 model-cost budget, at most 40 model requests and 60,000 output tokens. Before each request, the workbench reserves a conservative upper bound using its configured peak prices and bounded input/output; valid completed usage can reduce the estimate, while interrupted or unknown usage retains the full reservation. The project displays **本轮模型预算**, **已核算费用上界** and **待结算预留**. These figures estimate costs rather than report the provider's actual bill. An insufficient reservation pauses the next request and preserves progress; the limit applies per turn, not to the entire film or API balance. Only cost-protected turns disable hidden cache warming and nested paid model routes; ordinary chat and other workbench functions retain their existing behavior. Budgeted video authoring disables DeepSeek thinking so a single reply cannot spend its entire writing allowance on reasoning. New review images are compressed to at most 960 × 540 and 60,000 base64 bytes; this does not reduce rendered-film resolution or alter source images. Existing execution-session attachments retain their original size. A budgeted video request may use up to 20,000 output tokens, still bounded by the remaining turn allowance and model support. Reading-time checks await asynchronous drawing; a strictly literal empty text function is recorded as not applicable rather than passed. Explicit local generation can retry a cancelled attempt while retaining its record.

### Song segments and storyboard prompts

**先建音乐视频项目** creates an unsent project and retains its brief. Import MP3, WAV, M4A or FLAC through **歌曲与片段** or **♫ 歌曲**. Inputs accept minutes/seconds or seconds. Video duration changes only when **将视频时长同步为歌曲片段时长** is explicitly selected. Import, trimming, short fades and audition run locally without uploading the recording or issuing a model request. Original recordings, earlier clips and films remain retained.

Audio uses the same owned streaming protocol as the video player. Creation validates the selected clip against project duration. Final production uses the host-selected original audio instead of model-authored replacement music and rechecks source/clip digests before muxing. The audio selection participates in version fingerprints and source snapshots. Changing a recording or range requires a new film; an older version is not presented as an updated soundtrack.

The Lemo **分镜** view displays, copies and edits per-shot prompts, durations and transitions, with contiguous timing that totals the film duration. Saving updates reference data without a model request. Legacy quick-video editing and local storyboard rendering remain available.

### History, assets and export

Quick-video, Lemo and Motion history share one list. Continuing an old project creates an owned association while retaining its original UUID, messages, storyboard, assets and films; linked projects are deduplicated. Legacy storyboard text, colors, bullets, narration and image assignment remain editable, with free local **按分镜渲染**. Authored local animation can use **检查并生成本地成片**. An unfinished Remotion project cannot be converted to Canvas without model work; the application reports its actual state.

**素材与文件** holds imported screenshots and real artifacts; **历史版本** retains results. Export a selected film, source or bundle. New production versions use their own source snapshots so an old film is not paired with newer edits; quick-video history retains its original version project. Exports omit machine-specific browsers, Python, FFmpeg and node_modules; another computer needs the matching runtime.

New conversation sends use standard Pi billing on the shared API. Local production and playback add no model request. The earlier quick-video ¥5/three-request ledger is retained without reset and does not cover ordinary Pi chat. Opening the page never sends a paid request.

### Source and local runtimes

Lemo is pinned to commit `413a6bd6d78ebd3bdd5abaec9538a26867f890df`; complete text/styles/tools/demo source live under `integrations/lemo-opuscar-upstream/`, with the adapted runtime under `lemo-engine/`. Code/docs are MIT; demo media is CC BY 4.0 with specific voice exclusions. Preserve attribution/CREDITS for reused assets. Local 2D, Three.js, sound, SRT, muxing and fully offline English/Chinese Kokoro speech passed. Online Edge requires manual project consent. Whisper recognition models, HDRIs, extra sample libraries and some demo media remain task-specific downloads without background installation or publishing.

The original Motion package and seven design directions remain pinned at `dd0e05264a6cd7ad714c0899e17157584290bad4` under `integrations/motion-design-prompt-generator-upstream/` with licenses and source records. `motion-engine/` and `video-engine/` retain their independent Remotion runtimes and original data locations. New associations and state live under `视频工作区/`; strict versions live in each Lemo project's `.video-studio-production/`.

The complete [painted-animation skill](https://github.com/tuzhechen2005/opus-video-skills/tree/59744a69c7b916cfbe4c4ec84006b0c2f5e2fde1/skills/painted-animation) is pinned to `59744a69c7b916cfbe4c4ec84006b0c2f5e2fde1` under `integrations/painted-animation-upstream/`. Its original skill, animation guide, character expressions/views, music-video guidance, example, scaffold and renderer remain intact. [The host skill](skills/painted-animation/SKILL.md) adapts these resources to Pi; `painted-engine/` supplies p5 2.3.3 and p5.brush 2.2.3 locally. Each watercolor project keeps the drawing, character, timeline, karaoke and sheet modules under `painted/`, with a host rendering bridge. Upstream/template MIT notices and dependency licenses, including p5 LGPL-2.1 and p5.brush MIT, remain included.

## Computer operation and permissions

Open **电脑权限**, or **工具 → 电脑与本地工具 → 检查电脑权限**. macOS requires two separate grants by the user in **系统设置 → 隐私与安全**:

| Permission | Use |
|---|---|
| 辅助功能 / Accessibility | Read accessible application text and controls; perform supported click, text, key and scroll actions |
| 屏幕录制 / Screen Recording | Capture a selected application's window for review and local OCR |

Click **前往系统设置**, enable the appropriate ORVYN entry yourself, then click **我已授权，重新检查**. Some macOS versions require reopening the app before a grant takes effect. The agent cannot grant these permissions or approve its own operations. File, terminal and product tools remain usable without desktop permissions.

Computer operation uses native macOS Accessibility, application-window screenshots and local macOS Vision OCR. Pro uses Accessibility text and OCR without receiving screenshot pixels. Flash supports image input: Pi image reads and successful captures attach the actual image to the model request. Trusted captures are bounded, resized JPEGs; failures explicitly report that no image was sent. A result without an image attachment does not establish visual observation. Supported actions include app listing/launch, interface inspection, element clicking, text entry, keys, scrolling and screenshot-based coordinate actions. Actions require current observations of the target app; inspect the actual result after an action.

Permission status does not establish that an arbitrary app can be controlled. Custom canvases, inaccessible controls, OCR errors, secure fields and application-specific behavior can limit a task. System permission controls, Keychain controls and the workbench's own approval controls are restricted. A screenshot or an approval prompt does not establish successful clicking or typing; inspect the recorded result and target application.

Local verification on 2026-10-21 used real Pi and Pro through the new chat to create a test file, run a Python assertion, inspect a TextEdit window, click its document, enter verification text, re-inspect the result and capture the window. The AI Product Development workflow also saved its scoring rubric and stage report through real Pi calls; the demo remains at phase 0 awaiting product answers. Other applications and actual cloud deployment require task-specific verification.

## Appearance and credentials

**设置** retains Solid, Frosted and native Liquid Glass materials, Light/Dark/Follow System, and a shared 0–100% glass transparency value. Preferences persist across restarts. The independent v2 layout uses neutral surfaces and readable light/dark colors without the old global layout stylesheet. Native Liquid Glass requires macOS 26 or newer, and its appearance also depends on system transparency settings.

Chat, company research, video creation, discovery, Blueprint, GEO and AI product development use [model-api.mjs](model-api.mjs): DeepSeek Pro (`deepseek-v4-pro`) and Flash (`deepseek-flash`), with OpenAI-compatible and Anthropic-compatible adapters using the same saved key. The original standalone Blueprint configuration is synchronized with this route. Pi does not silently substitute credentials from an unrelated Pi login.

The model key is encrypted using Electron safeStorage, never returned to the renderer, and not displayed in the settings field. Deployment cloud credentials are separate and encrypted per project. A shared model API does not grant a cloud account, pay for resources or complete deployment. Enter cloud credentials through the dedicated configuration, not chat or generated files.

## Local runtime and data

Electron runs Pi in an owned Node subprocess through the real [pi-worker.mjs](pi-worker.mjs). Pi's session manager supplies persistent context and compaction, and its file/terminal tools perform local work. Chat uses [pi-service.mjs](pi-service.mjs); AI product development uses Pi by default through [starter-service.mjs](starter-service.mjs), with separate stage sessions and deterministic human acceptance checks. Specialized discovery, Blueprint and GEO services remain available through their panels and Pi's `workbench` tool; their internal engines are not all replaced by Pi. Python remains necessary for original Blueprint and document extraction, and the Python starter worker remains an explicit compatibility/test path rather than the default execution base.

This installation uses Node at `/Users/example/.local/node/bin/node`, Pi SDK 1.3.0 at `/Users/example/.local/node/lib/node_modules/@earendil-works/pi-coding-agent`, and private Python at `~/工作台/AIPM工作台/.app-data/blueprint-runtime/`. The original Blueprint Python runtime can be overridden with `AIPM_BLUEPRINT_PYTHON`. These local runtime locations must be adapted when moving to another computer.

Data stays under `~/工作台/AIPM工作台/`:

| Directory | Contents |
|---|---|
| `产品/<product>/` | `.aipm.json` metadata and stage conversations, `产出物/` Markdown, `.history/` document versions |
| `方案任务/` | Original plan/audit inputs, reports and execution records |
| `Blueprint产品/` | Existing product workspaces and separate action jobs |
| `Blueprint对话/` | Original Blueprint conversation archives |
| `GEO内容运营/` | Campaign facts, drafts, review state and exports |
| `视频工作区/` | Unified links, same-project conversations and checked version records |
| `视频创作/` | Quick-mode storyboards, chats, imported images, rendered versions and the durable trial budget ledger |
| `Lemo工程/<uuid>/` | Lemo Canvas/Three.js or `painted/` p5.brush source, audio/subtitle inputs, job records and local outputs |
| `动效工程/<uuid>/` | Full Motion Skill starter, original resources, TSX scenes, sound cues, stills and film outputs |
| `产品开发/<id>/workspace/` | Target product code, PRD, manuals, tests and stage evidence |
| `Pi对话/<id>/` | New conversations, SDK sessions, runs, artifacts and default workspace when no directory was selected |
| `.app-data/` | Encrypted credentials, saved appearance and private runtimes |

Selecting an existing folder makes it the conversation's actual work directory. Back up project files and workbench data before large changes; the app is not a general backup or version-control service.

## Build and checks

Local Lemo records live under `lemo-engine/tests/out/`; `service-smoke.json` records actual host-service stills, rendering, audio, subtitles, offline voice and muxing. Model interface checks use a local mock without additional paid requests for installation verification. New conversations show a concise brief; bound session context supplies engineering paths and protocols. Model tools return bounded text/log excerpts with full-file pointers while desktop resources and saved files remain complete.

Build on macOS with repository dependencies and Electron installed, Node API headers, and Xcode Command Line Tools with a macOS 26 or newer SDK. The build compiles the AppKit material bridge and Accessibility/Vision bridge for the current architecture. From the repository root:

```sh
node apps/aipm-desktop/build-ui.mjs
node apps/aipm-desktop/build-app.mjs
```

The build creates the local app above. `build-app.mjs --install` additionally installs `/Applications/ORVYN.app` and refuses to replace an unrelated app. The bundle includes Electron but still loads this checkout; UI changes apply on the next launch. Rebuild after changing Electron, native bridges or icons. Installation does not grant OS permissions or create cloud resources.

Focused interface checks run without a model key or desktop permission:

```sh
node --test apps/aipm-desktop/startup.test.mjs apps/aipm-desktop/resume-clinic-loader.test.mjs
node --test apps/aipm-desktop/v2/app.test.mjs apps/aipm-desktop/v2/modules.test.mjs
node --test apps/aipm-desktop/v2/resume-clinic.test.mjs apps/aipm-desktop/resume-clinic/host.test.mjs apps/aipm-desktop/resume-clinic/preload.test.mjs
```

The resume adapter's keyless tests and rebuild instructions are in [ADAPTER.md](integrations/ai-pm-resume-clinic-upstream/ADAPTER.md). An isolated Electron check on 2026-10-29 also loaded the actual local UI, initialized its offline editor, restored a synthetic draft, completed a mock review, synchronized the shared model, retained the page after navigation, restored the view after Escape, opened all eight template choices and exported from the actual PDF editor with synthetic cached data. PDF generation used a stubbed save-dialog destination. It used no real key or provider request; actual model quality and native save-dialog interaction were not tested.

These checks exercise chat drafts/streams/approvals, navigation and module access using test adapters. They do not establish real model behavior, desktop input success or cloud deployment. Validate those separately in the actual installed app and inspect the resulting files or target application.

## 大肥鱼 companion

The **大肥鱼后台** sidebar entry displays the original AstrBot dashboard through an SSH tunnel. Its isolated native `WebContentsView` has no workbench preload and allows only the local forwarding origin; changing servers creates a separate dashboard login partition. Chat, Projects and Tools retain their existing interface and model connection.

The current QQ deployment follows [niania风浪太大咧~'s tutorial](https://www.douyin.com/video/7699913996312399119): official AstrBot v4.29.3 and SnowLuma v2.2.0 run on a dedicated Ubuntu 22.04/24.04 x86_64 cloud server, with image tags and digests pinned. The Mac manages this server rather than running Linux QQ locally. See [companion/cloud/README.md](companion/cloud/README.md) for assets, configuration sources, ports and login steps. Deployment and connection wait until a server is configured; local installation does not establish QQ connectivity.

Local connection data lives in `~/工作台/AIPM工作台/大肥鱼/`. The independent API key remains encrypted in its own `credentials.bin`; `cloud-settings.json` stores server settings and the SSH identity path without copying the private key. Explicit deployment sends only the dedicated model key through SSH stdin into `/opt/aipm-dafeiyu`. AstrBot persists the key in its native cloud configuration format, without macOS safeStorage encryption. Workbench credentials, DSH configuration and repository `.env` files are not uploaded, and no fallback to the workbench key exists. Persona, example dialogue and conversation history use AstrBot's original interface; create the 大肥鱼 persona there during initial setup.

Connect and disconnect controls manage only the local SSH tunnel; closing the workbench does not stop cloud services. Cloud dashboards and the QQ desktop bind to loopback addresses and are accessed through forwarding. Initial SSH requires a verified host key, while users complete native password setup, terms confirmation and QQ scanning. Initial access permits owner `3202619225` to privately message bot `872713341`. Bilibili, Douyin and shared long-term memory are not connected.

The previous local QQ Bridge, LLBot, dedicated DSH and SQLite data remain inactive and are no longer launched from this entry; no memory migration into AstrBot is claimed. Offline checks establish connection-management and configuration behavior only. Real verification requires running cloud services, the intended QQ account online, AstrBot connected to the gateway and an owner-initiated QQ conversation receiving a model reply. Reachable ports alone never establish QQ online status.

The [local control entry point](companion/CONTROL.md) forwards explicit status, connection, deployment and console-navigation requests to the existing app instance. It accepts no model keys or arbitrary commands, creates no network control port, and writes filtered results to private request directories.

## Limits

- This is a local macOS installation, not a portable signed distribution or a cross-platform desktop agent.
- Pi runs with the local process's filesystem and command privileges. Work-directory selection and operation checks do not provide a complete OS sandbox. External sending, payment, publication, irreversible deletion and permission changes require concrete user approval; review the displayed operation.
- Model replies and reports can be incomplete or wrong. Evidence checks, GEO review, stage acceptance and sample scores remain user actions. Real model samples alone are not product end-to-end tests.
- Model/network failures, execution budgets and cancellation can leave partial files. Stop does not roll back earlier changes; inspect the run and workspace before continuing. Restart preserves records and marks unfinished chat runs as interrupted.
- Local previews are managed processes with explicit stop controls. Deployment additionally needs a real cloud account, project configuration, permissions and approval for actual resource operations; an installed module or completed plan does not mean a product is online.

## Branding compatibility

The public name is ORVYN. Existing data paths, bundle identifiers, internal protocols and the macOS encryption namespace are retained, so saved model connections and projects do not require migration. The application name switches after Electron initializes system encryption.
