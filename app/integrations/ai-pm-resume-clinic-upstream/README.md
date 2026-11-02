<div align="center">

# AI PM Resume Clinic · AI 产品经理简历批改台

**AI-powered resume review, editing & beautiful PDF export — built for product managers.**

为产品经理打造的 AI 简历批改、编辑与精美 PDF 导出工具。

[![Live Demo](https://img.shields.io/badge/Live-Demo-black?logo=github)](https://innate-labs.github.io/ai-pm-resume-clinic/)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](./LICENSE)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

[**🚀 Try it live · 在线体验**](https://innate-labs.github.io/ai-pm-resume-clinic/)

</div>

---

## ✨ Features · 功能

- **🩺 AI Review · AI 批改** — Paste your resume and get structured, scored feedback against PM-specific review criteria. · 粘贴简历，按产品经理专属维度获得结构化、可打分的批改建议。
- **📝 Resume Editor · 简历编辑器** — A rich Markdown editor to draft and refine your resume. · 内置富文本 / Markdown 编辑器，边写边改。
- **🎨 Template Library · 模板库** — 8 polished PDF templates (classic, modern, minimalist, creative, editorial, elegant, timeline, left-right). · 8 套精修 PDF 模板，一键切换风格。
- **📄 One-click PDF Export · 一键导出 PDF** — Export a print-ready resume directly from the browser. · 浏览器内直接导出可打印的 PDF。

---

## 🛠 Tech Stack · 技术栈

React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · Radix UI · Zustand · Tiptap / Vditor · Framer Motion · html2pdf

LLM access via [AiHubMix](https://aihubmix.com).

---

## 🚀 Getting Started · 快速开始

```bash
# 1. Clone · 克隆
git clone https://github.com/Innate-Labs/ai-pm-resume-clinic.git
cd ai-pm-resume-clinic

# 2. Install · 安装依赖
npm install

# 3. Configure · 配置环境变量
cp .env.example .env
# 在 .env 中填入你的 AiHubMix API Key:
# VITE_AIHUBMIX_API_KEY=your_aihubmix_key_here

# 4. Run · 启动开发服务器
npm run dev
```

Then open the printed local URL in your browser. · 然后在浏览器打开终端输出的本地地址。

### Scripts · 常用命令

| Command | Description |
|---|---|
| `npm run dev` | Start dev server · 启动开发服务器 |
| `npm run build` | Type-check & build for production · 类型检查并打包 |
| `npm run preview` | Preview the production build · 预览生产构建 |
| `npm run lint` | Lint the codebase · 代码检查 |

---

## 🤝 Contributing · 贡献

Issues and pull requests are welcome! · 欢迎提 issue 和 PR。

## 📄 License · 许可

[MIT](./LICENSE) © [Innate Labs](https://github.com/Innate-Labs)
