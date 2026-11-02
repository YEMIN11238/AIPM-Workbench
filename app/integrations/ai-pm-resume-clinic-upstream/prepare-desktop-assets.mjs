/** Copy pinned Vditor runtime files for editing without a CDN connection. */
import { cp, mkdir, copyFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
const directory = fileURLToPath(new URL('.', import.meta.url))
const source = join(directory, 'node_modules/vditor/dist')
const destination = join(directory, 'public/vendor/vditor/dist')
await mkdir(destination, { recursive: true })
await cp(source, destination, { recursive: true, filter(path) {
  const name = relative(source, path), first = name.split(sep)[0]
  return first !== 'ts' && first !== 'types' && !name.endsWith('.map') && !name.endsWith('.d.ts')
} })
await copyFile(join(directory, 'node_modules/vditor/LICENSE'), join(destination, '../LICENSE'))
