# AIPM desktop adapter

The upstream project is fixed at the commit in `SOURCE.json`. `upstream-source.tar.gz` preserves its complete unmodified source tree, including its MIT license. The extracted working source contains the desktop adaptation; it is not a new fork of the scoring criteria.

## Desktop build

Use Node 24 or newer. Run `npm ci --ignore-scripts --no-audit --no-fund`, then `npm run build:desktop`. This builds `dist/index.html` with relative asset paths, hash routes, local Vditor runtime files and a CSP that disables renderer network connections. Desktop builds explicitly replace frontend provider-key environment variables with empty strings. Ordinary `npm run build` retains standalone AIHubMix configuration and does not inject the desktop-only network policy.

The checked-in desktop runtime includes `dist/index.html`, `dist/assets/` and `dist/vendor/`. Keep this build output with the desktop source so opening the local app does not require installing dependencies or rebuilding. `node_modules/` remains ignored. `public/vendor/` preserves the locally served Vditor runtime files, and the asset preparation script can regenerate them from the pinned package.

## Host interface

The isolated desktop page uses `window.aipmResumeClinic.status()`, `selectModel(id)`, `complete(payload)`, `onModelUpdate(callback)` and `exportPdf({html})`. Status contains only configuration readiness, the selected model and model choices. Completion requests omit provider endpoints, credentials and model routing. The host obtains the current saved model and key for each request. PDF export passes the rendered resume to the host's isolated printing flow and save dialog.

Review, optimization and PDF organization share the workbench model. A pending model selection completes before a new request. Host mode does not fall back to a different provider. One optimization click performs at most one rewrite round and one review, while the standalone web mode retains upstream's three-round limit. Opening the desktop page does not send a model request. Selecting PDF creation is an explicit request to organize the source resume; subsequent PDF export prints the edited result locally.

The first desktop draft is empty. The review draft is stored under `aipm-resume-clinic-draft-v1` in the isolated page's local storage and is restored after navigation or reopening. No workbench documents, existing resumes or credentials are imported. The eight original PDF templates, original scoring prompts and source editing UI remain available.

## Checks

`npm run test:adapter` runs four keyless bridge tests: credentials do not enter renderer storage, requests wait for model selection, missing configuration stops before completion, and invalid output does not invoke another provider. `npm run build:desktop` includes TypeScript checking. Focused ESLint checks pass for the adapter and modified application files. The upstream-wide lint command still reports existing issues in unrelated Markdown helpers and PDF builder primitives; copied third-party Vditor runtime files are excluded from linting.
