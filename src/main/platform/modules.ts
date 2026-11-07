// Everything in the backend is a module: a unit with an id, the modules it needs, and the services it provides.
// Modules activate at startup or the first time one of their services is asked for, in dependency order, and can be
// unloaded again (refused while another active module still needs them).

export type Dispose = () => void | Promise<void>

export interface ModuleInstance {
  /** The objects behind the service names this module declared in `provides`. */
  services?: Record<string, object>
  dispose?: Dispose
}

export interface ModuleContext {
  /** Another module's service, activating its module first. Only modules listed in `requires` may be asked. */
  service<T extends object = object>(name: string): Promise<T>
  /** Sends a message to everyone subscribed to the topic (the UI included). */
  publish(topic: string, payload: unknown): void
}

export interface ModuleDescriptor {
  id: string
  /** Module ids that must be active first. */
  requires?: string[]
  /** Service names this module implements; each name may be provided by only one module. */
  provides?: string[]
  /** `startup`: activated by `startup()`. `lazy`: activated when one of its services is first requested. */
  activation: 'startup' | 'lazy'
  activate(ctx: ModuleContext): ModuleInstance | Promise<ModuleInstance>
}

export class Bus {
  private readonly subs = new Map<string, Set<(payload: unknown) => void>>()
  private readonly taps = new Set<(topic: string, payload: unknown) => void>()

  subscribe(topic: string, cb: (payload: unknown) => void): () => void {
    let set = this.subs.get(topic)
    if (!set) this.subs.set(topic, (set = new Set()))
    set.add(cb)
    return () => void set.delete(cb)
  }

  /** Sees every message on every topic (used to forward them to the UI). */
  tap(cb: (topic: string, payload: unknown) => void): () => void {
    this.taps.add(cb)
    return () => void this.taps.delete(cb)
  }

  /** A failing subscriber must not stop the others: its error is rethrown afterwards, once everyone has been told. */
  publish(topic: string, payload: unknown): void {
    const errors: unknown[] = []
    for (const cb of [...this.taps]) {
      try {
        cb(topic, payload)
      } catch (err) {
        errors.push(err)
      }
    }
    for (const cb of [...(this.subs.get(topic) ?? [])]) {
      try {
        cb(payload)
      } catch (err) {
        errors.push(err)
      }
    }
    if (errors.length) throw new AggregateError(errors, `Subscribers of "${topic}" failed`)
  }
}

interface Active {
  instance: ModuleInstance
}

export class ModuleRegistry {
  readonly bus = new Bus()
  private readonly modules = new Map<string, ModuleDescriptor>()
  private readonly providers = new Map<string, string>()
  private readonly active = new Map<string, Active>()
  private readonly pending = new Map<string, Promise<Active>>()

  register(desc: ModuleDescriptor): void {
    if (this.modules.has(desc.id)) throw new Error(`Module "${desc.id}" is already registered`)
    for (const name of desc.provides ?? []) {
      const owner = this.providers.get(name)
      if (owner) throw new Error(`Service "${name}" is provided by both "${owner}" and "${desc.id}"`)
    }
    this.modules.set(desc.id, desc)
    for (const name of desc.provides ?? []) this.providers.set(name, desc.id)
  }

  isActive(id: string): boolean {
    return this.active.has(id)
  }

  /** Activates every `startup` module (and what they need). One failing module does not hide the others' results. */
  async startup(): Promise<void> {
    const errors: unknown[] = []
    for (const m of this.modules.values()) {
      if (m.activation !== 'startup') continue
      try {
        await this.activate(m.id)
      } catch (err) {
        errors.push(err)
      }
    }
    if (errors.length) throw new AggregateError(errors, `${errors.length} startup module(s) failed`)
  }

  /** The implementation of a service, activating its module. Rejects for a name nobody provides. */
  async service<T extends object = object>(name: string): Promise<T> {
    const owner = this.providers.get(name)
    if (!owner) throw new Error(`No module provides the service "${name}"`)
    const { instance } = await this.activate(owner)
    const impl = instance.services?.[name]
    if (!impl) throw new Error(`Module "${owner}" declared the service "${name}" but did not return it`)
    return impl as T
  }

  activate(id: string, chain: string[] = []): Promise<Active> {
    const done = this.active.get(id)
    if (done) return Promise.resolve(done)
    if (chain.includes(id)) return Promise.reject(new Error(`Circular module dependency: ${[...chain, id].join(' -> ')}`))
    const running = this.pending.get(id)
    if (running) return running
    const desc = this.modules.get(id)
    if (!desc) return Promise.reject(new Error(`Unknown module "${id}"${chain.length ? ` (required by "${chain[chain.length - 1]}")` : ''}`))
    const p = this.start(desc, [...chain, id]).finally(() => this.pending.delete(id))
    this.pending.set(id, p)
    return p
  }

  private async start(desc: ModuleDescriptor, chain: string[]): Promise<Active> {
    for (const dep of desc.requires ?? []) await this.activate(dep, chain)
    const allowed = new Set(desc.requires ?? [])
    const ctx: ModuleContext = {
      service: async <T extends object>(name: string): Promise<T> => {
        const owner = this.providers.get(name)
        if (owner !== desc.id && (!owner || !allowed.has(owner))) {
          throw new Error(`Module "${desc.id}" asked for "${name}" without listing its provider in "requires"`)
        }
        return this.service<T>(name)
      },
      publish: (topic, payload) => this.bus.publish(topic, payload)
    }
    const instance = await desc.activate(ctx)
    const a: Active = { instance }
    this.active.set(desc.id, a)
    return a
  }

  /**
   * Disposes a module so it can be activated afresh. Refused while another active module requires it, unless
   * `cascade` is set, which unloads those dependents first.
   */
  async unload(id: string, opts: { cascade?: boolean } = {}): Promise<void> {
    if (!this.modules.has(id)) throw new Error(`Unknown module "${id}"`)
    const dependents = [...this.active.keys()].filter((other) => this.modules.get(other)?.requires?.includes(id))
    if (dependents.length && !opts.cascade) {
      throw new Error(`Cannot unload "${id}": still required by ${dependents.map((d) => `"${d}"`).join(', ')}`)
    }
    for (const d of dependents) await this.unload(d, opts)
    const a = this.active.get(id)
    if (!a) return
    this.active.delete(id)
    await a.instance.dispose?.()
  }

  /** Unloads everything, dependents before the modules they rely on. */
  async shutdown(): Promise<void> {
    const errors: unknown[] = []
    for (const id of [...this.active.keys()].reverse()) {
      try {
        await this.unload(id, { cascade: true })
      } catch (err) {
        errors.push(err)
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Some modules failed to shut down')
  }
}
