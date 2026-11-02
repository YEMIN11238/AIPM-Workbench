import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'aipm-desktop-content-policy',
    transformIndexHtml(html) {
      if (process.env.AIPM_RESUME_DESKTOP_BUILD !== '1') return html
      return html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; font-src \'self\' data:; connect-src \'none\'; object-src \'none\'; base-uri \'self\'">')
    },
  }],
  base: './',
  define: process.env.AIPM_RESUME_DESKTOP_BUILD === '1' ? {
    'import.meta.env.VITE_AIHUBMIX_API_KEY': JSON.stringify(''),
    'import.meta.env.VITE_OPENROUTER_API_KEY': JSON.stringify(''),
  } : {},
})
