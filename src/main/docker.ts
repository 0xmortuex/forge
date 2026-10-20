import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { ipcMain } from 'electron'
import { argsFor, composeFileOf, parseContainers, parseImages, type Container, type ContainerAction, type DockerImage } from './dockerparse'

// Docker through its CLI (containers, images, logs). Forge starts nothing on its own: every action is the user's click.
// Tests point FORGE_DOCKER at a script that stands in for docker.

export interface DockerStatus {
  installed: boolean
  /** Whether the daemon answered. */
  running: boolean
  version: string
  message: string
  /** The compose file in the project folder, if there is one. */
  composeFile: string | null
}

interface Result {
  stdout: string
  stderr: string
  code: number
}

function runDocker(cwd: string, args: string[]): Promise<Result> {
  const script = process.env['FORGE_DOCKER']
  const [command, argv, env] = script
    ? [process.execPath, [script, ...args], { ...process.env, ELECTRON_RUN_AS_NODE: '1' }]
    : ['docker', args, process.env]
  return new Promise((done, fail) => {
    execFile(command, argv, { cwd, env, maxBuffer: 32 * 1024 * 1024, timeout: 60000, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      const code = (err as (Error & { code?: unknown }) | null)?.code
      if (err && typeof code !== 'number') {
        return fail(new Error(code === 'ENOENT' ? 'Docker is not installed (the docker command was not found).' : `docker: ${err.message}`))
      }
      done({ stdout, stderr, code: typeof code === 'number' ? code : 0 })
    })
  })
}

async function docker(cwd: string, args: string[]): Promise<string> {
  const { stdout, stderr, code } = await runDocker(cwd, args)
  if (code !== 0) throw new Error(`docker ${args[0] ?? ''} failed: ${(stderr.trim() || stdout.trim()).split('\n').slice(0, 4).join(' ')}`)
  return stdout
}

export async function dockerStatus(root: string): Promise<DockerStatus> {
  let names: string[] = []
  try {
    names = await readdir(root)
  } catch {
    // an unreadable folder just has no compose file
  }
  const composeFile = composeFileOf(names)
  let info: Result
  try {
    info = await runDocker(root, ['info', '--format', '{{.ServerVersion}}'])
  } catch (err) {
    return { installed: false, running: false, version: '', message: err instanceof Error ? err.message : String(err), composeFile }
  }
  if (info.code !== 0) return { installed: true, running: false, version: '', message: 'Docker is installed but not running. Start Docker Desktop (or the docker service).', composeFile }
  return { installed: true, running: true, version: info.stdout.trim(), message: '', composeFile }
}

export function registerDocker(): void {
  ipcMain.handle('docker:status', (_e, root: string) => dockerStatus(root))
  ipcMain.handle('docker:containers', async (_e, root: string): Promise<Container[]> => parseContainers(await docker(root, ['ps', '-a', '--format', '{{json .}}'])))
  ipcMain.handle('docker:images', async (_e, root: string): Promise<DockerImage[]> => parseImages(await docker(root, ['images', '--format', '{{json .}}'])))
  ipcMain.handle('docker:action', async (_e, root: string, action: ContainerAction, id: string): Promise<void> => {
    await docker(root, argsFor(action, id))
  })
  ipcMain.handle('docker:removeImage', async (_e, root: string, id: string): Promise<void> => {
    if (!/^[\w][\w.:/@-]*$/.test(id)) throw new Error(`Not an image id or name: ${id}`)
    await docker(root, ['rmi', id])
  })
  ipcMain.handle('docker:logs', async (_e, root: string, id: string): Promise<string> => {
    argsFor('start', id) // validates the id
    const { stdout, stderr, code } = await runDocker(root, ['logs', '--tail', '1000', id])
    if (code !== 0) throw new Error(`docker logs failed: ${stderr.trim().split('\n').slice(0, 3).join(' ')}`)
    return stdout + stderr // a container's stderr is part of its log
  })
}
