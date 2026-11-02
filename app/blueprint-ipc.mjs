/** Register the fixed Blueprint IPC methods on the existing verified renderer channel. */
import { readFile } from 'node:fs/promises'
import { studioCopy as copy } from './studio-copy.mjs'

/** Bind Blueprint actions; native pickers read only explicitly selected text files. */
export function registerBlueprintIpc({ handle, service, dialog, window, shell }) {
  handle('blueprintStatus', () => service.status())
  handle('blueprintList', () => service.list())
  handle('blueprintStart', input => service.start(input))
  handle('blueprintGet', id => service.get(id))
  handle('blueprintReadReport', (id, name) => service.readReport(id, name))
  handle('blueprintCancel', id => service.cancel(id))
  handle('blueprintResume', id => service.resume(id))
  handle('blueprintOpenFolder', async id => {
    const directory = await service.resolveFolder(id)
    const error = await shell.openPath(directory)
    if (error) throw new Error(error)
  })
  handle('blueprintPick', async kind => {
    if (!['project', 'idea', 'prd'].includes(kind)) throw new Error(copy.invalidPicker)
    const directory = kind === 'project'
    const result = await dialog.showOpenDialog(window(), {
      title: directory ? copy.folderPicker : kind === 'prd' ? copy.prdPicker : copy.ideaPicker,
      properties: [directory ? 'openDirectory' : 'openFile'],
      ...(directory ? {} : { filters: [{ name: copy.textFiles, extensions: ['md', 'txt'] }] }),
    })
    if (result.canceled || !result.filePaths.length) return null
    const path = result.filePaths[0]
    if (directory) return { path }
    const text = await readFile(path, 'utf8')
    if (text.length > 60000) throw new Error(copy.textTooLarge)
    return { path, text }
  })
}
