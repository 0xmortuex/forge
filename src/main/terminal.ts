import { ipcMain } from 'electron'
import * as pty from 'node-pty'

const terms = new Map<number, pty.IPty>()
let nextId = 1

function getTerm(id: number): pty.IPty {
  const t = terms.get(id)
  if (!t) throw new Error(`No terminal with id ${id}`)
  return t
}

export function registerTerminal(): void {
  ipcMain.handle('term:create', (e, cwd: string, cols: number, rows: number) => {
    const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env['SHELL'] ?? '/bin/bash')
    const id = nextId++
    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>
    })
    const wc = e.sender
    term.onData((data) => {
      if (!wc.isDestroyed()) wc.send('term:data', id, data)
    })
    term.onExit(({ exitCode }) => {
      terms.delete(id)
      if (!wc.isDestroyed()) wc.send('term:exit', id, exitCode)
    })
    terms.set(id, term)
    return id
  })

  ipcMain.handle('term:write', (_e, id: number, data: string) => getTerm(id).write(data))
  ipcMain.handle('term:resize', (_e, id: number, cols: number, rows: number) => getTerm(id).resize(cols, rows))
  ipcMain.handle('term:kill', (_e, id: number) => getTerm(id).kill())
}

export function killAllTerminals(): void {
  for (const t of terms.values()) t.kill()
  terms.clear()
}
