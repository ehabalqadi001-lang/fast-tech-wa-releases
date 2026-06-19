'use strict';

import type { ServiceDeps } from './types';

/**
 * Simple service container for dependency injection.
 * Services are registered by name and resolved lazily.
 */
class Container {
  private _services: Map<string, any> = new Map();
  private _factories: Map<string, () => any> = new Map();

  register(name: string, instance: any): this {
    this._services.set(name, instance);
    return this;
  }

  factory(name: string, fn: () => any): this {
    this._factories.set(name, fn);
    return this;
  }

  get<T = any>(name: string): T {
    if (this._services.has(name)) return this._services.get(name) as T;
    if (this._factories.has(name)) {
      const svc = this._factories.get(name)!();
      this._services.set(name, svc);
      return svc as T;
    }
    throw new Error(`[Container] Service not registered: ${name}`);
  }

  has(name: string): boolean {
    return this._services.has(name) || this._factories.has(name);
  }

  /** Build the ServiceDeps object expected by IPC handlers */
  toDeps(): ServiceDeps {
    const safe = (name: string) => this.has(name) ? this.get(name) : null;
    return {
      db:          this.get('db'),
      waApi:       safe('waApi'),
      waSvc:       safe('waSvc'),
      engine:      this.get('engine'),
      scraper:     safe('scraper'),
      scheduler:   this.get('scheduler'),
      aiSvc:       this.get('aiSvc'),
      excel:       this.get('excel'),
      adapter:     this.get('adapter'),
      webhookSrv:  safe('webhookSrv'),
      antiBanSvc:  safe('antiBanSvc'),
      seqSvc:      safe('seqSvc'),
      ipcMain:     this.get('ipcMain'),
    };
  }
}

export default Container;
module.exports = Container;
