import net from 'node:net'
import type { ChildProcess } from 'node:child_process'

/** The two ends of a connection to a debug adapter: a socket, or the stdin / stdout of the adapter process. */
interface Transport {
  write(data: string): void
  destroy(): void
  onData(cb: (chunk: Buffer) => void): void
  onClose(cb: () => void): void
  onError(cb: (err: Error) => void): void
}

/** Minimal Debug Adapter Protocol client: Content-Length framed JSON over TCP or over a process's stdio. */
export class DapClient {
  private seq = 1
  private buf = Buffer.alloc(0)
  private pending = new Map<number, { resolve: (body: any) => void; reject: (err: Error) => void }>()
  private closed = false
  private lastError: Error | null = null
  onEvent: (event: string, body: any) => void = () => undefined
  onClose: () => void = () => undefined

  private constructor(private io: Transport) {
    io.onData((d) => this.onData(d))
    io.onClose(() => this.handleClose())
    io.onError((err) => {
      this.lastError = err // 'close' follows; pending requests are rejected there with this as the reason
    })
  }

  /** Speaks DAP over the standard input and output of an adapter process that is already started. */
  static fromProcess(child: ChildProcess): DapClient {
    const { stdin, stdout } = child
    if (!stdin || !stdout) throw new Error('The debug adapter was started without pipes')
    return new DapClient({
      write: (data) => void stdin.write(data),
      destroy: () => {
        stdin.destroy()
        stdout.destroy()
      },
      onData: (cb) => void stdout.on('data', cb),
      onClose: (cb) => {
        stdout.on('close', cb)
        child.on('exit', cb)
      },
      onError: (cb) => {
        stdin.on('error', cb) // writing to an adapter that has exited
        stdout.on('error', cb)
      }
    })
  }

  /** Connects, retrying while the adapter starts up. Rejects after `timeoutMs` or when `aborted()` turns true. */
  static async connect(port: number, timeoutMs: number, aborted: () => boolean): Promise<DapClient> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (aborted()) throw new Error('Debug session ended before the debugger connected')
      try {
        const socket = await new Promise<net.Socket>((resolve, reject) => {
          const s = net.connect(port, '127.0.0.1')
          s.once('connect', () => resolve(s))
          s.once('error', reject)
        })
        return new DapClient({
          write: (data) => void socket.write(data),
          destroy: () => socket.destroy(),
          onData: (cb) => void socket.on('data', cb),
          onClose: (cb) => void socket.on('close', cb),
          onError: (cb) => void socket.on('error', cb)
        })
      } catch (err) {
        if (Date.now() > deadline) throw new Error(`Could not connect to the debug adapter on port ${port}: ${(err as Error).message}`)
        await new Promise((r) => setTimeout(r, 150))
      }
    }
  }

  request<T = any>(command: string, args: object = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('Debug adapter connection is closed'))
      const seq = this.seq++
      this.pending.set(seq, { resolve, reject })
      this.send({ seq, type: 'request', command, arguments: args })
    })
  }

  close(): void {
    this.io.destroy()
  }

  private send(message: object): void {
    const body = JSON.stringify(message)
    this.io.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk])
    for (;;) {
      const sep = this.buf.indexOf('\r\n\r\n')
      if (sep < 0) return
      const header = /Content-Length: (\d+)/i.exec(this.buf.subarray(0, sep).toString('ascii'))
      if (!header) throw new Error('Malformed DAP header')
      const len = Number(header[1])
      if (this.buf.length < sep + 4 + len) return
      const msg = JSON.parse(this.buf.subarray(sep + 4, sep + 4 + len).toString('utf8'))
      this.buf = this.buf.subarray(sep + 4 + len)
      this.dispatch(msg)
    }
  }

  private dispatch(msg: { type: string; seq?: number; command?: string; request_seq?: number; success?: boolean; message?: string; body?: any; event?: string }): void {
    if (msg.type === 'event') return this.onEvent(msg.event ?? '', msg.body ?? {})
    if (msg.type === 'request') {
      // A request from the adapter (runInTerminal, startDebugging...). Forge supports none of them, and an adapter that is
      // not answered waits for ever, so say no.
      this.send({
        seq: this.seq++,
        type: 'response',
        request_seq: msg.seq ?? 0,
        success: false,
        command: msg.command ?? '',
        message: `Forge does not support the "${msg.command ?? ''}" request`
      })
      return
    }
    if (msg.type !== 'response' || msg.request_seq === undefined) return
    const p = this.pending.get(msg.request_seq)
    if (!p) return
    this.pending.delete(msg.request_seq)
    if (msg.success) p.resolve(msg.body ?? {})
    else p.reject(new Error(msg.message || 'Request failed'))
  }

  private handleClose(): void {
    if (this.closed) return
    this.closed = true
    const why = this.lastError ? `: ${this.lastError.message}` : ''
    for (const p of this.pending.values()) p.reject(new Error(`Debug adapter connection closed${why}`))
    this.pending.clear()
    this.onClose()
  }
}
