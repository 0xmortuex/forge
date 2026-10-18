import net from 'node:net'

/** Minimal Debug Adapter Protocol client over TCP: Content-Length framed JSON. */
export class DapClient {
  private seq = 1
  private buf = Buffer.alloc(0)
  private pending = new Map<number, { resolve: (body: any) => void; reject: (err: Error) => void }>()
  private closed = false
  private lastError: Error | null = null
  onEvent: (event: string, body: any) => void = () => undefined
  onClose: () => void = () => undefined

  private constructor(private socket: net.Socket) {
    socket.on('data', (d) => this.onData(d))
    socket.on('close', () => this.handleClose())
    socket.on('error', (err) => {
      this.lastError = err // 'close' follows; pending requests are rejected there with this as the reason
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
        return new DapClient(socket)
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
      const body = JSON.stringify({ seq, type: 'request', command, arguments: args })
      this.socket.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    })
  }

  close(): void {
    this.socket.destroy()
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

  private dispatch(msg: { type: string; request_seq?: number; success?: boolean; message?: string; body?: any; event?: string }): void {
    if (msg.type === 'event') return this.onEvent(msg.event ?? '', msg.body ?? {})
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
