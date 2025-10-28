export type Topic = string;
export type Payload = any;

export type Subscriber = (
  payload: Payload,
  meta: { from?: string; reply?: (resp: any) => void; topic: string }
) => void | Promise<void>;

type MiddlewareContext = {
  topic: string;
  payload: any;
  next: () => Promise<void>;
  from?: string | null;
};

type Middleware = (ctx: MiddlewareContext) => Promise<void> | void;

type MiddlewarePhase = 'pre' | 'main' | 'post';

interface MiddlewareEntry {
  fn: Middleware;
  name?: string;
  priority: number;
  phase: MiddlewarePhase;
  topicPattern?: string;
  pluginName?: string;
  isolated?: boolean;
}

export interface BusOptions {
  authorize?: (actorPluginName: string | null, action: 'publish'|'subscribe', topic: Topic) => boolean | Promise<boolean>;
  debug?: boolean;
  wildcardSupport?: boolean;
}

export class MessageBus {
  private subs = new Map<string, Map<string, Subscriber>>();
  private authorize?: BusOptions['authorize'];
  private debug: boolean;
  private wildcardSupport: boolean;
  private middlewares: MiddlewareEntry[] = [];
  private lifecycle = new Map<string, Function[]>();

  constructor(opts: BusOptions = {}) {
    this.authorize = opts.authorize;
    this.debug = !!opts.debug;
    this.wildcardSupport = opts.wildcardSupport ?? true;
  }

  async subscribe(pluginName: string, topic: Topic, handler: Subscriber) {
    if (this.authorize) {
      const ok = await this.authorize(pluginName, 'subscribe', topic);
      if (!ok) throw new Error(`Subscription to "${topic}" denied for ${pluginName}`);
    }
    let m = this.subs.get(topic);
    if (!m) { m = new Map(); this.subs.set(topic, m); }
    m.set(pluginName, handler);
    return () => { m!.delete(pluginName); if (m!.size === 0) this.subs.delete(topic); };
  }

  private escapeRegex(s: string) { return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }

  private matchTopic(pattern: string, topic: string): boolean {
    if (!this.wildcardSupport) return pattern === topic;
    if (pattern === '*') return true;
    const regex = new RegExp('^' + this.escapeRegex(pattern).replace(/\\\*/g, '.*') + '$');
    return regex.test(topic);
  }

  listSubscribers() {
    const out: Record<string,string[]> = {};
    for (const [t, m] of this.subs.entries()) out[t] = Array.from(m.keys());
    return out;
  }

  use(fn: Middleware, opts?: { name?: string; priority?: number; phase?: MiddlewarePhase; topicPattern?: string; pluginName?: string; isolated?: boolean }) {
    const entry: MiddlewareEntry = { fn, name: opts?.name, priority: opts?.priority ?? 100, phase: opts?.phase ?? 'main', topicPattern: opts?.topicPattern, pluginName: opts?.pluginName, isolated: opts?.isolated ?? false };
    this.middlewares.push(entry);
    this.sortMiddlewares();
  }

  private sortMiddlewares() {
    const phaseOrder: Record<MiddlewarePhase, number> = { pre:1, main:2, post:3 };
    this.middlewares.sort((a,b) => phaseOrder[a.phase] - phaseOrder[b.phase] || a.priority - b.priority);
  }

  private resolveMiddlewares(topic: string) {
    return this.middlewares.filter(m => !m.topicPattern || this.matchTopic(m.topicPattern, topic));
  }

  on(event: string, fn: Function) {
    const arr = this.lifecycle.get(event) ?? [];
    arr.push(fn); this.lifecycle.set(event, arr);
  }

  private emit(event: string, ...args: any[]) {
    const arr = this.lifecycle.get(event) ?? [];
    for (const f of arr) { try { f(...args); } catch(e){} }
  }

  async publish(from: string | null, topic: Topic, payload?: Payload) {
    if (this.authorize) {
      const ok = await this.authorize(from, 'publish', topic);
      if (!ok) throw new Error(`Publish to "${topic}" denied for ${String(from)}`);
    }
    const mids = this.resolveMiddlewares(topic);
    const handlers = Array.from(this.subs.entries()).filter(([pat]) => this.matchTopic(pat, topic));
    const runHandlers = async () => {
      for (const [, map] of handlers) {
        for (const [, handler] of map.entries()) {
          try { await handler(payload, { from: from ?? undefined, topic }); } catch (e) { this.emit('onError', topic, e); }
        }
      }
    };

    const runMiddleware = async (index = 0) => {
      if (index < mids.length) {
        await mids[index].fn({ topic, payload, next: () => runMiddleware(index+1), from });
      } else {
        await runHandlers();
      }
    };

    try {
      this.emit('beforeDispatch', topic, payload);
      await runMiddleware();
      this.emit('afterDispatch', topic, payload);
    } catch (err) {
      this.emit('onError', topic, err);
    }
  }

  async request(from: string | null, topic: Topic, payload?: Payload, timeoutMs = 5000): Promise<any> {
    if (this.authorize) {
      const ok = await this.authorize(from, 'publish', topic);
      if (!ok) throw new Error(`RPC to "${topic}" denied for ${String(from)}`);
    }

    const responders: Promise<any>[] = [];
    for (const [pat, map] of this.subs.entries()) {
      if (!this.matchTopic(pat, topic)) continue;
      for (const [pluginName, handler] of map.entries()) {
        const p = new Promise((resolve, reject) => {
          try {
            const maybe = handler(payload, { from: from ?? undefined, topic, reply: (r:any) => resolve(r) });
            if (maybe instanceof Promise) maybe.then(resolve).catch(reject);
          } catch (e) { reject(e); }
        });
        responders.push(p);
      }
    }

    if (responders.length === 0) throw new Error(`No RPC handlers for topic "${topic}"`);
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('RPC timeout')); } }, timeoutMs);
      for (const p of responders) {
        p.then((r)=>{ if (!done){ done = true; clearTimeout(timer); resolve(r); } }).catch(()=>{});
      }
    });
  }
}