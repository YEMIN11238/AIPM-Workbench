/** Bundle the renderer material layer and adapt the supplied logo for macOS. */
import { build } from 'esbuild'
import sharp from 'sharp'
import { mkdir, copyFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const directory = fileURLToPath(new URL('.', import.meta.url))
await import('./build-native.mjs')
const assets = join(directory, 'assets')
await mkdir(assets, { recursive: true })
const source = join(assets, 'logo-source.jpg')
try { await access(source) }
catch (error) {
  if (error.code !== 'ENOENT') throw error
  throw new Error('Missing assets/logo-source.jpg; restore the project logo before building.')
}
const logo = await sharp(source).trim({ threshold: 15 }).resize(576, 576, { fit: 'inside', background: '#fff' }).png().toBuffer()
await sharp(logo).resize(128, 128, { fit: 'contain', background: '#fff' }).toFile(join(assets, 'logo.png'))
const tile = Buffer.from(`<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="20" stdDeviation="22" flood-color="#40454e" flood-opacity=".18"/></filter></defs><rect x="62" y="62" width="900" height="900" rx="200" fill="#f4f5f6" filter="url(#s)"/><rect x="69" y="69" width="886" height="886" rx="195" fill="#fff" stroke="#e4e6e9" stroke-width="3"/></svg>`)
const appIcon = join(assets, 'app-icon.png')
await sharp(tile).composite([{ input: logo, gravity: 'center' }]).png().toFile(appIcon)
const iconset = join(assets, 'AIPM.iconset')
await mkdir(iconset, { recursive: true })
for (const size of [16, 32, 128, 256, 512]) {
  await sharp(appIcon).resize(size, size).toFile(join(iconset, `icon_${size}x${size}.png`))
  await sharp(appIcon).resize(size * 2, size * 2).toFile(join(iconset, `icon_${size}x${size}@2x.png`))
}
execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(assets, 'AIPM.icns')])
await build({ entryPoints: [join(directory, 'glass.jsx')], outfile: join(assets, 'glass.js'), bundle: true, format: 'esm', platform: 'browser', target: 'chrome130', minify: true, legalComments: 'linked', define: { 'process.env.NODE_ENV': '"production"' } })
await build({ entryPoints: [join(directory, 'document-format.mjs')], outfile: join(assets, 'document-format.js'), bundle: true, format: 'esm', platform: 'browser', target: 'chrome130', minify: true, legalComments: 'linked' })
await build({ entryPoints: [join(directory, 'blueprint-diagrams.mjs')], outfile: join(assets, 'blueprint-diagrams.js'), bundle: true, format: 'esm', platform: 'browser', target: 'chrome130', minify: true, legalComments: 'linked' })
console.log('Liquid glass bundle, logo and macOS icons built.')
