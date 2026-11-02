/** Build the file-based desktop page with renderer networking disabled. */
import { build } from 'vite'
await import('./prepare-desktop-assets.mjs')
process.env.AIPM_RESUME_DESKTOP_BUILD = '1'
await build()
