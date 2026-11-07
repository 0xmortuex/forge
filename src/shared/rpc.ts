// Typed request/response protocol between the UI and the backend. It knows nothing about Electron: the transport is
// just a function that carries a request to a RpcServer and brings the response back (IPC today, a socket for a
// remote backend later).

export interface RpcRequest {
  service: string
  method: string
  args: unknown[]
}

export type RpcResponse = { ok: true; value: unknown } | { ok: false; error: string }

/** Finds the object that implements a service, activating whatever module provides it. Rejects for unknown services. */
export type ServiceResolver = (service: string) => Promise<object>

export class RpcServer {
  constructor(private readonly resolve: ServiceResolver) {}

  /** Never rejects: every failure travels back to the caller as `{ ok: false, error }`. */
  async dispatch(req: RpcRequest): Promise<RpcResponse> {
    try {
      if (typeof req?.service !== 'string' || typeof req.method !== 'string' || !Array.isArray(req.args)) {
        throw new Error('Malformed RPC request')
      }
      // Only own, public methods are callable: no "constructor", "__proto__", "toString" or "_private" tricks.
      if (req.method.startsWith('_')) throw new Error(`${req.service}.${req.method} is not callable`)
      const impl = await this.resolve(req.service)
      const fn: unknown = Object.getOwnPropertyDescriptor(impl, req.method)?.value ?? lookupPrototypeMethod(impl, req.method)
      if (typeof fn !== 'function') throw new Error(`${req.service} has no method "${req.method}"`)
      return { ok: true, value: await (fn as (...a: unknown[]) => unknown).apply(impl, req.args) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

/** Methods of a class instance live on its prototype chain, but never on Object.prototype. */
function lookupPrototypeMethod(impl: object, name: string): unknown {
  if (name === 'constructor') return undefined
  for (let p = Object.getPrototypeOf(impl) as object | null; p && p !== Object.prototype; p = Object.getPrototypeOf(p) as object | null) {
    const d = Object.getOwnPropertyDescriptor(p, name)
    if (d) return d.value
  }
  return undefined
}

export type Invoke = (req: RpcRequest) => Promise<RpcResponse>

/** Every method of a contract becomes async from the caller's side. */
export type Remote<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never }

/** A typed stand-in for a service: `client<FileIndexApi>('fileindex', invoke).query('main')`. */
export function client<T>(service: string, invoke: Invoke): Remote<T> {
  return new Proxy(
    {},
    {
      get:
        (_t, method) =>
        async (...args: unknown[]) => {
          if (typeof method !== 'string') throw new Error('RPC methods are named by strings')
          const res = await invoke({ service, method, args })
          if (!res.ok) throw new Error(res.error)
          return res.value
        }
    }
  ) as Remote<T>
}
