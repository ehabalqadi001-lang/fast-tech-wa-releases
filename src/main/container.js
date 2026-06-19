'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Simple service container for dependency injection.
 * Services are registered by name and resolved lazily.
 */
class Container {
    constructor() {
        this._services = new Map();
        this._factories = new Map();
    }
    register(name, instance) {
        this._services.set(name, instance);
        return this;
    }
    factory(name, fn) {
        this._factories.set(name, fn);
        return this;
    }
    get(name) {
        if (this._services.has(name))
            return this._services.get(name);
        if (this._factories.has(name)) {
            const svc = this._factories.get(name)();
            this._services.set(name, svc);
            return svc;
        }
        throw new Error(`[Container] Service not registered: ${name}`);
    }
    has(name) {
        return this._services.has(name) || this._factories.has(name);
    }
    /** Build the ServiceDeps object expected by IPC handlers */
    toDeps() {
        const safe = (name) => this.has(name) ? this.get(name) : null;
        return {
            db: this.get('db'),
            waApi: safe('waApi'),
            waSvc: safe('waSvc'),
            engine: this.get('engine'),
            scraper: safe('scraper'),
            scheduler: this.get('scheduler'),
            aiSvc: this.get('aiSvc'),
            excel: this.get('excel'),
            adapter: this.get('adapter'),
            webhookSrv: safe('webhookSrv'),
            antiBanSvc: safe('antiBanSvc'),
            seqSvc: safe('seqSvc'),
            ipcMain: this.get('ipcMain'),
        };
    }
}
exports.default = Container;
module.exports = Container;
