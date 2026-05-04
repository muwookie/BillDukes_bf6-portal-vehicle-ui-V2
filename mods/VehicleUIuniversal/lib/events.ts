// Events system from bf6-portal-utils v1.4.0
// Stripped of import/export for namespace bundling
// Minimal version: only includes OnPlayerUIButtonEvent (used by UI v8 button registry)

namespace Events {
    type Handler = (...args: any[]) => void | Promise<void>;

    const _logging = new Logging('Events');
    const _handlers = new Map<string, Set<Handler>>();

    export const LogLevel = Logging.LogLevel;

    export function setLogging(
        log?: (text: string) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeError?: boolean
    ): void {
        _logging.setLogging(log, logLevel, includeError);
    }

    function _subscribe(eventName: string, handler: Handler): () => void {
        if (!_handlers.has(eventName)) {
            _handlers.set(eventName, new Set());
        }
        _handlers.get(eventName)!.add(handler);
        return () => _unsubscribe(eventName, handler);
    }

    function _unsubscribe(eventName: string, handler: Handler): void {
        _handlers.get(eventName)?.delete(handler);
    }

    function _trigger(eventName: string, ...args: any[]): void {
        const handlers = _handlers.get(eventName);
        if (!handlers) return;
        for (const handler of handlers) {
            CallbackHandler.invoke(handler, args as any, eventName, _logging, Logging.LogLevel.Error);
        }
    }

    function _handlerCount(eventName: string): number {
        return _handlers.get(eventName)?.size ?? 0;
    }

    // Channel interface used by v8 UI
    export interface EventChannel {
        subscribe(handler: Handler): () => void;
        unsubscribe(handler: Handler): void;
        trigger(...args: any[]): void;
        handlerCount(): number;
    }

    function makeChannel(name: string): EventChannel {
        return {
            subscribe: (h: Handler) => _subscribe(name, h),
            unsubscribe: (h: Handler) => _unsubscribe(name, h),
            trigger: (...args: any[]) => _trigger(name, ...args),
            handlerCount: () => _handlerCount(name),
        };
    }

    // ----- Channels -----
    // Lifecycle / engine events that the bundle subscribes to. The top-level
    // Portal export functions in main.script.ts just call X.trigger(...).
    export const OnGameModeStarted     = makeChannel('OnGameModeStarted');
    export const OnPlayerDeployed      = makeChannel('OnPlayerDeployed');
    export const OnPlayerUndeploy      = makeChannel('OnPlayerUndeploy');
    export const OnPlayerDied          = makeChannel('OnPlayerDied');
    export const OnVehicleSpawned      = makeChannel('OnVehicleSpawned');
    export const OnVehicleDestroyed    = makeChannel('OnVehicleDestroyed');
    export const OnPlayerEnterVehicle  = makeChannel('OnPlayerEnterVehicle');
    export const OnPlayerExitVehicle   = makeChannel('OnPlayerExitVehicle');
    export const OnPlayerUIButtonEvent = makeChannel('OnPlayerUIButtonEvent');
}
