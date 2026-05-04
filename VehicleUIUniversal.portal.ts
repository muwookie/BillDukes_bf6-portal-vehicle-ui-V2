// @ts-nocheck
// Vehicle UI Universal - drop-in vehicle deploy UI for BF6 Portal
// Strip is positioned lower (UI_PANEL_Y=110) to clear the in-game HUD
// Auto-generated bundle - DO NOT EDIT
// Generated: 2026-05-04T17:37:06.367Z


// ===== Module: lib/logging.ts =====
class Logging {
    constructor(tag: string) {
        this._tag = tag;
    }
    private _tag: string;
    private _logLevel: Logging.LogLevel = Logging.LogLevel.Info;
    private _includeError: boolean = false;
    private _logger?: (text: string) => Promise<void> | void;
    private _safeErrorToString(error: unknown): string {
        try {
            if (error instanceof Error) {
                try {
                    return error.message || 'Error';
                } catch {
                    return 'Error (message unavailable)';
                }
            }
            try {
                return String(error);
            } catch {
                return '[Error object]';
            }
        } catch {
            return '[Unable to stringify error]';
        }
    }
    public willLog(logLevel: Logging.LogLevel): boolean {
        return this._logger !== undefined && logLevel >= this._logLevel;
    }
    public log(text: string, logLevel: Logging.LogLevel = Logging.LogLevel.Warning, error?: unknown): void {
        if (!this._logger || logLevel < this._logLevel) return;
        try {
            const errorText = this._includeError && error ? ` - Error: ${this._safeErrorToString(error)}` : '';
            const result = this._logger(`<${this._tag}> ${text}${errorText}`);
            if (result instanceof Promise) {
                result.catch((error) => {
                    console.log(`<${this._tag}> Error in async logger:`, error);
                });
            }
        } catch (error: unknown) {
            console.log(`<${this._tag}> Error in sync logger:`, error);
        }
    }
    public setLogging(
        log?: (text: string) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeError?: boolean
    ): void {
        this._logger = log;
        this._logLevel = logLevel ?? Logging.LogLevel.Warning;
        this._includeError = includeError ?? false;
    }
}
namespace Logging {
    export enum LogLevel {
        Debug = 0,
        Info = 1,
        Warning = 2,
        Error = 3,
    }
}


// ===== Module: lib/callback-handler.ts =====
namespace CallbackHandler {
    export function invoke<T extends (...args: any[]) => Promise<void> | void>(
        callback: T | undefined,
        args: Parameters<T>,
        errorContext: string,
        logging: Logging,
        logLevel: Logging.LogLevel = Logging.LogLevel.Error
    ): void {
        if (!callback) return;
        try {
            const result = callback(...args);
            if (result instanceof Promise) {
                result.catch((error: unknown) => {
                    logging.log(
                        `Error in async ${errorContext} ${callback.name ?? 'anonymous'} callback:`,
                        logLevel,
                        error
                    );
                });
            }
        } catch (error: unknown) {
            logging.log(`Error in sync ${errorContext} ${callback?.name ?? 'anonymous'} callback:`, logLevel, error);
        }
    }
    export function invokeNoArgs(
        callback: (() => Promise<void> | void) | undefined,
        errorContext: string,
        logging: Logging,
        logLevel: Logging.LogLevel = Logging.LogLevel.Error
    ): void {
        invoke(callback, [] as any, errorContext, logging, logLevel);
    }
}


// ===== Module: lib/events.ts =====
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


// ===== Module: lib/solid-ui.ts =====
namespace SolidUI {
    const logging = new Logging('SolidUI');
    export const LogLevel = Logging.LogLevel;
    export function setLogging(
        log?: (text: string) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeError?: boolean
    ): void {
        logging.setLogging(log, logLevel, includeError);
    }
    class Subscriber {
        public dependencies = new Set<Set<Subscriber>>();
        constructor(public fn: () => void) {
            this.execute();
        }
        execute() {
            cleanup(this);
            context.push(this);
            try {
                this.fn();
            } finally {
                context.pop();
            }
        }
        dispose() {
            cleanup(this);
        }
    }
    export type Accessor<T> = () => T;
    export type Setter<T> = (newValue: T | ((prev: T) => T)) => void;
    type Constructable<Params, Instance> = new (params: Params) => Instance;
    type FunctionalComponent<Params, Instance> = (props: Reactive<Params>) => Instance;
    type Reactive<T> = {
        [K in keyof T]?: T[K] | Accessor<T[K]>;
    };
    function isPlainObject(obj: unknown): boolean {
        return obj !== null && typeof obj === 'object' && obj.constructor === Object;
    }
    function isEqual(a: unknown, b: unknown): boolean {
        if (a === b) return true;
        if (a == null || b == null) return false;
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; ++i) {
                if (!isEqual(a[i], b[i])) return false;
            }
            return true;
        }
        if (isPlainObject(a) && isPlainObject(b)) {
            const objA = a as Record<string, unknown>;
            const objB = b as Record<string, unknown>;
            const keysA = Object.keys(objA);
            const keysB = Object.keys(objB);
            if (keysA.length !== keysB.length) return false;
            for (const key of keysA) {
                if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
                if (!isEqual(objA[key], objB[key])) return false;
            }
            return true;
        }
        return false;
    }
    function isAccessor<T>(value: T): value is T & Accessor<T> {
        return typeof value === 'function';
    }
    function isClassConstructor(fn: unknown): boolean {
        if (typeof fn !== 'function') return false;
        if (fn.toString().substring(0, 5) === 'class') return true;
        if (fn.prototype && Object.getOwnPropertyNames(fn.prototype).length > 1) return true;
        return false;
    }
    const pendingEffects = new Set<Subscriber>();
    let isFlushPending = false;
    const MAX_FLUSH_CYCLES = 1_000;
    function flush(): void {
        isFlushPending = false;
        let cycles = 0;
        for (const sub of pendingEffects) {
            if (cycles++ > MAX_FLUSH_CYCLES) {
                pendingEffects.clear();
                logging.log(
                    'SolidUI: Maximum reactive stack depth exceeded. You might have an infinite loop in an effect.',
                    LogLevel.Error
                );
            }
            pendingEffects.delete(sub);
            try {
                sub.execute();
            } catch (error: unknown) {
                logging.log('Error in effect:', LogLevel.Error, error);
            }
        }
    }
    function schedule(subscribers: Set<Subscriber>): void {
        for (const sub of subscribers) {
            pendingEffects.add(sub);
        }
        if (isFlushPending) return;
        isFlushPending = true;
        Promise.resolve()
            .then(flush)
            .catch((error: unknown) => {
                logging.log('Error in flush:', LogLevel.Error, error);
            });
    }
    const context: (Subscriber | null)[] = [];
    let currentCleanupList: Set<() => void> | null = null;
    function cleanup(subscriber: Subscriber): void {
        for (const dependency of subscriber.dependencies) {
            dependency.delete(subscriber);
        }
        subscriber.dependencies.clear();
    }
    export function untrack<T>(fn: () => T): T {
        context.push(null);
        try {
            return fn();
        } finally {
            context.pop();
        }
    }
    export function createSignal<T>(initialValue: T): [Accessor<T>, Setter<T>] {
        const subscriptions = new Set<Subscriber>();
        let value = initialValue;
        const read: Accessor<T> = (): T => {
            const observer = context[context.length - 1];
            if (observer) {
                observer.dependencies.add(subscriptions.add(observer));
            }
            return value;
        };
        const write: Setter<T> = (newValue: T | ((prev: T) => T)): void => {
            const nextValue = typeof newValue === 'function' ? (newValue as (prev: T) => T)(value) : newValue;
            if (isEqual(value, nextValue)) return;
            value = nextValue;
            schedule(subscriptions);
        };
        return [read, write];
    }
    export function createEffect(fn: () => void): () => void {
        const effect = new Subscriber(fn);
        return () => effect.dispose();
    }
    export function createMemo<T>(fn: () => T): Accessor<T> {
        const [s, set] = createSignal<T>(fn());
        createEffect(() => set(fn()));
        return s;
    }
    export function createRoot<T>(fn: (dispose: () => void) => T): T {
        const previousCleanupList = currentCleanupList;
        const cleanupList = new Set<() => void>();
        currentCleanupList = cleanupList;
        const dispose = () => {
            cleanupList.forEach((c) => c());
            cleanupList.clear();
        };
        const result = fn(dispose);
        currentCleanupList = previousCleanupList;
        return result;
    }
    const storeSubscribers = new WeakMap<object, Map<string | symbol, Set<Subscriber>>>();
    function getStoreSubscribers(target: object, key: string | symbol): Set<Subscriber> {
        let objMap = storeSubscribers.get(target);
        if (!objMap) {
            objMap = new Map();
            storeSubscribers.set(target, objMap);
        }
        let keySet = objMap.get(key);
        if (!keySet) {
            keySet = new Set();
            objMap.set(key, keySet);
        }
        return keySet;
    }
    export function createStore<T extends object>(initialState: T): [T, (fn: (state: T) => void) => void] {
        const handler: ProxyHandler<object> = {
            get(target, key, receiver) {
                const value = Reflect.get(target, key, receiver);
                const observer = context[context.length - 1];
                if (observer) {
                    observer.dependencies.add(getStoreSubscribers(target, key).add(observer));
                }
                return typeof value === 'object' && value !== null ? new Proxy(value, handler) : value;
            },
            set(target, key, value, receiver) {
                const oldValue = Reflect.get(target, key, receiver);
                if (isEqual(oldValue, value)) return true;
                const result = Reflect.set(target, key, value, receiver);
                schedule(getStoreSubscribers(target, key));
                return result;
            },
        };
        const store = new Proxy(initialState, handler) as T;
        const setStore = (producer: (state: T) => void) => producer(store);
        return [store, setStore];
    }
    const contextValues = new Map<symbol, unknown[]>();
    export interface Context<T> {
        id: symbol;
        defaultValue: T;
        provide: (value: T, fn: () => void) => void;
    }
    export function createContext<T>(defaultValue: T): Context<T> {
        const id = Symbol('context');
        contextValues.set(id, []);
        return {
            id,
            defaultValue,
            provide(value: T, fn: () => void) {
                const stack = contextValues.get(id)!;
                stack.push(value);
                try {
                    fn();
                } finally {
                    stack.pop();
                }
            },
        };
    }
    export function useContext<T>(context: Context<T>): T {
        const stack = contextValues.get(context.id);
        return stack && stack.length > 0 ? (stack[stack.length - 1] as T) : context.defaultValue;
    }
    export function onCleanup(fn: () => void): void {
        currentCleanupList?.add(fn);
    }
    function setProperty<T>(instance: T, key: keyof T, value: unknown): void {
        try {
            (instance as unknown as Record<keyof T, unknown>)[key] = value;
        } catch {
        }
    }
    export function h<P extends object, T>(
        component: Constructable<P, T> | FunctionalComponent<P, T>,
        props: Reactive<P> = {}
    ): T {
        if (!isClassConstructor(component)) return (component as FunctionalComponent<P, T>)(props);
        const ClassConstructor = component as Constructable<P, T>;
        const previousCleanupList = currentCleanupList;
        const cleanupList = new Set<() => void>();
        currentCleanupList = cleanupList;
        const constructorParams: Record<string, unknown> = {};
        const dynamicBindings: { key: keyof P; signal: Accessor<unknown> }[] = [];
        for (const [key, value] of Object.entries(props)) {
            if (/^on[A-Z]/.test(key)) {
                constructorParams[key] = value;
                continue;
            }
            if (isAccessor(value)) {
                constructorParams[key] = value();
                dynamicBindings.push({ key: key as keyof P, signal: value });
            } else {
                constructorParams[key] = value;
            }
        }
        const instance = new ClassConstructor(constructorParams as P);
        dynamicBindings.forEach(({ key, signal }) => {
            const dispose = createEffect(() => {
                setProperty(instance, key as unknown as keyof T, signal());
            });
            onCleanup(dispose);
        });
        if (cleanupList.size > 0) {
            const instanceWithDelete = instance as { delete?: (...args: unknown[]) => unknown };
            const originalDelete = instanceWithDelete.delete;
            if (typeof originalDelete === 'function') {
                instanceWithDelete.delete = function (...args: unknown[]) {
                    cleanupList.forEach((fn) => fn());
                    cleanupList.clear();
                    return originalDelete.apply(this, args);
                };
            }
        }
        currentCleanupList = previousCleanupList;
        const instanceWithDelete = instance as { delete?: () => void };
        if (typeof instanceWithDelete.delete === 'function') {
            onCleanup(() => instanceWithDelete.delete!());
        }
        return instance;
    }
    export function Index<T>(each: Accessor<T[]>, render: (item: Accessor<T>, index: number) => unknown): void {
        const rows: { setItem: Setter<T>; dispose: () => void }[] = [];
        createEffect(() => {
            const list = each();
            const newLength = list.length;
            const oldLength = rows.length;
            if (newLength > oldLength) {
                for (let i = 0; i < oldLength; ++i) {
                    rows[i].setItem(list[i]);
                }
                for (let i = oldLength; i < newLength; ++i) {
                    createRoot((dispose) => {
                        const [item, setItem] = createSignal(list[i]);
                        const uiElement = render(item, i);
                        const rowDispose = () => {
                            dispose();
                            if (uiElement && typeof (uiElement as any).delete === 'function') {
                                (uiElement as any).delete();
                            }
                        };
                        rows.push({ setItem, dispose: rowDispose });
                    });
                }
                return;
            }
            if (newLength < oldLength) {
                for (let i = oldLength - 1; i >= newLength; --i) {
                    rows.pop()?.dispose();
                }
            }
            for (let i = 0; i < newLength; ++i) {
                rows[i].setItem(list[i]);
            }
        });
    }
}


// ===== Module: lib/ui-v8.ts =====
namespace UI {
    const logging = new Logging('UI');
    export const LogLevel = Logging.LogLevel;
    export function setLogging(
        log?: (text: string) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeError?: boolean
    ): void {
        logging.setLogging(log, logLevel, includeError);
    }
    type BaseParams = {
        anchor?: mod.UIAnchor;
        parent?: Parent;
        visible?: boolean;
        bgColor?: mod.Vector;
        bgAlpha?: number;
        bgFill?: mod.UIBgFill;
        depth?: mod.UIDepth;
        receiver?: mod.Player | mod.Team;
        uiInputModeWhenVisible?: boolean;
    };
    export type Size = {
        width: number;
        height: number;
    };
    export type Position = {
        x: number;
        y: number;
    };
    type EitherPosition =
        | ({ position?: Position } & { x?: never; y?: never })
        | ({ x?: number; y?: number } & { position?: never });
    type EitherSize =
        | ({ size?: Size } & { width?: never; height?: never })
        | ({ width?: number; height?: number } & { size?: never });
    export type ElementParams = BaseParams & EitherPosition & EitherSize;
    export type FinalElementParams = {
        name: string;
        parent: Parent;
        anchor: mod.UIAnchor;
        visible: boolean;
        bgColor: mod.Vector;
        bgAlpha: number;
        bgFill: mod.UIBgFill;
        depth: mod.UIDepth;
        x: number;
        y: number;
        width: number;
        height: number;
        receiver: GlobalReceiver | TeamReceiver | PlayerReceiver;
        uiInputModeWhenVisible: boolean;
    };
    export interface Parent {
        name: string;
        uiWidget: mod.UIWidget;
        receiver: GlobalReceiver | TeamReceiver | PlayerReceiver;
        children: Element[];
        attachChild(child: Element): void;
        detachChild(child: Element): void;
    }
    export interface Button {
        onClick: ((player: mod.Player) => Promise<void> | void) | undefined;
    }
    abstract class Receiver<T extends mod.Player | mod.Team | undefined> {
        protected _id: string;
        protected _nativeReceiver: T;
        protected _inputModeRequesters: Set<Element> = new Set();
        protected constructor(id: string, receiver: T) {
            this._id = id;
            this._nativeReceiver = receiver;
        }
        public get id(): string { return this._id; }
        public get nativeReceiver(): T { return this._nativeReceiver; }
        public get isInputModeRequested(): boolean { return this._inputModeRequesters.size > 0; }
        public addInputModeRequester(element: Element): void {
            const wasAlreadyRequested = this.isInputModeRequested;
            this._inputModeRequesters.add(element);
            if (wasAlreadyRequested) return;
            if (this._nativeReceiver) {
                mod.EnableUIInputMode(true, this._nativeReceiver);
            } else {
                mod.EnableUIInputMode(true);
            }
        }
        public removeInputModeRequester(element: Element): void {
            const wasAlreadyRequested = this.isInputModeRequested;
            this._inputModeRequesters.delete(element);
            if (!wasAlreadyRequested) return;
            if (this.isInputModeRequested) return;
            if (this._nativeReceiver) {
                mod.EnableUIInputMode(false, this._nativeReceiver);
            } else {
                mod.EnableUIInputMode(false);
            }
        }
    }
    export class GlobalReceiver extends Receiver<undefined> {
        public static readonly instance = new GlobalReceiver();
        private constructor() { super('g', undefined); }
    }
    export class TeamReceiver extends Receiver<mod.Team> {
        private static _instances = new Map<number, TeamReceiver>();
        private constructor(receiver: mod.Team) {
            const id = mod.GetObjId(receiver);
            super(`t${id}`, receiver);
            TeamReceiver._instances.set(id, this);
        }
        public static getInstance(receiver: mod.Team): TeamReceiver {
            return TeamReceiver._instances.get(mod.GetObjId(receiver)) ?? new TeamReceiver(receiver);
        }
    }
    export class PlayerReceiver extends Receiver<mod.Player> {
        private static _instances = new Map<number, PlayerReceiver>();
        private constructor(receiver: mod.Player) {
            const id = mod.GetObjId(receiver);
            super(`p${id}`, receiver);
            PlayerReceiver._instances.set(id, this);
        }
        public static getInstance(receiver: mod.Player): PlayerReceiver {
            return PlayerReceiver._instances.get(mod.GetObjId(receiver)) ?? new PlayerReceiver(receiver);
        }
    }
    export abstract class Node {
        protected readonly _logging: Logging = logging;
        protected _name: string;
        protected _uiWidget: mod.UIWidget;
        protected _receiver: GlobalReceiver | TeamReceiver | PlayerReceiver;
        public constructor(
            name: string,
            uiWidget: mod.UIWidget,
            receiver: GlobalReceiver | TeamReceiver | PlayerReceiver
        ) {
            this._name = name;
            this._uiWidget = uiWidget;
            this._receiver = receiver;
        }
        public get name(): string { return this._name; }
        public get uiWidget(): mod.UIWidget { return this._uiWidget; }
        public get receiver(): GlobalReceiver | TeamReceiver | PlayerReceiver { return this._receiver; }
    }
    export class Root extends Node implements Parent {
        public static readonly instance = new Root();
        private _children: Set<Element> = new Set();
        private constructor() { super('root', mod.GetUIRoot(), GlobalReceiver.instance); }
        public get children(): Element[] { return Array.from(this._children); }
        public attachChild(child: Element): void { this._children.add(child); }
        public detachChild(child: Element): void { this._children.delete(child); }
    }
    export abstract class Element extends Node {
        protected _parent: Parent;
        protected _visible: boolean;
        protected _x: number;
        protected _y: number;
        protected _width: number;
        protected _height: number;
        protected _bgColor: mod.Vector;
        protected _bgAlpha: number;
        protected _bgFill: mod.UIBgFill;
        protected _depth: mod.UIDepth;
        protected _anchor: mod.UIAnchor;
        protected _uiInputModeWhenVisible: boolean;
        protected _deleted: boolean = false;
        public constructor(params: FinalElementParams) {
            super(params.name, mod.FindUIWidgetWithName(params.name) as mod.UIWidget, params.receiver);
            this._parent = params.parent;
            this._visible = params.visible;
            this._x = params.x;
            this._y = params.y;
            this._width = params.width;
            this._height = params.height;
            this._bgColor = params.bgColor;
            this._bgAlpha = params.bgAlpha;
            this._bgFill = params.bgFill;
            this._depth = params.depth;
            this._anchor = params.anchor;
            this._uiInputModeWhenVisible = params.uiInputModeWhenVisible;
            this._parent.attachChild(this);
            if (this._uiInputModeWhenVisible && this._visible) {
                this._receiver.addInputModeRequester(this);
            }
        }
        protected _isDeletedCheck(): boolean {
            if (this._deleted) {
                logging.log(`Element ${this.name} already deleted.`, LogLevel.Warning);
                return true;
            }
            return false;
        }
        public get parent(): Parent { return this._parent; }
        public set parent(parent: Parent) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetParent(this._uiWidget, parent.uiWidget);
            this._parent.detachChild(this);
            this._parent = parent;
            this._parent.attachChild(this);
        }
        public get visible(): boolean { return this._visible; }
        public set visible(visible: boolean) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetVisible(this._uiWidget, (this._visible = visible));
            if (!this._uiInputModeWhenVisible) return;
            if (visible) {
                this._receiver.addInputModeRequester(this);
            } else {
                this._receiver.removeInputModeRequester(this);
            }
        }
        public setVisible(visible: boolean): this { this.visible = visible; return this; }
        public show(): this { this.visible = true; return this; }
        public hide(): this { this.visible = false; return this; }
        public toggle(): this { this.visible = !this.visible; return this; }
        public get deleted(): boolean { return this._deleted; }
        public delete(): void {
            if (this._isDeletedCheck()) return;
            this._deleted = true;
            if (this._uiInputModeWhenVisible) {
                this._receiver.removeInputModeRequester(this);
            }
            this._parent.detachChild(this);
            mod.DeleteUIWidget(this._uiWidget);
        }
        public get x(): number { return this._x; }
        public set x(x: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetPosition(this._uiWidget, mod.CreateVector((this._x = x), this._y, 0));
        }
        public setX(x: number): this { this.x = x; return this; }
        public get y(): number { return this._y; }
        public set y(y: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetPosition(this._uiWidget, mod.CreateVector(this._x, (this._y = y), 0));
        }
        public setY(y: number): this { this.y = y; return this; }
        public get position(): Position { return { x: this._x, y: this._y }; }
        public set position(params: Position) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetPosition(this._uiWidget, mod.CreateVector((this._x = params.x), (this._y = params.y), 0));
        }
        public setPosition(params: Position): this { this.position = params; return this; }
        public get width(): number { return this._width; }
        public set width(w: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector((this._width = w), this._height, 0));
        }
        public setWidth(w: number): this { this.width = w; return this; }
        public get height(): number { return this._height; }
        public set height(h: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector(this._width, (this._height = h), 0));
        }
        public setHeight(h: number): this { this.height = h; return this; }
        public get size(): Size { return { width: this._width, height: this._height }; }
        public set size(params: Size) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector((this._width = params.width), (this._height = params.height), 0));
        }
        public setSize(params: Size): this { this.size = params; return this; }
        public get bgColor(): mod.Vector { return this._bgColor; }
        public set bgColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetBgColor(this._uiWidget, (this._bgColor = color));
        }
        public setBgColor(color: mod.Vector): this { this.bgColor = color; return this; }
        public get bgAlpha(): number { return this._bgAlpha; }
        public set bgAlpha(alpha: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetBgAlpha(this._uiWidget, (this._bgAlpha = alpha));
        }
        public setBgAlpha(alpha: number): this { this.bgAlpha = alpha; return this; }
        public get bgFill(): mod.UIBgFill { return this._bgFill; }
        public set bgFill(fill: mod.UIBgFill) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetBgFill(this._uiWidget, (this._bgFill = fill));
        }
        public setBgFill(fill: mod.UIBgFill): this { this.bgFill = fill; return this; }
        public get depth(): mod.UIDepth { return this._depth; }
        public set depth(depth: mod.UIDepth) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetDepth(this._uiWidget, (this._depth = depth));
        }
        public setDepth(depth: mod.UIDepth): this { this.depth = depth; return this; }
        public get anchor(): mod.UIAnchor { return this._anchor; }
        public set anchor(anchor: mod.UIAnchor) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetAnchor(this._uiWidget, (this._anchor = anchor));
        }
        public setAnchor(anchor: mod.UIAnchor): this { this.anchor = anchor; return this; }
        public get uiInputModeWhenVisible(): boolean { return this._uiInputModeWhenVisible; }
        public set uiInputModeWhenVisible(newValue: boolean) {
            if (this._isDeletedCheck()) return;
            const previousValue = this._uiInputModeWhenVisible;
            if (previousValue === newValue) return;
            this._uiInputModeWhenVisible = newValue;
            if (newValue && this.visible) {
                this._receiver.addInputModeRequester(this);
            } else {
                this._receiver.removeInputModeRequester(this);
            }
        }
    }
    export const COLORS = {
        BLACK: mod.CreateVector(0, 0, 0),
        GREY_25: mod.CreateVector(0.25, 0.25, 0.25),
        GREY_50: mod.CreateVector(0.5, 0.5, 0.5),
        GREY_75: mod.CreateVector(0.75, 0.75, 0.75),
        WHITE: mod.CreateVector(1, 1, 1),
        RED: mod.CreateVector(1, 0, 0),
        GREEN: mod.CreateVector(0, 1, 0),
        BLUE: mod.CreateVector(0, 0, 1),
        YELLOW: mod.CreateVector(1, 1, 0),
        PURPLE: mod.CreateVector(1, 0, 1),
        CYAN: mod.CreateVector(0, 1, 1),
        MAGENTA: mod.CreateVector(1, 0, 1),
        BF_GREY_1: mod.CreateVector(0.8353, 0.9216, 0.9765),
        BF_GREY_2: mod.CreateVector(0.3294, 0.3686, 0.3882),
        BF_GREY_3: mod.CreateVector(0.2118, 0.2235, 0.2353),
        BF_GREY_4: mod.CreateVector(0.0314, 0.0431, 0.0431),
        BF_BLUE_BRIGHT: mod.CreateVector(0.4392, 0.9216, 1.0),
        BF_BLUE_DARK: mod.CreateVector(0.0745, 0.1843, 0.2471),
        BF_RED_BRIGHT: mod.CreateVector(1.0, 0.5137, 0.3804),
        BF_RED_DARK: mod.CreateVector(0.251, 0.0941, 0.0667),
        BF_GREEN_BRIGHT: mod.CreateVector(0.6784, 0.9922, 0.5255),
        BF_GREEN_DARK: mod.CreateVector(0.2784, 0.4471, 0.2118),
        BF_YELLOW_BRIGHT: mod.CreateVector(1.0, 0.9882, 0.6118),
        BF_YELLOW_DARK: mod.CreateVector(0.4431, 0.3765, 0.0),
    };
    export const ROOT_NODE = Root.instance;
    const BUTTONS = new Map<string, Button>();
    Events.OnPlayerUIButtonEvent.subscribe(handleButtonEvent);
    function handleButtonEvent(player: mod.Player, widget: mod.UIWidget, event: mod.UIButtonEvent): void {
        if (event === mod.UIButtonEvent.HoverIn ||
            event === mod.UIButtonEvent.HoverOut ||
            event === mod.UIButtonEvent.FocusIn ||
            event === mod.UIButtonEvent.FocusOut) {
            return;
        }
        const name = mod.GetUIWidgetName(widget);
        const onClick = BUTTONS.get(name)?.onClick;
        if (!onClick) return;
        CallbackHandler.invoke(onClick, [player], `click handler for widget ${name}`, logging, LogLevel.Error);
    }
    export function registerButton(name: string, button: Button): () => void {
        if (BUTTONS.has(name)) {
            logging.log(`Button ${name} already registered.`, LogLevel.Warning);
            return () => {};
        }
        BUTTONS.set(name, button);
        return () => { BUTTONS.delete(name); };
    }
    let counter: number = 0;
    function isTeam(receiver?: mod.Player | mod.Team): receiver is mod.Team {
        return receiver !== undefined && mod.IsType(receiver, mod.Types.Team);
    }
    function isPlayer(receiver?: mod.Player | mod.Team): receiver is mod.Player {
        return receiver !== undefined && mod.IsType(receiver, mod.Types.Player);
    }
    export function makeName(parent: Parent, receiver: GlobalReceiver | TeamReceiver | PlayerReceiver): string {
        return `${parent.name}${parent.receiver !== receiver ? `_${receiver.id}` : ''}_${counter++}`;
    }
    export function delegateProperties<T extends object, S extends object>(
        target: T,
        source: S,
        properties: readonly string[]
    ): void {
        for (const prop of properties) {
            Object.defineProperty(target, prop, {
                get() { return (source as Record<string, unknown>)[prop]; },
                set(value: unknown) { (source as Record<string, unknown>)[prop] = value; },
                enumerable: true,
                configurable: true,
            });
            const setterMethodName = `set${prop.charAt(0).toUpperCase() + prop.slice(1)}`;
            (target as Record<string, unknown>)[setterMethodName] = function (value: unknown) {
                (source as Record<string, unknown>)[prop] = value;
                return this;
            };
        }
    }
    export function getPosition(params: ElementParams): Position {
        return { x: params.x ?? params.position?.x ?? 0, y: params.y ?? params.position?.y ?? 0 };
    }
    export function getSize(params: ElementParams): Size {
        return { width: params.width ?? params.size?.width ?? 0, height: params.height ?? params.size?.height ?? 0 };
    }
    export function getReceiver(
        parent: Parent,
        receiverParam?: mod.Player | mod.Team
    ): GlobalReceiver | TeamReceiver | PlayerReceiver {
        if (!receiverParam) return parent.receiver;
        if (isTeam(receiverParam)) return TeamReceiver.getInstance(receiverParam);
        if (isPlayer(receiverParam)) return PlayerReceiver.getInstance(receiverParam);
        return GlobalReceiver.instance;
    }
    export class UIContainer extends Element implements Parent {
        protected _children: Set<Element> = new Set();
        public constructor(params: UIContainer.Params) {
            const parent = params.parent ?? ROOT_NODE;
            const receiver = getReceiver(parent, params.receiver);
            const name = makeName(parent, receiver);
            const { x, y } = getPosition(params);
            const { width, height } = getSize(params);
            const elementParams: FinalElementParams = {
                name, parent,
                visible: params.visible ?? true,
                x, y, width, height,
                anchor: params.anchor ?? mod.UIAnchor.Center,
                bgColor: params.bgColor ?? COLORS.WHITE,
                bgAlpha: params.bgAlpha ?? 0,
                bgFill: params.bgFill ?? mod.UIBgFill.None,
                depth: params.depth ?? mod.UIDepth.AboveGameUI,
                receiver,
                uiInputModeWhenVisible: params.uiInputModeWhenVisible ?? false,
            };
            const args: [string, mod.Vector, mod.Vector, mod.UIAnchor, mod.UIWidget, boolean, number, mod.Vector, number, mod.UIBgFill, mod.UIDepth] = [
                name,
                mod.CreateVector(x, y, 0),
                mod.CreateVector(width, height, 0),
                elementParams.anchor,
                parent.uiWidget,
                elementParams.visible,
                0,
                elementParams.bgColor,
                elementParams.bgAlpha,
                elementParams.bgFill,
                elementParams.depth,
            ];
            if (receiver instanceof GlobalReceiver) {
                mod.AddUIContainer(...args);
            } else {
                mod.AddUIContainer(...args, receiver.nativeReceiver);
            }
            super(elementParams);
            for (const childParams of params.childrenParams ?? []) {
                childParams.parent = this;
                new childParams.type(childParams);
            }
        }
        public get children(): Element[] { return Array.from(this._children); }
        public override delete(): void {
            for (const child of this._children) { child.delete(); }
            super.delete();
        }
        public attachChild(child: Element): void {
            if (this._deleted) return;
            this._children.add(child);
        }
        public detachChild(child: Element): void {
            this._children.delete(child);
        }
    }
    export namespace UIContainer {
        export type ChildParams<T extends ElementParams> = T & {
            type: new (params: T) => Element;
        };
        export type Params = ElementParams & {
            childrenParams?: ChildParams<any>[];
        };
    }
    export class UIText extends Element {
        protected _message: mod.Message;
        protected _textSize: number;
        protected _textColor: mod.Vector;
        protected _textAlpha: number;
        protected _textAnchor: mod.UIAnchor;
        protected _padding: number;
        public constructor(params: UIText.Params) {
            const parent = params.parent ?? ROOT_NODE;
            const receiver = getReceiver(parent, params.receiver);
            const name = makeName(parent, receiver);
            const { x, y } = getPosition(params);
            const { width, height } = getSize(params);
            const padding = params.padding ?? 0;
            const elementParams: FinalElementParams = {
                name, parent,
                visible: params.visible ?? true,
                x, y, width, height,
                anchor: params.anchor ?? mod.UIAnchor.Center,
                bgColor: params.bgColor ?? COLORS.WHITE,
                bgAlpha: params.bgAlpha ?? 0,
                bgFill: params.bgFill ?? mod.UIBgFill.None,
                depth: params.depth ?? mod.UIDepth.AboveGameUI,
                receiver,
                uiInputModeWhenVisible: params.uiInputModeWhenVisible ?? false,
            };
            const message = params.message;
            const textSize = params.textSize ?? 36;
            const textColor = params.textColor ?? COLORS.BLACK;
            const textAlpha = params.textAlpha ?? 1;
            const textAnchor = params.textAnchor ?? mod.UIAnchor.Center;
            const args: [string, mod.Vector, mod.Vector, mod.UIAnchor, mod.UIWidget, boolean, number, mod.Vector, number, mod.UIBgFill, mod.Message, number, mod.Vector, number, mod.UIAnchor, mod.UIDepth] = [
                name,
                mod.CreateVector(x, y, 0),
                mod.CreateVector(width, height, 0),
                elementParams.anchor,
                parent.uiWidget,
                elementParams.visible,
                padding,
                elementParams.bgColor,
                elementParams.bgAlpha,
                elementParams.bgFill,
                message,
                textSize,
                textColor,
                textAlpha,
                textAnchor,
                elementParams.depth,
            ];
            if (receiver instanceof GlobalReceiver) {
                mod.AddUIText(...args);
            } else {
                mod.AddUIText(...args, receiver.nativeReceiver);
            }
            super(elementParams);
            this._message = message;
            this._textSize = textSize;
            this._textColor = textColor;
            this._textAlpha = textAlpha;
            this._textAnchor = textAnchor;
            this._padding = padding;
        }
        public get message(): mod.Message { return this._message; }
        public set message(message: mod.Message) {
            if (this._isDeletedCheck()) return;
            mod.SetUITextLabel(this._uiWidget, (this._message = message));
        }
        public setMessage(message: mod.Message): this { this.message = message; return this; }
        public get textAlpha(): number { return this._textAlpha; }
        public set textAlpha(alpha: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUITextAlpha(this._uiWidget, (this._textAlpha = alpha));
        }
        public setTextAlpha(alpha: number): this { this.textAlpha = alpha; return this; }
        public get textAnchor(): mod.UIAnchor { return this._textAnchor; }
        public set textAnchor(anchor: mod.UIAnchor) {
            if (this._isDeletedCheck()) return;
            mod.SetUITextAnchor(this._uiWidget, (this._textAnchor = anchor));
        }
        public setTextAnchor(anchor: mod.UIAnchor): this { this.textAnchor = anchor; return this; }
        public get textColor(): mod.Vector { return this._textColor; }
        public set textColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            mod.SetUITextColor(this._uiWidget, (this._textColor = color));
        }
        public setTextColor(color: mod.Vector): this { this.textColor = color; return this; }
        public get textSize(): number { return this._textSize; }
        public set textSize(size: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUITextSize(this._uiWidget, (this._textSize = size));
        }
        public setTextSize(size: number): this { this.textSize = size; return this; }
        public get padding(): number { return this._padding; }
        public set padding(padding: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetPadding(this._uiWidget, (this._padding = padding));
        }
        public setPadding(padding: number): this { this.padding = padding; return this; }
    }
    export namespace UIText {
        export type Params = ElementParams & {
            message: mod.Message;
            textSize?: number;
            textColor?: mod.Vector;
            textAlpha?: number;
            textAnchor?: mod.UIAnchor;
            padding?: number;
        };
    }
    export class UIButton extends Element implements Button {
        protected _enabled: boolean;
        protected _baseColor: mod.Vector;
        protected _baseAlpha: number;
        protected _disabledColor: mod.Vector;
        protected _disabledAlpha: number;
        protected _pressedColor: mod.Vector;
        protected _pressedAlpha: number;
        protected _hoverColor: mod.Vector;
        protected _hoverAlpha: number;
        protected _focusedColor: mod.Vector;
        protected _focusedAlpha: number;
        protected _onClick: ((player: mod.Player) => Promise<void> | void) | undefined;
        protected _unregisterAsButton: () => void;
        public constructor(params: UIButton.Params) {
            const parent = params.parent ?? ROOT_NODE;
            const receiver = getReceiver(parent, params.receiver);
            const name = makeName(parent, receiver);
            const { x, y } = getPosition(params);
            const { width, height } = getSize(params);
            const elementParams: FinalElementParams = {
                name, parent,
                visible: params.visible ?? true,
                x, y, width, height,
                anchor: params.anchor ?? mod.UIAnchor.Center,
                bgColor: params.bgColor ?? COLORS.WHITE,
                bgAlpha: params.bgAlpha ?? 1,
                bgFill: params.bgFill ?? mod.UIBgFill.Solid,
                depth: params.depth ?? mod.UIDepth.AboveGameUI,
                receiver,
                uiInputModeWhenVisible: params.uiInputModeWhenVisible ?? false,
            };
            const args: [string, mod.Vector, mod.Vector, mod.UIAnchor, mod.UIWidget, boolean, number, mod.Vector, number, mod.UIBgFill, boolean, mod.Vector, number, mod.Vector, number, mod.Vector, number, mod.Vector, number, mod.Vector, number, mod.UIDepth] = [
                name,
                mod.CreateVector(x, y, 0),
                mod.CreateVector(width, height, 0),
                elementParams.anchor,
                parent.uiWidget,
                elementParams.visible,
                0,
                elementParams.bgColor,
                elementParams.bgAlpha,
                elementParams.bgFill,
                params.enabled ?? true,
                params.baseColor ?? COLORS.BF_GREY_2,
                params.baseAlpha ?? 1,
                params.disabledColor ?? COLORS.BF_GREY_3,
                params.disabledAlpha ?? 1,
                params.pressedColor ?? COLORS.BF_GREEN_BRIGHT,
                params.pressedAlpha ?? 1,
                params.hoverColor ?? COLORS.BF_GREY_1,
                params.hoverAlpha ?? 1,
                params.focusedColor ?? COLORS.BF_GREY_1,
                params.focusedAlpha ?? 1,
                elementParams.depth,
            ];
            if (receiver instanceof GlobalReceiver) {
                mod.AddUIButton(...args);
            } else {
                mod.AddUIButton(...args, receiver.nativeReceiver);
            }
            super(elementParams);
            this._enabled = params.enabled ?? true;
            this._baseColor = params.baseColor ?? COLORS.BF_GREY_2;
            this._baseAlpha = params.baseAlpha ?? 1;
            this._disabledColor = params.disabledColor ?? COLORS.BF_GREY_3;
            this._disabledAlpha = params.disabledAlpha ?? 1;
            this._pressedColor = params.pressedColor ?? COLORS.BF_GREEN_BRIGHT;
            this._pressedAlpha = params.pressedAlpha ?? 1;
            this._hoverColor = params.hoverColor ?? COLORS.BF_GREY_1;
            this._hoverAlpha = params.hoverAlpha ?? 1;
            this._focusedColor = params.focusedColor ?? COLORS.BF_GREY_1;
            this._focusedAlpha = params.focusedAlpha ?? 1;
            this._onClick = params.onClick;
            this._unregisterAsButton = registerButton(this._name, this);
        }
        public override delete(): void {
            this._unregisterAsButton();
            super.delete();
        }
        public get enabled(): boolean { return this._enabled; }
        public set enabled(enabled: boolean) {
            if (this._isDeletedCheck()) return;
            mod.SetUIButtonEnabled(this._uiWidget, (this._enabled = enabled));
        }
        public setEnabled(enabled: boolean): this { this.enabled = enabled; return this; }
        public get baseColor(): mod.Vector { return this._baseColor; }
        public set baseColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            mod.SetUIButtonColorBase(this._uiWidget, (this._baseColor = color));
        }
        public setBaseColor(color: mod.Vector): this { this.baseColor = color; return this; }
        public get baseAlpha(): number { return this._baseAlpha; }
        public set baseAlpha(alpha: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIButtonAlphaBase(this._uiWidget, (this._baseAlpha = alpha));
        }
        public setBaseAlpha(alpha: number): this { this.baseAlpha = alpha; return this; }
        public get disabledColor(): mod.Vector { return this._disabledColor; }
        public set disabledColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            mod.SetUIButtonColorDisabled(this._uiWidget, (this._disabledColor = color));
        }
        public setDisabledColor(color: mod.Vector): this { this.disabledColor = color; return this; }
        public get hoverColor(): mod.Vector { return this._hoverColor; }
        public set hoverColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            mod.SetUIButtonColorHover(this._uiWidget, (this._hoverColor = color));
        }
        public setHoverColor(color: mod.Vector): this { this.hoverColor = color; return this; }
        public get pressedColor(): mod.Vector { return this._pressedColor; }
        public set pressedColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            mod.SetUIButtonColorPressed(this._uiWidget, (this._pressedColor = color));
        }
        public setColorPressed(color: mod.Vector): this { this.pressedColor = color; return this; }
        public get focusedColor(): mod.Vector { return this._focusedColor; }
        public set focusedColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            mod.SetUIButtonColorFocused(this._uiWidget, (this._focusedColor = color));
        }
        public setFocusedColor(color: mod.Vector): this { this.focusedColor = color; return this; }
        public get onClick(): ((player: mod.Player) => Promise<void> | void) | undefined { return this._onClick; }
        public set onClick(onClick: ((player: mod.Player) => Promise<void> | void) | undefined) {
            if (this._isDeletedCheck()) return;
            this._onClick = onClick;
        }
        public setOnClick(onClick: ((player: mod.Player) => Promise<void> | void) | undefined): this { this.onClick = onClick; return this; }
    }
    export namespace UIButton {
        export type Params = ElementParams & {
            enabled?: boolean;
            baseColor?: mod.Vector;
            baseAlpha?: number;
            disabledColor?: mod.Vector;
            disabledAlpha?: number;
            pressedColor?: mod.Vector;
            pressedAlpha?: number;
            hoverColor?: mod.Vector;
            hoverAlpha?: number;
            focusedColor?: mod.Vector;
            focusedAlpha?: number;
            onClick?: (player: mod.Player) => Promise<void> | void;
        };
    }
    export abstract class UIContentButton<TContent extends Element, TContentProps extends readonly string[]>
        extends Element
    {
        protected _padding: number;
        protected _button: UIButton;
        protected _content: TContent;
        declare public baseColor: mod.Vector;
        declare public baseAlpha: number;
        declare public disabledColor: mod.Vector;
        declare public disabledAlpha: number;
        declare public pressedColor: mod.Vector;
        declare public pressedAlpha: number;
        declare public hoverColor: mod.Vector;
        declare public hoverAlpha: number;
        declare public focusedColor: mod.Vector;
        declare public focusedAlpha: number;
        declare public onClick: ((player: mod.Player) => Promise<void> | void) | undefined;
        declare public setBaseColor: (color: mod.Vector) => this;
        declare public setBaseAlpha: (alpha: number) => this;
        declare public setDisabledColor: (color: mod.Vector) => this;
        declare public setDisabledAlpha: (alpha: number) => this;
        declare public setPressedColor: (color: mod.Vector) => this;
        declare public setPressedAlpha: (alpha: number) => this;
        declare public setHoverColor: (color: mod.Vector) => this;
        declare public setHoverAlpha: (alpha: number) => this;
        declare public setFocusedColor: (color: mod.Vector) => this;
        declare public setFocusedAlpha: (alpha: number) => this;
        declare public setOnClick: (onClick: ((player: mod.Player) => Promise<void> | void) | undefined) => this;
        protected constructor(
            params: UIContentButton.Params,
            createContent: (parent: Parent, width: number, height: number) => TContent,
            contentProperties: TContentProps
        ) {
            const parent = params.parent ?? ROOT_NODE;
            const receiver = getReceiver(parent, params.receiver);
            const name = makeName(parent, receiver);
            const { x, y } = getPosition(params);
            const { width, height } = getSize(params);
            const depth = params.depth ?? mod.UIDepth.AboveGameUI;
            const padding = params.padding ?? 0;
            const containerElementParams: FinalElementParams = {
                name, parent,
                visible: params.visible ?? true,
                x, y, width, height,
                anchor: params.anchor ?? mod.UIAnchor.Center,
                bgColor: COLORS.WHITE,
                bgAlpha: 0,
                bgFill: mod.UIBgFill.None,
                depth,
                receiver,
                uiInputModeWhenVisible: params.uiInputModeWhenVisible ?? false,
            };
            const containerArgs: [string, mod.Vector, mod.Vector, mod.UIAnchor, mod.UIWidget, boolean, number, mod.Vector, number, mod.UIBgFill, mod.UIDepth] = [
                name,
                mod.CreateVector(x, y, 0),
                mod.CreateVector(width, height, 0),
                containerElementParams.anchor,
                parent.uiWidget,
                containerElementParams.visible,
                padding,
                containerElementParams.bgColor,
                containerElementParams.bgAlpha,
                containerElementParams.bgFill,
                containerElementParams.depth,
            ];
            if (receiver instanceof GlobalReceiver) {
                mod.AddUIContainer(...containerArgs);
            } else {
                mod.AddUIContainer(...containerArgs, receiver.nativeReceiver);
            }
            super(containerElementParams);
            this._padding = padding;
            const mockParent: Parent = {
                name: this._name,
                uiWidget: this._uiWidget,
                receiver: this._receiver,
                children: [],
                attachChild(_child: Element): void {},
                detachChild(_child: Element): void {},
            };
            const buttonParams: UIButton.Params = {
                parent: mockParent,
                width, height,
                bgColor: params.bgColor,
                bgAlpha: params.bgAlpha,
                bgFill: params.bgFill,
                enabled: params.enabled,
                baseColor: params.baseColor,
                baseAlpha: params.baseAlpha,
                disabledColor: params.disabledColor,
                disabledAlpha: params.disabledAlpha,
                pressedColor: params.pressedColor,
                pressedAlpha: params.pressedAlpha,
                hoverColor: params.hoverColor,
                hoverAlpha: params.hoverAlpha,
                focusedColor: params.focusedColor,
                focusedAlpha: params.focusedAlpha,
                depth,
                onClick: params.onClick,
            };
            this._button = new UIButton(buttonParams);
            const widthNetOfPadding = Math.max(0, width - padding * 2);
            const heightNetOfPadding = Math.max(0, height - padding * 2);
            this._content = createContent(mockParent, widthNetOfPadding, heightNetOfPadding);
            delegateProperties(this, this._button, [
                'bgColor', 'bgAlpha', 'bgFill',
                'baseColor', 'baseAlpha',
                'disabledColor', 'disabledAlpha',
                'pressedColor', 'pressedAlpha',
                'focusedAlpha', 'focusedColor',
                'hoverAlpha', 'hoverColor',
                'onClick',
            ]);
            delegateProperties(this, this._content, contentProperties);
        }
        public override delete(): void {
            this._button.delete();
            this._content.delete();
            super.delete();
        }
        public override get width(): number { return this._button.width; }
        public override set width(width: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector(width, this.height, 0));
            this._button.setWidth(width);
            this._content.setWidth(Math.max(0, width - this._padding * 2));
        }
        public override get height(): number { return this._button.height; }
        public override set height(height: number) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector(this.width, height, 0));
            this._button.setHeight(height);
            this._content.setHeight(Math.max(0, height - this._padding * 2));
        }
        public override get size(): Size { return { width: this._button.width, height: this._button.height }; }
        public override set size(params: Size) {
            if (this._isDeletedCheck()) return;
            mod.SetUIWidgetSize(this._uiWidget, mod.CreateVector(params.width, params.height, 0));
            this._button.setSize(params);
            this._content.setSize({
                width: Math.max(0, params.width - this._padding * 2),
                height: Math.max(0, params.height - this._padding * 2),
            });
        }
        public get enabled(): boolean { return this._button.enabled; }
        public set enabled(enabled: boolean) {
            if (this._isDeletedCheck()) return;
            this._button.enabled = enabled;
        }
        public setEnabled(enabled: boolean): this { this.enabled = enabled; return this; }
    }
    export namespace UIContentButton {
        export type Params = UIButton.Params & { padding?: number; };
    }
    const TEXT_BUTTON_CONTENT_PROPERTIES: readonly string[] = ['message', 'textSize', 'textAnchor'] as const;
    export class UITextButton extends UIContentButton<UIText, typeof TEXT_BUTTON_CONTENT_PROPERTIES> {
        declare public message: mod.Message;
        declare public textAnchor: mod.UIAnchor;
        declare public textSize: number;
        declare public setMessage: (message: mod.Message) => this;
        declare public setTextAnchor: (anchor: mod.UIAnchor) => this;
        declare public setTextSize: (size: number) => this;
        protected _textDisabledColor: mod.Vector;
        protected _textDisabledAlpha: number;
        public constructor(params: UITextButton.Params) {
            const createContent = (parent: Parent, width: number, height: number): UIText => {
                return new UIText({
                    parent, width, height,
                    message: params.message,
                    textSize: params.textSize,
                    textColor: params.textColor,
                    textAlpha: params.textAlpha,
                    textAnchor: params.textAnchor,
                    depth: params.depth,
                });
            };
            super(params, createContent, TEXT_BUTTON_CONTENT_PROPERTIES);
            this._textDisabledColor = params.textDisabledColor ?? COLORS.BF_GREY_2;
            this._textDisabledAlpha = params.textDisabledAlpha ?? 1;
            if (!this._button.enabled) {
                this._setContentEnabled(false);
            }
        }
        private _setContentEnabled(enabled: boolean): void {
            if (enabled) {
                mod.SetUITextColor(this._content.uiWidget, this._content.textColor);
                mod.SetUITextAlpha(this._content.uiWidget, this._content.textAlpha);
            } else {
                mod.SetUITextColor(this._content.uiWidget, this._textDisabledColor);
                mod.SetUITextAlpha(this._content.uiWidget, this._textDisabledAlpha);
            }
        }
        public override get enabled(): boolean { return this._button.enabled; }
        public override set enabled(enabled: boolean) {
            if (this._isDeletedCheck()) return;
            this._button.enabled = enabled;
            this._setContentEnabled(enabled);
        }
        public get textColor(): mod.Vector { return this._content.textColor; }
        public set textColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            this._content.textColor = color;
            if (this._button.enabled) mod.SetUITextColor(this._content.uiWidget, color);
        }
        public setTextColor(color: mod.Vector): this { this.textColor = color; return this; }
        public get textAlpha(): number { return this._content.textAlpha; }
        public set textAlpha(alpha: number) {
            if (this._isDeletedCheck()) return;
            this._content.textAlpha = alpha;
            if (this._button.enabled) mod.SetUITextAlpha(this._content.uiWidget, alpha);
        }
        public setTextAlpha(alpha: number): this { this.textAlpha = alpha; return this; }
        public get textDisabledColor(): mod.Vector { return this._textDisabledColor; }
        public set textDisabledColor(color: mod.Vector) {
            if (this._isDeletedCheck()) return;
            this._textDisabledColor = color;
            if (!this._button.enabled) mod.SetUITextColor(this._content.uiWidget, color);
        }
        public get textDisabledAlpha(): number { return this._textDisabledAlpha; }
        public set textDisabledAlpha(alpha: number) {
            if (this._isDeletedCheck()) return;
            this._textDisabledAlpha = alpha;
            if (!this._button.enabled) mod.SetUITextAlpha(this._content.uiWidget, alpha);
        }
    }
    export namespace UITextButton {
        export type Params = UIButton.Params & UIText.Params & {
            textDisabledColor?: mod.Vector;
            textDisabledAlpha?: number;
        };
    }
}


// ===== Module: config/StandaloneConfig.ts =====
namespace VehicleUIStandalone {
    const deployedPlayerIds: Set<number> = new Set();
    export const aiStatusByPlayerId: { [playerId: number]: boolean } = {};
    export function markPlayerDeployed(player: mod.Player): void {
        if (!player) return;
        try {
            const pid = mod.GetObjId(player);
            deployedPlayerIds.add(pid);
        } catch (_e) {}
    }
    export function markPlayerUndeployed(player: mod.Player): void {
        if (!player) return;
        try {
            const pid = mod.GetObjId(player);
            deployedPlayerIds.delete(pid);
            delete aiStatusByPlayerId[pid];
        } catch (_e) {}
    }
    function pruneAiStatusCache(): void {
        try {
            const all = mod.AllPlayers();
            const count = mod.CountOf(all);
            const activeIds: Set<number> = new Set();
            for (let i = 0; i < count; i++) {
                const p = mod.ValueInArray(all, i) as mod.Player;
                if (!p) continue;
                try { activeIds.add(mod.GetObjId(p)); } catch (_e) {}
            }
            for (const key of Object.keys(aiStatusByPlayerId)) {
                const id = Number(key);
                if (!activeIds.has(id)) delete aiStatusByPlayerId[id];
            }
        } catch (_e) {}
    }
    let _logCount = 0;
    const LOG_CAP = 5000;
    const LOG_THROTTLE_INTERVAL = 50;
    export function log(msg: string): void {
        _logCount++;
        if (_logCount > LOG_CAP && _logCount % LOG_THROTTLE_INTERVAL !== 0) return;
        console.log(msg);
    }
    export function logError(msg: string): void {
        console.log(`[VehicleUI][ERROR] ${msg}`);
    }
    export function logDebug(_msg: string): void { /* no-op */ }
    export const TANK_HEALTH_MULTIPLIER = 0.5;
    export const IFV_HEALTH_MULTIPLIER = 0.6;
    export const AA_HEALTH_MULTIPLIER = 0.7;
    export const MARAUDER_HEALTH_MULTIPLIER = 0.6;
    export type Objective = {
        id: string;
        name: string;
        objId: number;
        x: number;
        y: number;
        z: number;
        waypointPathId?: number;
    };
    export let OBJECTIVES: Objective[] = [];
    export let TEAM1_AI_SPAWNER_IDS: number[] = [];
    export let TEAM2_AI_SPAWNER_IDS: number[] = [];
    export let TEAM1_OBJ_SPAWNER_IDS: number[] = [];
    export let TEAM2_OBJ_SPAWNER_IDS: number[] = [];
    export function safeCall(label: string, fn: () => void): void {
        try {
            fn();
        } catch (e) {
            logError(`[safeCall:${label}] ${e}`);
        }
    }
    export function isAISoldier(player: mod.Player): boolean {
        if (!player) return false;
        pruneAiStatusCache();
        let pid = -1;
        try { pid = mod.GetObjId(player); } catch (_e) { return false; }
        if (!deployedPlayerIds.has(pid)) return aiStatusByPlayerId[pid] ?? false;
        try {
            const isAI = mod.GetSoldierState(player, mod.SoldierStateBool.IsAISoldier);
            aiStatusByPlayerId[pid] = isAI;
            return isAI;
        } catch (_e) {
            markPlayerUndeployed(player);
            return aiStatusByPlayerId[pid] ?? false;
        }
    }
    export function isAlive(player: mod.Player): boolean {
        if (!hasSoldier(player)) return false;
        try {
            return mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive);
        } catch (_e) {
            try { markPlayerUndeployed(player); } catch (_e2) {}
            return false;
        }
    }
    export function hasSoldier(player: mod.Player): boolean {
        if (!player) return false;
        try {
            if (!mod.IsPlayerValid(player)) {
                try {
                    const pid2 = mod.GetObjId(player);
                    deployedPlayerIds.delete(pid2);
                } catch (_e2) {}
                return false;
            }
            const pid = mod.GetObjId(player);
            return deployedPlayerIds.has(pid);
        } catch (_e) { return false; }
    }
    export function getPlayerTeamId(player: mod.Player): number {
        try {
            const playerTeam = mod.GetTeam(player);
            if (!playerTeam) return 0;
            const team1 = mod.GetTeam(1);
            const team2 = mod.GetTeam(2);
            if (team1 && mod.GetObjId(playerTeam) === mod.GetObjId(team1)) return 1;
            if (team2 && mod.GetObjId(playerTeam) === mod.GetObjId(team2)) return 2;
            return 0;
        } catch (e) { return 0; }
    }
    export function now(useMatchTime: boolean = false): number {
        return useMatchTime ? mod.GetMatchTimeElapsed() : mod.GetMatchTimeElapsed();
    }
}


// ===== Module: modules/SafeSDKWrapper.ts =====
namespace VehicleUIStandalone {
    export function isActivePlayer(player: mod.Player): boolean {
        if (!player) return false;
        try {
            if (!mod.IsPlayerValid(player)) return false;
        } catch (_e) {
            return false;
        }
        return safeGetSoldierStateBool(player, mod.SoldierStateBool.IsAlive);
    }
    export function safeGetSoldierState<T>(
        player: mod.Player,
        stateKey: T,
        defaultValue: any = null
    ): any {
        if (!player) return defaultValue;
        if (!hasSoldier(player)) return defaultValue;
        try {
            const result = mod.GetSoldierState(player, stateKey as any);
            return result !== undefined ? result : defaultValue;
        } catch (_e) {
            return defaultValue;
        }
    }
    export function safeGetSoldierStateBool(
        player: mod.Player,
        stateKey: mod.SoldierStateBool
    ): boolean {
        return safeGetSoldierState(player, stateKey, false) === true;
    }
    export function safeGetSoldierStateVector(
        player: mod.Player,
        stateKey: mod.SoldierStateVector
    ): mod.Vector {
        const result = safeGetSoldierState(player, stateKey, null);
        return result ?? mod.CreateVector(0, 0, 0);
    }
    export function safeGetVehicleFromPlayer(player: mod.Player): mod.Vehicle | null {
        if (!player) return null;
        if (!safeGetSoldierStateBool(player, mod.SoldierStateBool.IsAlive)) {
            return null; // Dead/mandown players throw on GetVehicleFromPlayer
        }
        if (!safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle)) {
            return null;
        }
        try {
            const vehicle = mod.GetVehicleFromPlayer(player);
            return vehicle ?? null;
        } catch (_e) {
            return null;
        }
    }
    export function safeGetPlayerFromVehicleSeat(
        vehicle: mod.Vehicle,
        seatNumber: number
    ): mod.Player | null {
        if (!vehicle) return null;
        try {
            if (!mod.IsVehicleSeatOccupied(vehicle, seatNumber)) {
                return null;
            }
            const player = mod.GetPlayerFromVehicleSeat(vehicle, seatNumber);
            return player ?? null;
        } catch (_e) {
            return null;
        }
    }
    export function safeGetPlayerVehicleSeat(player: mod.Player): number {
        if (!player) return -1;
        try {
            const seat = mod.GetPlayerVehicleSeat(player);
            return typeof seat === "number" ? seat : -1;
        } catch (_e) {
            return -1;
        }
    }
    export function safeIsVehicleSeatOccupied(
        vehicle: mod.Vehicle,
        seatNumber: number
    ): boolean {
        if (!vehicle) return false;
        try {
            return mod.IsVehicleSeatOccupied(vehicle, seatNumber) === true;
        } catch (_e) {
            return false;
        }
    }
    export function safeForcePlayerToSeat(
        player: mod.Player,
        vehicle: mod.Vehicle,
        seatNumber: number
    ): boolean {
        if (!player || !vehicle) return false;
        if (!safeGetSoldierStateBool(player, mod.SoldierStateBool.IsAlive)) {
            return false; // Can't seat dead player
        }
        try {
            mod.ForcePlayerToSeat(player, vehicle, seatNumber);
            return true;
        } catch (_e) {
            return false;
        }
    }
    export function safeForcePlayerExitVehicle(
        player: mod.Player,
        vehicle?: mod.Vehicle
    ): boolean {
        if (!player) return false;
        try {
            if (vehicle) mod.ForcePlayerExitVehicle(player, vehicle);
            else mod.ForcePlayerExitVehicle(player);
            return true;
        } catch (_e) {
            return false;
        }
    }
    export function safeSpawnAIFromAISpawner(
        spawner: mod.Spawner,
        nameMessage: mod.Message,
        team: mod.Team
    ): boolean {
        if (!spawner || !team) return false;
        try {
            mod.SpawnAIFromAISpawner(spawner, nameMessage, team);
            return true; // Assume success if no exception
        } catch (_e) {
            return false;
        }
    }
    export function safeCompareVehicleName(
        vehicle: mod.Vehicle,
        vehicleType: mod.VehicleList
    ): boolean {
        if (!vehicle) return false;
        try {
            return mod.CompareVehicleName(vehicle, vehicleType) === true;
        } catch (_e) {
            return false;
        }
    }
    export function safeDealDamageToVehicle(
        vehicle: mod.Vehicle,
        damageAmount: number
    ): boolean {
        if (!vehicle || damageAmount <= 0) return false;
        try {
            mod.DealDamage(vehicle, damageAmount);
            return true;
        } catch (_e) {
            return false;
        }
    }
    export function safeDealDamageToPlayer(
        player: mod.Player,
        damageAmount: number
    ): boolean {
        if (!player || damageAmount <= 0) return false;
        try {
            mod.DealDamage(player, damageAmount);
            return true;
        } catch (_e) {
            return false;
        }
    }
    export function safeHasSoldier(player: mod.Player): boolean {
        if (!player) return false;
        try {
            const isAlive = mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive);
            return isAlive !== undefined;
        } catch (_e) {
            return false;
        }
    }
    export function safeAIMoveTo(
        player: mod.Player,
        position: mod.Vector
    ): boolean {
        if (!player || !position) return false;
        try {
            mod.AIValidatedMoveToBehavior(player, position);
            return true;
        } catch (_e) {
            return false;
        }
    }
    export function safeGetVehicleSpawner(spawnerId: number): mod.VehicleSpawner | null {
        if (spawnerId < 0) return null;
        try {
            const spawner = mod.GetVehicleSpawner(spawnerId);
            return spawner ?? null;
        } catch (_e) {
            return null;
        }
    }
    export function safeGetSpawner(spawnerId: number): mod.Spawner | null {
        if (spawnerId < 0) return null;
        try {
            const spawner = mod.GetSpawner(spawnerId);
            return spawner ?? null;
        } catch (_e) {
            return null;
        }
    }
    export function safeGetVehicleStateVector(
        vehicle: mod.Vehicle,
        stateKey: mod.VehicleStateVector
    ): mod.Vector | null {
        if (!vehicle) return null;
        try {
            return mod.GetVehicleState(vehicle, stateKey);
        } catch (_e) {
            return null;
        }
    }
}


// ===== Module: modules/AutoDiscoveryModule.ts =====
namespace VehicleUIStandalone {
    const LETTER_MAP = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const NAME_MAP = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet"];
    const VEHICLE_SPAWNER_PROBE_START = 200;
    const VEHICLE_SPAWNER_PROBE_END = 2100;
    const CAPTURE_REWARD_RADIUS_METERS = 50;
    function isJetType(vt: mod.VehicleList): boolean {
        return vt === mod.VehicleList.F16 || vt === mod.VehicleList.F22 ||
               vt === mod.VehicleList.JAS39 || vt === mod.VehicleList.SU57;
    }
    const ALL_VEHICLE_TYPES: { type: mod.VehicleList; label: string; category: 'Ground' | 'Air' }[] = [
        { type: mod.VehicleList.Abrams,       label: "Abrams",  category: 'Ground' },
        { type: mod.VehicleList.Leopard,      label: "Leopard", category: 'Ground' },
        { type: mod.VehicleList.M2Bradley,    label: "Bradley", category: 'Ground' },
        { type: mod.VehicleList.CV90,         label: "CV90",    category: 'Ground' },
        { type: mod.VehicleList.Vector,       label: "Vector",  category: 'Ground' },
        { type: mod.VehicleList.Cheetah,      label: "AA",      category: 'Ground' },
        { type: mod.VehicleList.Gepard,       label: "Gepard",  category: 'Ground' },
        { type: mod.VehicleList.Marauder,     label: "Marauder",category: 'Ground' },
        { type: mod.VehicleList.Marauder_Pax, label: "Mardr",   category: 'Ground' },
        { type: mod.VehicleList.Flyer60,      label: "Flyer",   category: 'Ground' },
        { type: mod.VehicleList.Quadbike,     label: "Quad",    category: 'Ground' },
        { type: mod.VehicleList.GolfCart,     label: "Cart",    category: 'Ground' },
        { type: mod.VehicleList.RHIB,         label: "RHIB",    category: 'Ground' },
        { type: mod.VehicleList.DirtBike,     label: "DirtBke", category: 'Ground' },
        { type: mod.VehicleList.DirtBike_Pax, label: "DirtPax", category: 'Ground' },
        { type: mod.VehicleList.F16,          label: "F16",     category: 'Air'    },
        { type: mod.VehicleList.F22,          label: "F22",     category: 'Air'    },
        { type: mod.VehicleList.JAS39,        label: "JAS39",   category: 'Air'    },
        { type: mod.VehicleList.SU57,         label: "SU57",    category: 'Air'    },
        { type: mod.VehicleList.AH64,         label: "AH64",    category: 'Air'    },
        { type: mod.VehicleList.AH6M,         label: "AH6M",    category: 'Air'    },
        { type: mod.VehicleList.AH6M_Pax,     label: "AH6Px",   category: 'Air'    },
        { type: mod.VehicleList.Eurocopter,   label: "ATK",     category: 'Air'    },
        { type: mod.VehicleList.UH60,         label: "UH60",    category: 'Air'    },
        { type: mod.VehicleList.UH60_Pax,     label: "UH60P",   category: 'Air'    },
    ];
    const FACTION_PAIRS: mod.VehicleList[][] = [
        [mod.VehicleList.Abrams,    mod.VehicleList.Leopard],
        [mod.VehicleList.M2Bradley, mod.VehicleList.CV90],
        [mod.VehicleList.Cheetah,   mod.VehicleList.Gepard],
        [mod.VehicleList.Marauder,  mod.VehicleList.Marauder_Pax],
        [mod.VehicleList.AH6M,      mod.VehicleList.AH6M_Pax],
        [mod.VehicleList.UH60,      mod.VehicleList.UH60_Pax],
        [mod.VehicleList.DirtBike,  mod.VehicleList.DirtBike_Pax],
        [mod.VehicleList.F22,       mod.VehicleList.SU57],
        [mod.VehicleList.F16,       mod.VehicleList.JAS39],
        [mod.VehicleList.AH64,      mod.VehicleList.Eurocopter],
    ];
    const STRONG_T1_ANCHORS: mod.VehicleList[] = [
        mod.VehicleList.Abrams,
        mod.VehicleList.M2Bradley,
        mod.VehicleList.F22,
        mod.VehicleList.F16,
        mod.VehicleList.AH64,
    ];
    const STRONG_T2_ANCHORS: mod.VehicleList[] = [
        mod.VehicleList.Leopard,
        mod.VehicleList.CV90,
        mod.VehicleList.SU57,
        mod.VehicleList.JAS39,
        mod.VehicleList.Eurocopter,
    ];
    function getStrongAnchorTeam(vt: mod.VehicleList): number {
        if (STRONG_T1_ANCHORS.indexOf(vt) >= 0) return 1;
        if (STRONG_T2_ANCHORS.indexOf(vt) >= 0) return 2;
        return 0;
    }
    function getFactionMatchTypes(vt: mod.VehicleList): mod.VehicleList[] {
        return [vt];
    }
    export function isFactionAppropriate(vt: mod.VehicleList, teamId: number): boolean {
        for (const pair of FACTION_PAIRS) {
            const idx = pair.indexOf(vt);
            if (idx === -1) continue;
            return (idx === 0 && teamId === 1) || (idx === 1 && teamId === 2);
        }
        return true;
    }
    export interface DiscoveredVehicleSpawner {
        spawnerId: number;
        spawner: mod.VehicleSpawner;
        position: mod.Vector | null;
        vehicleType: mod.VehicleList | null;
        matchTypes?: mod.VehicleList[];
        label: string;
        category: 'Ground' | 'Air';
        teamId: number;
        objectiveLetter: string | null;
        needsForceSpawn: boolean;
    }
    export interface DiscoveredAISpawner {
        spawnerId: number;
        spawner: mod.Spawner;
    }
    export let discoveredVehicleSpawners: DiscoveredVehicleSpawner[] = [];
    export const confirmedSpawnerIds = new Set<number>();
    export const spawnerTeamCache: Map<number, number> = new Map();
    let discoveryComplete = false;
    let labelCorrectionsNeeded = false;
    let firstObservationTime = -1;
    const DISCOVERY_SETTLE_SECONDS = 8.0;
    interface CandidateSpawner { spawnerId: number; spawner: mod.VehicleSpawner; used: boolean; }
    let candidateSpawners: CandidateSpawner[] = [];
    let autoSpawnProbeActive = false; // backward-compat flag (no-op)
    function logD(msg: string): void {
        try { (typeof log === 'function') && log(msg); } catch (_e) {}
    }
    function logV(msg: string): void {
        try { (typeof logDebug === 'function') && logDebug(msg); } catch (_e) {}
    }
    export function discoverObjectives(): void {
        const allCPs = mod.AllCapturePoints();
        const count = mod.CountOf(allCPs);
        if (count === 0) {
            logD("[Discovery] WARNING: No capture points found on this map!");
            return;
        }
        const cpData: { cp: mod.CapturePoint; objId: number; x: number; y: number; z: number }[] = [];
        for (let i = 0; i < count; i++) {
            const cp = mod.ValueInArray(allCPs, i) as mod.CapturePoint;
            if (!cp) continue;
            const objId = mod.GetObjId(cp);
            try {
                const pos = mod.GetObjectPosition(cp as unknown as mod.Object);
                if (pos) {
                    cpData.push({
                        cp, objId,
                        x: mod.XComponentOf(pos),
                        y: mod.YComponentOf(pos),
                        z: mod.ZComponentOf(pos),
                    });
                }
            } catch (e) {
                logD(`[Discovery] CP objId=${objId} pos error: ${e}`);
            }
        }
        if (cpData.length === 0) { logD("[Discovery] WARNING: No CP positions"); return; }
        cpData.sort((a, b) => a.objId - b.objId);
        OBJECTIVES = [];
        for (let i = 0; i < cpData.length && i < LETTER_MAP.length; i++) {
            const d = cpData[i];
            OBJECTIVES.push({
                id: LETTER_MAP[i],
                name: NAME_MAP[i] || ("CP" + i),
                objId: d.objId, x: d.x, y: d.y, z: d.z,
            });
            logD(`[Discovery] Objective ${LETTER_MAP[i]} objId=${d.objId} pos=(${d.x.toFixed(0)},${d.y.toFixed(0)},${d.z.toFixed(0)})`);
        }
        logD(`[Discovery] ${OBJECTIVES.length} objectives discovered`);
    }
    function probeSpawner(id: number): boolean {
        try {
            const s = mod.GetSpawner(id);
            return s !== null && s !== undefined;
        } catch (_e) { return false; }
    }
    export function discoverAISpawners(): void {
        const KNOWN_T1_HQ = [1090, 1091, 1092, 1093];
        const KNOWN_T2_HQ = [1002, 1003, 1004, 1005];
        const BASE_T1_HQ  = [100, 110, 120, 130];
        const BASE_T2_HQ  = [101, 111, 121, 131];
        const t1: number[] = [];
        const t2: number[] = [];
        for (const id of KNOWN_T1_HQ) if (probeSpawner(id)) t1.push(id);
        for (const id of KNOWN_T2_HQ) if (probeSpawner(id)) t2.push(id);
        if (t1.length === 0) for (const id of BASE_T1_HQ) if (probeSpawner(id)) t1.push(id);
        if (t2.length === 0) for (const id of BASE_T2_HQ) if (probeSpawner(id)) t2.push(id);
        if (t1.length > 0 && t2.length > 0) {
            TEAM1_AI_SPAWNER_IDS = t1;
            TEAM2_AI_SPAWNER_IDS = t2;
            logD(`[Discovery] AI Spawners T1=[${t1.join(",")}] T2=[${t2.join(",")}]`);
            return;
        }
        const found: number[] = [];
        for (let id = 900; id <= 1100; id++) if (probeSpawner(id)) found.push(id);
        const t1F: number[] = [];
        const t2F: number[] = [];
        for (let i = 0; i < found.length && (t1F.length < 4 || t2F.length < 4); i++) {
            if (i % 2 === 0 && t1F.length < 4) t1F.push(found[i]);
            else if (t2F.length < 4) t2F.push(found[i]);
        }
        TEAM1_AI_SPAWNER_IDS = t1.length > 0 ? t1 : t1F;
        TEAM2_AI_SPAWNER_IDS = t2.length > 0 ? t2 : t2F;
        logD(`[Discovery] AI Spawners (fallback) T1=[${TEAM1_AI_SPAWNER_IDS.join(",")}] T2=[${TEAM2_AI_SPAWNER_IDS.join(",")}]`);
    }
    export function discoverVehicleSpawners(): void {
        candidateSpawners = [];
        for (let id = VEHICLE_SPAWNER_PROBE_START; id <= VEHICLE_SPAWNER_PROBE_END; id++) {
            try {
                const spawner = mod.GetVehicleSpawner(id);
                if (spawner) candidateSpawners.push({ spawnerId: id, spawner, used: false });
            } catch (_e) {}
        }
        logD(`[Discovery] Collected ${candidateSpawners.length} candidate spawner handles`);
    }
    function identifyVehicleType(v: mod.Vehicle): { type: mod.VehicleList; label: string; category: 'Ground' | 'Air' } | null {
        for (const vt of ALL_VEHICLE_TYPES) {
            try {
                if (mod.CompareVehicleName(v, vt.type)) return vt;
            } catch (_e) {}
        }
        return null;
    }
    function getVehicleTeamId(v: mod.Vehicle): number {
        try {
            const team = mod.GetVehicleTeam(v);
            if (team) {
                const t1 = mod.GetTeam(1);
                const t2 = mod.GetTeam(2);
                if (team === t1) return 1;
                if (team === t2) return 2;
            }
        } catch (_e) {}
        return 0;
    }
    let _hqT1: { x: number; y: number; z: number } | null = null;
    let _hqT2: { x: number; y: number; z: number } | null = null;
    let _hqResolved = false;
    const observedVehicleObjIds = new Set<number>();
    function getHQCentroid(ids: number[]): { x: number; y: number; z: number } | null {
        let n = 0, sx = 0, sy = 0, sz = 0;
        for (const id of ids) {
            try {
                const sp = mod.GetSpawner(id);
                if (!sp) continue;
                const pos = mod.GetObjectPosition(sp as unknown as mod.Object);
                if (!pos) continue;
                const x = mod.XComponentOf(pos);
                const y = mod.YComponentOf(pos);
                const z = mod.ZComponentOf(pos);
                if (x === 0 && y === 0 && z === 0) continue; // SDK returned null position
                sx += x; sy += y; sz += z;
                n++;
            } catch (_e) {}
        }
        if (n === 0) return null;
        return { x: sx / n, y: sy / n, z: sz / n };
    }
    function resolveHQCentroids(): void {
        if (_hqResolved) return;
        _hqResolved = true;
        _hqT1 = getHQCentroid(TEAM1_AI_SPAWNER_IDS);
        _hqT2 = getHQCentroid(TEAM2_AI_SPAWNER_IDS);
        if (_hqT1 && _hqT2) {
            logD(`[Discovery] HQ centroids: T1=(${_hqT1.x.toFixed(0)},${_hqT1.z.toFixed(0)}) T2=(${_hqT2.x.toFixed(0)},${_hqT2.z.toFixed(0)})`);
        } else {
            logD(`[Discovery] HQ centroids unavailable (Spawner positions return null) - mirroring will fill the other team`);
        }
    }
    export function AutoDiscovery_GetTeamHQCentroid(teamId: number): { x: number; y: number; z: number } | null {
        if (!_hqResolved) resolveHQCentroids();
        if (teamId === 1) return _hqT1;
        if (teamId === 2) return _hqT2;
        return null;
    }
    function inferTeamFromPosition(pos: mod.Vector | null): number {
        if (!pos) return 0;
        if (!_hqResolved) resolveHQCentroids();
        if (!_hqT1 || !_hqT2) return 0;
        const px = mod.XComponentOf(pos);
        const py = mod.YComponentOf(pos);
        const pz = mod.ZComponentOf(pos);
        const d1 = (px - _hqT1.x) * (px - _hqT1.x) + (py - _hqT1.y) * (py - _hqT1.y) + (pz - _hqT1.z) * (pz - _hqT1.z);
        const d2 = (px - _hqT2.x) * (px - _hqT2.x) + (py - _hqT2.y) * (py - _hqT2.y) + (pz - _hqT2.z) * (pz - _hqT2.z);
        return d1 < d2 ? 1 : 2;
    }
    function distSqVector(v: mod.Vector, x: number, y: number, z: number): number {
        try {
            const vx = mod.XComponentOf(v) - x;
            const vy = mod.YComponentOf(v) - y;
            const vz = mod.ZComponentOf(v) - z;
            return vx * vx + vy * vy + vz * vz;
        } catch (_e) { return Infinity; }
    }
    function nearestObjectiveLetter(pos: mod.Vector): string | null {
        const radiusSq = CAPTURE_REWARD_RADIUS_METERS * CAPTURE_REWARD_RADIUS_METERS;
        let bestLetter: string | null = null;
        let bestDist = radiusSq;
        for (const obj of OBJECTIVES) {
            const d = distSqVector(pos, obj.x, obj.y, obj.z);
            if (d < bestDist) { bestDist = d; bestLetter = obj.id; }
        }
        return bestLetter;
    }
    function takeCandidate(): CandidateSpawner | null {
        for (const c of candidateSpawners) {
            if (!c.used) { c.used = true; return c; }
        }
        return null;
    }
    interface PendingObservation {
        objId: number;
        vehicleType: mod.VehicleList;
        meta: { type: mod.VehicleList; label: string; category: 'Ground' | 'Air' };
        pos: { x: number; y: number; z: number } | null;
        objLetter: string | null;
    }
    const _pending: PendingObservation[] = [];
    let _centT1: { x: number; y: number; z: number } | null = null;
    let _centT2: { x: number; y: number; z: number } | null = null;
    function _vecPos(v: mod.Vector | null): { x: number; y: number; z: number } | null {
        if (!v) return null;
        try {
            return { x: mod.XComponentOf(v), y: mod.YComponentOf(v), z: mod.ZComponentOf(v) };
        } catch (_e) { return null; }
    }
    function _classifyByCentroid(pos: { x: number; y: number; z: number } | null): number {
        if (!pos || !_centT1 || !_centT2) return 0;
        const d1 = (pos.x - _centT1.x) * (pos.x - _centT1.x) + (pos.z - _centT1.z) * (pos.z - _centT1.z);
        const d2 = (pos.x - _centT2.x) * (pos.x - _centT2.x) + (pos.z - _centT2.z) * (pos.z - _centT2.z);
        return d1 < d2 ? 1 : 2;
    }
    function _addCatalogEntry(p: PendingObservation, teamId: number): void {
        const cand = takeCandidate();
        if (!cand) {
            logD(`[Discovery] WARNING: No candidate handle for ${p.meta.label} T${teamId}`);
            return;
        }
        const matchTypes = getFactionMatchTypes(p.vehicleType);
        let posVec: mod.Vector | null = null;
        if (p.pos) {
            try { posVec = mod.CreateVector(p.pos.x, p.pos.y, p.pos.z); } catch (_e) {}
        }
        const entry: DiscoveredVehicleSpawner = {
            spawnerId: cand.spawnerId,
            spawner: cand.spawner,
            position: posVec,
            vehicleType: p.vehicleType,
            matchTypes: matchTypes,
            label: p.meta.label,
            category: p.meta.category,
            teamId: teamId,
            objectiveLetter: p.objLetter,
            needsForceSpawn: p.objLetter !== null || isJetType(p.vehicleType),
        };
        discoveredVehicleSpawners.push(entry);
        confirmedSpawnerIds.add(cand.spawnerId);
        spawnerTeamCache.set(cand.spawnerId, teamId);
        logD(`[Discovery] Cataloged ${p.meta.label} T${teamId}${p.objLetter ? ' [obj ' + p.objLetter + ']' : ''}`);
    }
    function _refreshCentroids(): void {
        let n1 = 0, sx1 = 0, sy1 = 0, sz1 = 0;
        let n2 = 0, sx2 = 0, sy2 = 0, sz2 = 0;
        for (const p of _pending) {
            if (!p.pos) continue;
            const ft = getStrongAnchorTeam(p.vehicleType);
            if (ft === 1) { n1++; sx1 += p.pos.x; sy1 += p.pos.y; sz1 += p.pos.z; }
            else if (ft === 2) { n2++; sx2 += p.pos.x; sy2 += p.pos.y; sz2 += p.pos.z; }
        }
        for (const ds of discoveredVehicleSpawners) {
            if (!ds.vehicleType || !ds.position) continue;
            const ft = getStrongAnchorTeam(ds.vehicleType);
            const pos = _vecPos(ds.position);
            if (!pos) continue;
            if (ft === 1 && ds.teamId === 1) { n1++; sx1 += pos.x; sy1 += pos.y; sz1 += pos.z; }
            else if (ft === 2 && ds.teamId === 2) { n2++; sx2 += pos.x; sy2 += pos.y; sz2 += pos.z; }
        }
        _centT1 = n1 > 0 ? { x: sx1 / n1, y: sy1 / n1, z: sz1 / n1 } : null;
        _centT2 = n2 > 0 ? { x: sx2 / n2, y: sy2 / n2, z: sz2 / n2 } : null;
    }
    function _flushPending(): number {
        _refreshCentroids();
        const haveBothCentroids = _centT1 !== null && _centT2 !== null;
        let flushed = 0;
        for (let i = _pending.length - 1; i >= 0; i--) {
            const p = _pending[i];
            const ft = getStrongAnchorTeam(p.vehicleType);
            let teamId = 0;
            if (ft !== 0) teamId = ft;
            else if (haveBothCentroids) teamId = _classifyByCentroid(p.pos);
            if (teamId === 0) continue;
            _pending.splice(i, 1);
            _addCatalogEntry(p, teamId);
            flushed++;
        }
        if (flushed > 0) _refreshCentroids();
        return flushed;
    }
    let _syntheticObjIdCounter = -1000000;
    const _noObjIdFingerprints = new Set<string>();
    export function AutoDiscovery_OnVehicleSpawned(vehicle: mod.Vehicle): void {
        let vObjId = -1;
        try { vObjId = mod.GetObjId(vehicle); } catch (_e) {}
        const meta = identifyVehicleType(vehicle);
        if (!meta) {
            if (vObjId >= 0 && !observedVehicleObjIds.has(vObjId)) {
                observedVehicleObjIds.add(vObjId);
                logD(`[Discovery] WARNING: vehicle ${vObjId} did not match any known VehicleList entry`);
            } else if (vObjId < 0) {
                logD(`[Discovery] WARNING: no-ObjId vehicle did not match any known VehicleList entry`);
            }
            return;
        }
        let posVec: mod.Vector | null = null;
        try { posVec = mod.GetVehicleState(vehicle, mod.VehicleStateVector.VehiclePosition) as mod.Vector; } catch (_e) {}
        const pos = _vecPos(posVec);
        if (vObjId < 0) {
            if (pos) {
                const fp = `${meta.type}@${Math.round(pos.x)},${Math.round(pos.z)}`;
                if (_noObjIdFingerprints.has(fp)) return;
                _noObjIdFingerprints.add(fp);
            }
            vObjId = _syntheticObjIdCounter--;
        }
        if (observedVehicleObjIds.has(vObjId)) return;
        observedVehicleObjIds.add(vObjId);
        const objLetter = (posVec && !discoveryComplete) ? nearestObjectiveLetter(posVec) : null;
        _pending.push({ objId: vObjId, vehicleType: meta.type, meta, pos, objLetter });
        _flushPending();
    }
    function getFactionCounterpart(vt: mod.VehicleList): mod.VehicleList | null {
        for (const pair of FACTION_PAIRS) {
            if (pair[0] === vt) return pair[1];
            if (pair[1] === vt) return pair[0];
        }
        return null;
    }
    function findVehicleMeta(vt: mod.VehicleList): { type: mod.VehicleList; label: string; category: 'Ground' | 'Air' } | null {
        for (const m of ALL_VEHICLE_TYPES) if (m.type === vt) return m;
        return null;
    }
    export function AutoDiscovery_MirrorFactionPairs(): number {
        let added = 0;
        for (let i = discoveredVehicleSpawners.length - 1; i >= 0; i--) {
            const ds = discoveredVehicleSpawners[i];
            if (!ds.needsForceSpawn) continue;       // only phantoms
            if (!ds.vehicleType) continue;
            if (!isJetType(ds.vehicleType)) continue;
            const realExists = discoveredVehicleSpawners.some((d, j) =>
                j !== i &&
                !d.needsForceSpawn &&
                d.teamId === ds.teamId &&
                d.vehicleType === ds.vehicleType
            );
            if (realExists) {
                logD(`[Discovery] Pruned phantom mirror ${ds.label} T${ds.teamId} (real spawner ${i !== -1 ? 'now' : ''} cataloged)`);
                discoveredVehicleSpawners.splice(i, 1);
                confirmedSpawnerIds.delete(ds.spawnerId);
                spawnerTeamCache.delete(ds.spawnerId);
            }
        }
        const snapshot = discoveredVehicleSpawners.slice();
        for (const ds of snapshot) {
            if (!ds.vehicleType) continue;
            if (!isJetType(ds.vehicleType)) continue; // jets only
            const otherTeam = ds.teamId === 1 ? 2 : ds.teamId === 2 ? 1 : 0;
            if (otherTeam === 0) continue;
            const counterType = getFactionCounterpart(ds.vehicleType);
            if (!counterType || !isJetType(counterType)) continue;
            const dup = discoveredVehicleSpawners.some(d =>
                d.teamId === otherTeam && d.vehicleType === counterType
            );
            if (dup) continue;
            const meta = findVehicleMeta(counterType);
            if (!meta) continue;
            const cand = takeCandidate();
            if (!cand) continue;
            const mirrored: DiscoveredVehicleSpawner = {
                spawnerId: cand.spawnerId,
                spawner: cand.spawner,
                position: null,
                vehicleType: counterType,
                matchTypes: [counterType],
                label: meta.label,
                category: meta.category,
                teamId: otherTeam,
                objectiveLetter: ds.objectiveLetter,
                needsForceSpawn: true, // phantom handle, force-spawn fallback
            };
            discoveredVehicleSpawners.push(mirrored);
            confirmedSpawnerIds.add(cand.spawnerId);
            spawnerTeamCache.set(cand.spawnerId, otherTeam);
            added++;
            logD(`[Discovery] Mirrored JET ${meta.label} T${otherTeam} (counterpart of ${ds.label} T${ds.teamId})`);
        }
        return added;
    }
    function _legacyMirrorFactionPairs_DISABLED(): number {
        let added = 0;
        const snapshot = discoveredVehicleSpawners.slice();
        for (const ds of snapshot) {
            if (!ds.vehicleType) continue;
            const otherTeam = ds.teamId === 1 ? 2 : ds.teamId === 2 ? 1 : 0;
            if (otherTeam === 0) continue;
            const counterType = getFactionCounterpart(ds.vehicleType) || ds.vehicleType;
            const matchTypes = getFactionMatchTypes(counterType);
            const dup = discoveredVehicleSpawners.some(d =>
                d.teamId === otherTeam && d.vehicleType !== null &&
                (d.vehicleType === counterType || matchTypes.indexOf(d.vehicleType) >= 0)
            );
            if (dup) continue;
            const meta = findVehicleMeta(counterType);
            if (!meta) continue;
            const cand = takeCandidate();
            if (!cand) continue;
            const mirrored: DiscoveredVehicleSpawner = {
                spawnerId: cand.spawnerId,
                spawner: cand.spawner,
                position: null,
                vehicleType: counterType,
                matchTypes: matchTypes,
                label: meta.label,
                category: meta.category,
                teamId: otherTeam,
                objectiveLetter: ds.objectiveLetter,
                needsForceSpawn: true, // phantom handle, always needs force-spawn fallback
            };
            discoveredVehicleSpawners.push(mirrored);
            confirmedSpawnerIds.add(cand.spawnerId);
            spawnerTeamCache.set(cand.spawnerId, otherTeam);
            added++;
            logD(`[Discovery] Mirrored ${meta.label} T${otherTeam} (counterpart of ${ds.label} T${ds.teamId})`);
        }
        return added;
    }
    export function AutoDiscovery_DetectVehicleLayout(): void {
    }
    export function AutoDiscovery_IdentifyVehicles(): number {
        if (discoveryComplete) return 0;
        const now = mod.GetMatchTimeElapsed();
        if (firstObservationTime < 0 && discoveredVehicleSpawners.length > 0) {
            firstObservationTime = now;
        }
        if (firstObservationTime >= 0 && (now - firstObservationTime) >= DISCOVERY_SETTLE_SECONDS) {
            discoveryComplete = true;
            logD(`[Discovery] OBSERVATION SETTLED: ${discoveredVehicleSpawners.length} (team, type) entries`);
        } else if (now > 15 && discoveredVehicleSpawners.length === 0) {
            discoveryComplete = true;
            logD(`[Discovery] WARNING: 15s elapsed with no observations`);
        }
        return discoveredVehicleSpawners.length;
    }
    export function getIdentifiedVehicleCount(): number {
        let c = 0;
        for (const ds of discoveredVehicleSpawners) if (ds.vehicleType !== null) c++;
        return c;
    }
    export function AutoDiscovery_IsComplete(): boolean { return discoveryComplete; }
    export function AutoDiscovery_HasPendingLabelCorrections(): boolean {
        if (labelCorrectionsNeeded) { labelCorrectionsNeeded = false; return true; }
        return false;
    }
    export function AutoDiscovery_UpdateSpawnerActualType(spawnerId: number, vehicle: mod.Vehicle): void {
        const ds = discoveredVehicleSpawners.find(d => d.spawnerId === spawnerId);
        if (!ds || !ds.vehicleType) return;
        const id = identifyVehicleType(vehicle);
        if (!id) return;
        if (id.type === ds.vehicleType) return;
        if (ds.teamId !== 0 && !isFactionAppropriate(id.type, ds.teamId)) {
            logV(`[Discovery] Blocked cross-faction correction spawner ${spawnerId}`);
            return;
        }
        if (isJetType(id.type)) return;
        logD(`[Discovery] Corrected spawner ${spawnerId}: ${ds.label} -> ${id.label}`);
        ds.vehicleType = id.type;
        ds.label = id.label;
        ds.category = id.category;
        labelCorrectionsNeeded = true;
    }
    export function AutoDiscovery_ConfirmSpawner(spawnerId: number, teamId: number): void {
        confirmedSpawnerIds.add(spawnerId);
        const ds = discoveredVehicleSpawners.find(d => d.spawnerId === spawnerId);
        if (ds && ds.teamId === 0 && (teamId === 1 || teamId === 2)) {
            ds.teamId = teamId;
            spawnerTeamCache.set(spawnerId, teamId);
        }
    }
    export function AutoDiscovery_GetAlternateSpawners(currentSpawnerId: number, teamId: number): number[] {
        const alts: number[] = [];
        for (const ds of discoveredVehicleSpawners) {
            if (ds.spawnerId === currentSpawnerId) continue;
            if (ds.teamId !== teamId) continue;
            alts.push(ds.spawnerId);
        }
        for (const c of candidateSpawners) {
            if (c.used) continue;
            if (c.spawnerId === currentSpawnerId) continue;
            alts.push(c.spawnerId);
        }
        return alts;
    }
    export function getDiscoveredVehiclesForTeam(teamId: number): DiscoveredVehicleSpawner[] {
        return discoveredVehicleSpawners.filter(v => v.teamId === teamId && v.vehicleType !== null);
    }
    export function AutoDiscovery_EnableAutoSpawnProbe(): void { autoSpawnProbeActive = false; }
    export function AutoDiscovery_FinalizeAutoSpawnProbe(): void { autoSpawnProbeActive = false; }
    export function AutoDiscovery_IsAutoSpawnProbeActive(): boolean { return autoSpawnProbeActive; }
    interface PendingDisable { spawnerId: number; label: string; enabledAt: number; }
    const captureRewardsGiven: Set<number> = new Set();
    const pendingAutoSpawnDisables: PendingDisable[] = [];
    const REWARD_DISABLE_DELAY_SECONDS = 30.0;
    const REWARD_VEHICLE_POOL: { type: mod.VehicleList; label: string }[] = [
        { type: mod.VehicleList.Marauder, label: "Marauder" },
        { type: mod.VehicleList.Vector,   label: "Vector"   },
        { type: mod.VehicleList.Flyer60,  label: "Flyer"    },
        { type: mod.VehicleList.AH6M,     label: "AH6M"     },
        { type: mod.VehicleList.UH60,     label: "UH60"     },
    ];
    export function AutoDiscovery_DisableObjectiveSpawners(): void {
        let count = 0;
        captureRewardsGiven.clear();
        pendingAutoSpawnDisables.length = 0;
        for (const ds of discoveredVehicleSpawners) {
            if (!ds.objectiveLetter) continue;
            try { mod.SetVehicleSpawnerAutoSpawn(ds.spawner, false); count++; } catch (_e) {}
        }
        if (count > 0) logD(`[Discovery] Disabled ${count} capture-reward spawner(s)`);
    }
    export function AutoDiscovery_OnObjectiveCaptured(objId: number, capturingTeamId: number): void {
        const obj = OBJECTIVES.find(o => o.objId === objId);
        if (!obj) return;
        const letter = obj.id;
        const rewards = discoveredVehicleSpawners.filter(ds => ds.objectiveLetter === letter);
        for (const ds of rewards) {
            if (captureRewardsGiven.has(ds.spawnerId)) continue;
            captureRewardsGiven.add(ds.spawnerId);
            const pick = REWARD_VEHICLE_POOL[Math.floor(Math.random() * REWARD_VEHICLE_POOL.length)];
            try {
                mod.SetVehicleSpawnerVehicleType(ds.spawner, pick.type);
                mod.SetVehicleSpawnerAutoSpawn(ds.spawner, true);
                logD(`[CaptureReward] obj ${letter} captured by T${capturingTeamId} -> ${pick.label}`);
            } catch (e) {
                logD(`[CaptureReward] enable failed spawner ${ds.spawnerId}: ${e}`);
                continue;
            }
            pendingAutoSpawnDisables.push({
                spawnerId: ds.spawnerId,
                label: `${pick.label} at obj ${letter}`,
                enabledAt: mod.GetMatchTimeElapsed(),
            });
        }
    }
    export function AutoDiscovery_TickCaptureRewards(): void {
        if (pendingAutoSpawnDisables.length === 0) return;
        const t = mod.GetMatchTimeElapsed();
        for (let i = pendingAutoSpawnDisables.length - 1; i >= 0; i--) {
            const p = pendingAutoSpawnDisables[i];
            if (t - p.enabledAt < REWARD_DISABLE_DELAY_SECONDS) continue;
            pendingAutoSpawnDisables.splice(i, 1);
            try {
                const sp = mod.GetVehicleSpawner(p.spawnerId);
                mod.SetVehicleSpawnerAutoSpawn(sp, false);
                logD(`[CaptureReward] disabled ${p.label}`);
            } catch (e) {
                logD(`[CaptureReward] disable error spawner ${p.spawnerId}: ${e}`);
            }
        }
    }
    export function AutoDiscovery_Init(): void {
        if (discoveryComplete) return;
        logD("=".repeat(50));
        logD("[Discovery] Zero-Config Passive-Observation Discovery starting...");
        try {
            mod.SetVehicleCategoryAllowedInSurroundingArea(mod.VehicleCategories.Air_Plane, true);
        } catch (_e) {}
        discoverObjectives();
        discoverAISpawners();
        const t1Obj: number[] = [];
        const t2Obj: number[] = [];
        for (let i = 1; i <= 10; i++) {
            if (probeSpawner(4100 + i)) t1Obj.push(4100 + i);
            if (probeSpawner(4200 + i)) t2Obj.push(4200 + i);
        }
        TEAM1_OBJ_SPAWNER_IDS = t1Obj;
        TEAM2_OBJ_SPAWNER_IDS = t2Obj;
        if (t1Obj.length > 0 || t2Obj.length > 0) {
            logD(`[Discovery] Objective Spawners T1=[${t1Obj.join(",")}] T2=[${t2Obj.join(",")}]`);
        }
        discoverVehicleSpawners();
        try {
            const all = mod.AllVehicles();
            const n = mod.CountOf(all);
            for (let i = 0; i < n; i++) {
                const v = mod.ValueInArray(all, i) as mod.Vehicle;
                if (v) AutoDiscovery_OnVehicleSpawned(v);
            }
            logD(`[Discovery] Init sweep: ${n} pre-existing vehicles`);
        } catch (_e) {}
        logD("[Discovery] Init done -- passive observation active");
        logD("=".repeat(50));
    }
    export function AutoDiscovery_ResweepLiveVehicles(): number {
        let added = 0;
        try {
            const all = mod.AllVehicles();
            const n = mod.CountOf(all);
            const before = discoveredVehicleSpawners.length;
            for (let i = 0; i < n; i++) {
                const v = mod.ValueInArray(all, i) as mod.Vehicle;
                if (v) AutoDiscovery_OnVehicleSpawned(v);
            }
            added = discoveredVehicleSpawners.length - before;
        } catch (_e) {}
        return added;
    }
}


// ===== Module: modules/VehicleSpawnUIModule.ts =====
namespace VehicleUIStandalone {
    let vehicleUIInitialized = false;
    const playerPanels: Map<number, UI.UIContainer> = new Map();
    const playerPanelTeam: Map<number, number> = new Map();
    const playerButtons: Map<number, Map<number, UI.UITextButton>> = new Map();
    const playerButtonStateSetters: Map<number, Map<number, SolidUI.Setter<ButtonVisualState>>> = new Map();
    const playerPanelDisposers: Map<number, () => void> = new Map();
    const playerUIVisible: Set<number> = new Set();
    interface ButtonVisualState {
        enabled: boolean;
        baseColor: mod.Vector;
    }
    const suppressUIUntilByPlayerId: Map<number, number> = new Map();
    const pendingDeploySeat: Map<number, { vehicleObjId: number; seatIndex: number; label: string; seatGen: number; claimRequestedPilot: boolean }> = new Map();
    interface PendingSpawnRequest {
        spawnerId: number;
        teamId: number;
        vehicleType: mod.VehicleList;
        matchTypes: mod.VehicleList[];
        label: string;
        seatGen: number;
        time: number;
    }
    const pendingSpawnRequestsByPlayerId: Map<number, PendingSpawnRequest> = new Map();
    const assignedSpawnedVehicleIdByPlayerId: Map<number, number> = new Map();
    const MAX_SPAWN_ASSIGN_SECONDS = 8.0;
    const ATTACK_HELI_SPAWN_WAIT_SECONDS = 45.0;
    const playerSeatGeneration: Map<number, number> = new Map();
    let lastButtonClickTime = 0;
    const BUTTON_DEBOUNCE_SECONDS = 1.0;
    const UI_PANEL_ANCHOR = mod.UIAnchor.TopCenter;
    const UI_PANEL_X = 0;
    const UI_PANEL_Y = 170;   // moved further down to clear ticket bar AND A-E flag row in deploy screen
    const BUTTON_SIZE = 50;
    const BUTTON_GAP = 6;
    const ROW_HEIGHT = BUTTON_SIZE + 10; // unused - single row only
    const BUTTONS_PER_ROW = 999;        // all buttons in one row, no wrapping
    const MAX_BUTTONS = 999;            // cap how many vehicle buttons show per team (999 = no limit)
    const CLICK_DIAGNOSTICS = true;
    function clickToast(player: mod.Player, msg: string): void {
        if (!CLICK_DIAGNOSTICS) return;
        try {
            mod.DisplayCustomNotificationMessage(
                mod.Message("{0}", "[VUI] " + msg),
                mod.CustomNotificationSlots.MessageText1,
                3.0,
                player
            );
        } catch (_e) {}
    }
    type VehicleCategory = 'Ground' | 'Air';
    interface VehicleDef {
        type: mod.VehicleList;
        label: string;
        spawnerId: number;
        category: VehicleCategory;
        matchTypes?: mod.VehicleList[];
    }
    let team1Vehicles: VehicleDef[] = [];
    let team2Vehicles: VehicleDef[] = [];
    let _lastBuildSig: string = "";
    function buildVehicleDefsFromDiscovery(): void {
        try { AutoDiscovery_MirrorFactionPairs(); } catch (_e) {}
        team1Vehicles = [];
        team2Vehicles = [];
        const probeTypes: mod.VehicleList[] = [];
        for (const vs of discoveredVehicleSpawners) {
            const types = vs.matchTypes ?? (vs.vehicleType ? [vs.vehicleType] : []);
            for (const t of types) {
                let dup = false;
                for (let i = 0; i < probeTypes.length; i++) { if (probeTypes[i] === t) { dup = true; break; } }
                if (!dup) probeTypes.push(t);
            }
        }
        const liveTypeFlags: boolean[] = new Array(probeTypes.length).fill(false);
        try {
            const allV = mod.AllVehicles();
            if (allV) {
                const c = mod.CountOf(allV);
                for (let i = 0; i < c; i++) {
                    const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                    if (!v) continue;
                    for (let p = 0; p < probeTypes.length; p++) {
                        if (liveTypeFlags[p]) continue;
                        try { if (mod.CompareVehicleName(v, probeTypes[p])) liveTypeFlags[p] = true; } catch (_e) {}
                    }
                }
            }
        } catch (_e) {}
        const isTypeLive = (t: mod.VehicleList): boolean => {
            for (let i = 0; i < probeTypes.length; i++) { if (probeTypes[i] === t) return liveTypeFlags[i]; }
            return false;
        };
        let droppedPhantom = 0;
        for (const vs of discoveredVehicleSpawners) {
            if (vs.vehicleType === null) continue;
            if (vs.objectiveLetter) continue;
            if (!confirmedSpawnerIds.has(vs.spawnerId)) {
                const types = vs.matchTypes ?? [vs.vehicleType];
                let anyLive = false;
                for (const t of types) { if (isTypeLive(t)) { anyLive = true; break; } }
                if (!anyLive) { droppedPhantom++; continue; }
            }
            const def: VehicleDef = {
                type: vs.vehicleType,
                label: vs.label,
                spawnerId: vs.spawnerId,
                category: vs.category,
                matchTypes: vs.matchTypes,
            };
            if (vs.teamId === 1) team1Vehicles.push(def);
            else if (vs.teamId === 2) team2Vehicles.push(def);
        }
        const sig = `T1=${team1Vehicles.length}|T2=${team2Vehicles.length}|drop=${droppedPhantom}`;
        if (sig !== _lastBuildSig) {
            _lastBuildSig = sig;
            log(`[VehicleUI] Built vehicle defs from discovery: T1=${team1Vehicles.length}, T2=${team2Vehicles.length}${droppedPhantom > 0 ? ` (dropped ${droppedPhantom} phantom hints)` : ''}`);
        }
    }
    function currentSpawnerSetSignature(): string {
        const t1 = team1Vehicles.map(v => v.spawnerId).sort((a, b) => a - b).join(',');
        const t2 = team2Vehicles.map(v => v.spawnerId).sort((a, b) => a - b).join(',');
        return `T1[${t1}]|T2[${t2}]`;
    }
    function getTeam1Vehicles(): VehicleDef[] { return team1Vehicles; }
    function getTeam2Vehicles(): VehicleDef[] { return team2Vehicles; }
    const jetCooldownByPlayerId: Map<number, number> = new Map();
    const JET_COOLDOWN_SECONDS = 30.0;
    const JET_VEHICLE_TYPES: mod.VehicleList[] = [mod.VehicleList.F22, mod.VehicleList.F16, mod.VehicleList.JAS39, mod.VehicleList.SU57];
    const ALL_KNOWN_VEHICLE_TYPES: mod.VehicleList[] = [
        mod.VehicleList.Abrams, mod.VehicleList.AH64, mod.VehicleList.AH6M, mod.VehicleList.AH6M_Pax,
        mod.VehicleList.Cheetah, mod.VehicleList.CV90, mod.VehicleList.DirtBike, mod.VehicleList.DirtBike_Pax,
        mod.VehicleList.Eurocopter, mod.VehicleList.F16, mod.VehicleList.F22, mod.VehicleList.Flyer60,
        mod.VehicleList.Gepard, mod.VehicleList.GolfCart, mod.VehicleList.JAS39, mod.VehicleList.Leopard,
        mod.VehicleList.M2Bradley, mod.VehicleList.Marauder, mod.VehicleList.Marauder_Pax,
        mod.VehicleList.Quadbike, mod.VehicleList.RHIB, mod.VehicleList.SU57, mod.VehicleList.UH60,
        mod.VehicleList.UH60_Pax, mod.VehicleList.Vector,
    ];
    const SEAT_TRANSITION_SCREEN_EFFECT: mod.ScreenEffects = mod.ScreenEffects.Stealth;
    function isJetVehicle(vehicleType: mod.VehicleList): boolean { return JET_VEHICLE_TYPES.includes(vehicleType); }
    function isAttackHeliVehicleType(vt: mod.VehicleList): boolean { return vt === mod.VehicleList.AH6M || vt === mod.VehicleList.AH6M_Pax || vt === mod.VehicleList.AH64 || vt === mod.VehicleList.Eurocopter; }
    function includesAttackHeli(vts: mod.VehicleList[]): boolean { for (const vt of vts) { if (isAttackHeliVehicleType(vt)) return true; } return false; }
    function getJetCooldownRemaining(pid: number): number { const e = jetCooldownByPlayerId.get(pid); if (!e) return 0; const r = e - mod.GetMatchTimeElapsed(); return r > 0 ? r : 0; }
    function setJetCooldown(pid: number): void { jetCooldownByPlayerId.set(pid, mod.GetMatchTimeElapsed() + JET_COOLDOWN_SECONDS); }
    function hasIdleMatchingJet(matchTypes: mod.VehicleList[], teamId: number = 0): boolean {
        const wantsJet = matchTypes.some(t => JET_VEHICLE_TYPES.includes(t));
        try {
            const allV = mod.AllVehicles();
            if (!allV) return false;
            const vc = mod.CountOf(allV);
            for (let i = 0; i < vc; i++) {
                const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                if (!v) continue;
                if (!matchesAnyVehicleType(v, matchTypes)) continue;
                let vid = 0;
                try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                if (vid === 0) continue;
                if (reservedVehicleIds.has(vid)) continue;
                let occ = true;
                try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                if (!occ) return true;
            }
            if (!wantsJet || teamId === 0) return false;
            const jetAnchors: { x: number; y: number; z: number }[] = [];
            for (let i = 0; i < vc; i++) {
                const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                if (!v) continue;
                let isAnyKnownJet = false;
                try {
                    isAnyKnownJet =
                        mod.CompareVehicleName(v, mod.VehicleList.F22) ||
                        mod.CompareVehicleName(v, mod.VehicleList.F16) ||
                        mod.CompareVehicleName(v, mod.VehicleList.JAS39) ||
                        mod.CompareVehicleName(v, mod.VehicleList.SU57);
                } catch (_e) {}
                if (!isAnyKnownJet) continue;
                const p = getVehiclePosition(v);
                if (!p) continue;
                jetAnchors.push({
                    x: mod.XComponentOf(p),
                    y: mod.YComponentOf(p),
                    z: mod.ZComponentOf(p),
                });
            }
            const hq = AutoDiscovery_GetTeamHQCentroid(teamId);
            if (hq) jetAnchors.push(hq);
            if (jetAnchors.length === 0) return false;
            const TIGHT_SQ = 400.0 * 400.0;
            const HQ_SQ = 1500.0 * 1500.0;
            for (let i = 0; i < vc; i++) {
                const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                if (!v) continue;
                let occ = true;
                try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                if (occ) continue;
                let isAnyKnown = false;
                try {
                    for (const def of ALL_KNOWN_VEHICLE_TYPES) {
                        if (mod.CompareVehicleName(v, def)) { isAnyKnown = true; break; }
                    }
                } catch (_e) {}
                if (isAnyKnown) continue;
                let vid = 0;
                try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                if (vid === 0) continue;
                if (reservedVehicleIds.has(vid)) continue;
                const p = getVehiclePosition(v);
                if (!p) continue;
                const px = mod.XComponentOf(p);
                const py = mod.YComponentOf(p);
                const pz = mod.ZComponentOf(p);
                for (let ai = 0; ai < jetAnchors.length; ai++) {
                    const a = jetAnchors[ai];
                    const dx = px - a.x, dy = py - a.y, dz = pz - a.z;
                    const distSq = dx * dx + dy * dy + dz * dz;
                    const isHqAnchor = (hq !== null && ai === jetAnchors.length - 1);
                    const limit = isHqAnchor ? HQ_SQ : TIGHT_SQ;
                    if (distSq <= limit) return true;
                }
            }
        } catch (_e) {}
        return false;
    }
    function showVehicleRequestNotification(message: string): void {
        try { mod.DisplayCustomNotificationMessage(mod.Message("{0}", message), mod.CustomNotificationSlots.MessageText1, 1.5); } catch (_e) {}
    }
    type VehicleAvailability = 'empty' | 'full' | 'cooldown' | 'no_vehicle';
    interface SpawnerState {
        spawnerId: number;
        vehicleDef: VehicleDef;
        availability: VehicleAvailability;
        vehicleObjId: number | null;
        cooldownStartTime: number;
        cooldownDuration: number;
        firstEmptySeat: number;
        totalSeats: number;
        occupiedSeats: number;
    }
    const spawnerStateMap: Map<number, SpawnerState> = new Map();
    const vehicleIdToSpawnerId: Map<number, number> = new Map();
    const SPAWNER_COOLDOWN_SECONDS = 30.0;
    let lastUIStatusUpdateTime = 0;
    const UI_STATUS_UPDATE_INTERVAL = 0.5;
    const badVehicleIds: Set<number> = new Set();
    let lastBadVehicleClearTime = 0;
    const BAD_VEHICLE_CLEAR_INTERVAL = 300.0;
    const vehicleInitialPosition: Map<number, mod.Vector> = new Map();
    const HQ_EMPTY_DEPLOY_RADIUS = 60.0;
    const ABANDONED_VEHICLE_DISTANCE = 5000.0;
    function getVehiclePosition(vehicle: mod.Vehicle): mod.Vector | null {
        try { return mod.GetVehicleState(vehicle, mod.VehicleStateVector.VehiclePosition); } catch (_e) { return null; }
    }
    function getVehicleDistanceFromSpawn(vehicle: mod.Vehicle, vehicleObjId: number): number {
        const initialPos = vehicleInitialPosition.get(vehicleObjId);
        if (!initialPos) return -1;
        try {
            const currentPos = getVehiclePosition(vehicle);
            if (!currentPos) return -1;
            const dx = mod.XComponentOf(currentPos) - mod.XComponentOf(initialPos);
            const dy = mod.YComponentOf(currentPos) - mod.YComponentOf(initialPos);
            const dz = mod.ZComponentOf(currentPos) - mod.ZComponentOf(initialPos);
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
        } catch (_e) { return -1; }
    }
    function getSpawnerSearchDistance(spawnerId: number): number {
        const state = spawnerStateMap.get(spawnerId);
        return state?.vehicleDef.category === 'Air' ? 150.0 : 80.0;
    }
    function initSpawnerStateTracking(): void {
        spawnerStateMap.clear();
        vehicleIdToSpawnerId.clear();
        vehicleInitialPosition.clear();
        const allDefs = [...getTeam1Vehicles(), ...getTeam2Vehicles()];
        for (const def of allDefs) {
            if (!spawnerStateMap.has(def.spawnerId)) {
                spawnerStateMap.set(def.spawnerId, {
                    spawnerId: def.spawnerId,
                    vehicleDef: def,
                    availability: 'no_vehicle',
                    vehicleObjId: null,
                    cooldownStartTime: 0,
                    cooldownDuration: SPAWNER_COOLDOWN_SECONDS,
                    firstEmptySeat: -1,
                    totalSeats: 0,
                    occupiedSeats: 0,
                });
            }
        }
    }
    const HQ_REPLACEMENT_RADIUS_SQ = 100.0 * 100.0;
    function trySwapToFresherVehicle(state: SpawnerState, oldVid: number): boolean {
        const oldInitPos = vehicleInitialPosition.get(oldVid);
        if (!oldInitPos) return false;
        const matchTypes = state.vehicleDef.matchTypes ?? [state.vehicleDef.type];
        let bestVid = 0;
        let bestVehicle: mod.Vehicle | null = null;
        let bestDistSq = HQ_REPLACEMENT_RADIUS_SQ;
        try {
            const all = mod.AllVehicles();
            if (!all) return false;
            const count = mod.CountOf(all);
            for (let i = 0; i < count; i++) {
                const v = mod.ValueInArray(all, i) as mod.Vehicle;
                if (!v) continue;
                let vid = 0;
                try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                if (vid === 0 || vid === oldVid) continue;
                if (vehicleIdToSpawnerId.has(vid)) continue;
                if (reservedVehicleIds.has(vid)) continue;
                let occ = true;
                try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                if (occ) continue;
                if (!matchesAnyVehicleType(v, matchTypes)) continue;
                const pos = getVehiclePosition(v);
                if (!pos) continue;
                const dx = mod.XComponentOf(pos) - mod.XComponentOf(oldInitPos);
                const dy = mod.YComponentOf(pos) - mod.YComponentOf(oldInitPos);
                const dz = mod.ZComponentOf(pos) - mod.ZComponentOf(oldInitPos);
                const distSq = dx * dx + dy * dy + dz * dz;
                if (distSq < bestDistSq) {
                    bestDistSq = distSq;
                    bestVid = vid;
                    bestVehicle = v;
                }
            }
        } catch (_e) { return false; }
        if (!bestVehicle || bestVid === 0) return false;
        vehicleIdToSpawnerId.delete(oldVid);
        vehicleInitialPosition.delete(oldVid);
        state.vehicleObjId = bestVid;
        vehicleIdToSpawnerId.set(bestVid, getSpawnerIdForState(state));
        const initPos = getVehiclePosition(bestVehicle);
        if (initPos) vehicleInitialPosition.set(bestVid, initPos);
        log(`[VehicleUI] Swapped ${state.vehicleDef.label} link: abandoned ${oldVid} -> fresh ${bestVid} (dist=${Math.sqrt(bestDistSq).toFixed(1)}m)`);
        return true;
    }
    function getSpawnerIdForState(state: SpawnerState): number {
        for (const [id, s] of spawnerStateMap) if (s === state) return id;
        return -1;
    }
    function probeVehicleSeats(state: SpawnerState): void {
        if (state.vehicleObjId === null) {
            state.availability = state.availability === 'cooldown' ? 'cooldown' : 'no_vehicle';
            state.firstEmptySeat = -1; state.totalSeats = 0; state.occupiedSeats = 0;
            return;
        }
        const vehicle = findVehicleById(state.vehicleObjId);
        if (!vehicle) {
            vehicleIdToSpawnerId.delete(state.vehicleObjId);
            vehicleInitialPosition.delete(state.vehicleObjId);
            state.vehicleObjId = null; state.availability = 'no_vehicle';
            state.firstEmptySeat = -1; state.totalSeats = 0; state.occupiedSeats = 0;
            return;
        }
        let seatCount = 1;
        try { seatCount = mod.GetVehicleSeatCount(vehicle); } catch (_e) {}
        if (isJetVehicle(state.vehicleDef.type)) seatCount = 1;
        state.totalSeats = seatCount;
        let occupiedCount = 0; let firstEmpty = -1;
        let seatCheckErrors = 0;
        for (let s = 0; s < seatCount; s++) {
            try {
                if (mod.IsVehicleSeatOccupied(vehicle, s)) occupiedCount++;
                else if (firstEmpty === -1) firstEmpty = s;
            } catch (_e) { seatCheckErrors++; }
        }
        if (seatCheckErrors === seatCount && occupiedCount === 0) {
            try { if (mod.IsVehicleOccupied(vehicle)) { occupiedCount = 1; firstEmpty = -1; } } catch (_e) {}
        }
        state.occupiedSeats = occupiedCount;
        state.firstEmptySeat = firstEmpty;
        if (occupiedCount === 0) {
            const isAir = state.vehicleDef.category === 'Air';
            if (!isAir) {
                const dist = getVehicleDistanceFromSpawn(vehicle, state.vehicleObjId!);
                if (dist >= 0 && dist > ABANDONED_VEHICLE_DISTANCE) {
                    vehicleIdToSpawnerId.delete(state.vehicleObjId!);
                    vehicleInitialPosition.delete(state.vehicleObjId!);
                    state.vehicleObjId = null; state.availability = 'no_vehicle';
                    state.firstEmptySeat = -1; state.totalSeats = 0; state.occupiedSeats = 0;
                    return;
                }
                if (dist >= 0 && dist > HQ_EMPTY_DEPLOY_RADIUS) {
                    const swapped = trySwapToFresherVehicle(state, state.vehicleObjId!);
                    if (swapped) {
                        probeVehicleSeats(state);
                        return;
                    }
                    state.availability = 'no_vehicle';
                    return;
                }
            }
            state.availability = 'empty';
        } else if (firstEmpty !== -1) {
            let seat0Occupied = false;
            try { seat0Occupied = mod.IsVehicleSeatOccupied(vehicle, 0); } catch (_e) {}
            state.availability = seat0Occupied ? 'full' : 'empty';
        } else {
            state.availability = 'full';
        }
    }
    function matchVehicleToSpawner(vehicle: mod.Vehicle, vehicleObjId: number, lenient: boolean = false): void {
        let vehicleTeamNorm = 0;
        if (!badVehicleIds.has(vehicleObjId)) {
            try {
                const checkId = mod.GetObjId(vehicle);
                if (checkId !== vehicleObjId) { badVehicleIds.add(vehicleObjId); return; }
            } catch (_e) { badVehicleIds.add(vehicleObjId); return; }
        }
        if (lenient && vehicleTeamNorm === 0) lenient = false;
        for (const [spawnerId, state] of spawnerStateMap) {
            if (state.vehicleObjId !== null) continue;
            const spawnerTeamId = getSpawnerTeamId(spawnerId);
            if (vehicleTeamNorm !== 0 && vehicleTeamNorm !== spawnerTeamId) continue;
            const matchTypes = state.vehicleDef.matchTypes ?? [state.vehicleDef.type];
            const isStrictTypeMatch = matchesAnyVehicleType(vehicle, matchTypes);
            if (!isStrictTypeMatch) {
                if (!lenient) continue;
                const vehicleIsAir = isAirVehicleType(vehicle);
                const spawnerIsAir = state.vehicleDef.category === 'Air';
                if (vehicleIsAir !== spawnerIsAir) continue;
            }
            state.vehicleObjId = vehicleObjId;
            vehicleIdToSpawnerId.set(vehicleObjId, spawnerId);
            const initPos = getVehiclePosition(vehicle);
            if (initPos) vehicleInitialPosition.set(vehicleObjId, initPos);
            probeVehicleSeats(state);
            if (isStrictTypeMatch) {
                AutoDiscovery_UpdateSpawnerActualType(spawnerId, vehicle);
            }
            log(`[VehicleUI] Tracked ${state.vehicleDef.label} vehicle ${vehicleObjId} -> spawner ${spawnerId}${isStrictTypeMatch ? '' : ' (lenient)'}`);
            return;
        }
    }
    function getSpawnerTeamId(spawnerId: number): number {
        if (spawnerId < 0) return 0;
        for (const def of getTeam1Vehicles()) { if (def.spawnerId === spawnerId) return 1; }
        for (const def of getTeam2Vehicles()) { if (def.spawnerId === spawnerId) return 2; }
        return 0;
    }
    function reprobeVehicle(vehicleObjId: number): void {
        const spawnerId = vehicleIdToSpawnerId.get(vehicleObjId);
        if (spawnerId === undefined) return;
        const state = spawnerStateMap.get(spawnerId);
        if (state) probeVehicleSeats(state);
    }
    function scanExistingVehicles(): void {
        try {
            const allVehicles = mod.AllVehicles();
            if (!allVehicles) return;
            const count = mod.CountOf(allVehicles);
            const now = mod.GetMatchTimeElapsed();
            if (now - lastBadVehicleClearTime > BAD_VEHICLE_CLEAR_INTERVAL) { badVehicleIds.clear(); lastBadVehicleClearTime = now; }
            for (const [vId, spawnerId] of vehicleIdToSpawnerId.entries()) {
                const state = spawnerStateMap.get(spawnerId);
                if (!state) continue;
                if (badVehicleIds.has(vId)) {
                    const retryV = findVehicleById(vId);
                    if (!retryV) {
                        vehicleIdToSpawnerId.delete(vId);
                        vehicleInitialPosition.delete(vId);
                        state.vehicleObjId = null;
                        state.availability = 'no_vehicle';
                    }
                    continue;
                }
                const vehicle = findVehicleById(vId);
                if (!vehicle) {
                    vehicleIdToSpawnerId.delete(vId);
                    vehicleInitialPosition.delete(vId);
                    state.vehicleObjId = null;
                    state.availability = 'no_vehicle';
                    continue;
                }
                try { mod.GetObjId(vehicle); } catch (_e) {
                    badVehicleIds.add(vId);
                }
            }
            for (let i = 0; i < count; i++) {
                const vehicle = mod.ValueInArray(allVehicles, i) as mod.Vehicle;
                if (!vehicle) continue;
                try {
                    const vId = mod.GetObjId(vehicle);
                    if (vehicleIdToSpawnerId.has(vId)) continue;
                    matchVehicleToSpawner(vehicle, vId, false);
                } catch (_e) {}
            }
        } catch (_e) {}
    }
    const lastDeathTimeByPlayerId: Map<number, number> = new Map();
    const DEATHCAM_BLOCK_SECONDS = 3.0;
    const hasEverDeployedByPlayerId: Set<number> = new Set();
    const knownHumanPlayers: Set<number> = new Set();
    const knownAIPlayers: Set<number> = new Set();
    let tentativeHumanPlayerId: number | null = null;
    function isPlayerHumanCached(player: mod.Player): boolean {
        const playerId = mod.GetObjId(player);
        if (knownHumanPlayers.has(playerId)) return true;
        if (knownAIPlayers.has(playerId)) return false;
        const cachedAI = aiStatusByPlayerId[playerId];
        if (cachedAI === true) { knownAIPlayers.add(playerId); if (tentativeHumanPlayerId === playerId) tentativeHumanPlayerId = null; return false; }
        if (cachedAI === false) { knownHumanPlayers.add(playerId); return true; }
        try {
            if (hasSoldier(player)) {
                const isAI = safeGetSoldierStateBool(player, mod.SoldierStateBool.IsAISoldier);
                if (isAI) { knownAIPlayers.add(playerId); if (tentativeHumanPlayerId === playerId) tentativeHumanPlayerId = null; return false; }
                knownHumanPlayers.add(playerId); return true;
            }
        } catch (_e) {}
        if (tentativeHumanPlayerId === playerId) return true;
        if (tentativeHumanPlayerId === null) { tentativeHumanPlayerId = playerId; return true; }
        return false;
    }
    function isPlayerOnDeployScreen(player: mod.Player): boolean {
        try {
            const playerId = mod.GetObjId(player);
            const matchTime = mod.GetMatchTimeElapsed();
            const lastDeathTime = lastDeathTimeByPlayerId.get(playerId);
            if (lastDeathTime !== undefined && matchTime - lastDeathTime < DEATHCAM_BLOCK_SECONDS) return false;
            if (hasSoldier(player)) return false;
            const playerIsAlive = safeGetSoldierStateBool(player, mod.SoldierStateBool.IsAlive);
            const isInVehicle = safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle);
            const isManDown = safeGetSoldierStateBool(player, mod.SoldierStateBool.IsManDown);
            if (playerIsAlive || isInVehicle || isManDown) return false;
            return true;
        } catch (_e) { return false; }
    }
    function isPanelAlive(playerId: number): boolean {
        const panel = playerPanels.get(playerId);
        if (!panel || panel.deleted) return false;
        try { mod.GetUIWidgetName(panel.uiWidget); return true; } catch (_e) { return false; }
    }
    function destroyStalePanel(playerId: number): void {
        const dispose = playerPanelDisposers.get(playerId);
        if (dispose) try { dispose(); } catch (_e) {}
        const panel = playerPanels.get(playerId);
        if (panel) try { panel.delete(); } catch (_e) {}
        playerPanelDisposers.delete(playerId); playerPanels.delete(playerId);
        playerButtons.delete(playerId); playerButtonStateSetters.delete(playerId);
        playerPanelTeam.delete(playerId);
        playerUIVisible.delete(playerId);
    }
    function createPlayerUI(player: mod.Player): void {
        const playerId = mod.GetObjId(player);
        if (playerPanels.has(playerId)) destroyStalePanel(playerId);
        const teamId = getPlayerTeamId(player);
        if (teamId !== 1 && teamId !== 2) return;
        const allVehicles = teamId === 1 ? getTeam1Vehicles() : getTeam2Vehicles();
        const vehicles = MAX_BUTTONS < allVehicles.length ? allVehicles.slice(0, MAX_BUTTONS) : allVehicles;
        if (vehicles.length === 0) return;
        const buttonMap = new Map<number, UI.UITextButton>();
        const buttonStateSetters = new Map<number, SolidUI.Setter<ButtonVisualState>>();
        const childrenParams: UI.UIContainer.ChildParams<UI.UITextButton.Params>[] = [];
        const numButtons = vehicles.length;
        const stripWidth = numButtons > 0 ? numButtons * (BUTTON_SIZE + BUTTON_GAP) - BUTTON_GAP : BUTTON_SIZE;
        const stripHeight = BUTTON_SIZE + 4;
        const stride = BUTTON_SIZE + BUTTON_GAP;
        for (let i = 0; i < vehicles.length; i++) {
            const vehicle = vehicles[i];
            const btnX = (i - (numButtons - 1) / 2) * stride - BUTTON_SIZE / 2;
            const btnY = 0;
            const matchTypes = vehicle.matchTypes ?? [vehicle.type];
            const spawnerId = vehicle.spawnerId;
            const vehicleType = vehicle.type;
            const vehicleLabel = vehicle.label;
            childrenParams.push({
                type: UI.UITextButton,
                x: btnX, y: btnY,
                width: BUTTON_SIZE, height: BUTTON_SIZE,
                anchor: mod.UIAnchor.TopCenter,
                visible: true, enabled: true,
                baseColor: mod.CreateVector(0.0, 0.4, 0.9),
                hoverColor: mod.CreateVector(0.5, 0.85, 1.0),
                pressedColor: mod.CreateVector(0.3, 1.0, 0.5),
                focusedColor: mod.CreateVector(0.5, 0.85, 1.0),
                bgColor: mod.CreateVector(0.0, 0.3, 0.4),
                bgAlpha: 0.9,
                onClick: async (clickPlayer: mod.Player) => {
                    handleVehicleClick(clickPlayer, teamId, spawnerId, vehicleType, matchTypes, vehicleLabel);
                },
                message: mod.Message("{0}", vehicleLabel),
                textSize: 9,
                textColor: UI.COLORS.WHITE,
                textAlpha: 1.0,
            });
        }
        try {
            const panel = new UI.UIContainer({
                x: UI_PANEL_X, y: UI_PANEL_Y,
                width: 0, height: 0,
                anchor: UI_PANEL_ANCHOR,
                visible: false, bgAlpha: 0.0,
                depth: mod.UIDepth.AboveGameUI,
                receiver: player,
                uiInputModeWhenVisible: true,
                childrenParams,
            });
            void stripWidth; void stripHeight;
            playerPanels.set(playerId, panel);
            playerPanelTeam.set(playerId, teamId);
            for (let i = 0; i < vehicles.length && i < panel.children.length; i++) {
                const child = panel.children[i];
                if (child instanceof UI.UITextButton) buttonMap.set(vehicles[i].spawnerId, child);
            }
            playerButtons.set(playerId, buttonMap);
            updateButtonStatusForPlayer(playerId, teamId);
        } catch (e) {
            log(`[VehicleUI] Failed to create UI for player ${playerId}: ${e}`);
        }
    }
    function handleVehicleClick(player: mod.Player, teamId: number, spawnerId: number, vehicleType: mod.VehicleList, matchTypes: mod.VehicleList[], vehicleLabel: string): void {
        const playerId = mod.GetObjId(player);
        clickToast(player, `click ${vehicleLabel} (sp${spawnerId} T${teamId})`);
        const matchTime = mod.GetMatchTimeElapsed();
        const pendingRequest = pendingSpawnRequestsByPlayerId.get(playerId);
        if (pendingRequest && matchTime - pendingRequest.time <= MAX_SPAWN_ASSIGN_SECONDS) {
            clickToast(player, `bail: spawn already pending`);
            return;
        }
        if (pendingDeploySeat.has(playerId) || assignedSpawnedVehicleIdByPlayerId.has(playerId)) {
            clickToast(player, `bail: deploy already in flight`);
            return;
        }
        const currentTime = now(true);
        if (currentTime - lastButtonClickTime < BUTTON_DEBOUNCE_SECONDS) {
            clickToast(player, `bail: debounce`);
            return;
        }
        lastButtonClickTime = currentTime;
        if (getPlayerTeamId(player) !== teamId) {
            clickToast(player, `bail: wrong team (you=T${getPlayerTeamId(player)})`);
            return;
        }
        if (isJetVehicle(vehicleType)) {
            const cooldown = getJetCooldownRemaining(playerId);
            if (cooldown > 0 && !hasIdleMatchingJet(matchTypes, teamId)) {
                try { mod.DisplayCustomNotificationMessage(mod.Message("{0}", `Jet cooldown: ${Math.ceil(cooldown)}s`), mod.CustomNotificationSlots.MessageText1, 3.0, player); } catch (_e) {}
                return;
            }
        }
        if (!isPlayerOnDeployScreen(player)) {
            clickToast(player, `bail: not on deploy screen`);
            return;
        }
        scanExistingVehicles();
        const state = spawnerStateMap.get(spawnerId);
        const availability = state?.availability ?? 'no_vehicle';
        if (isJetVehicle(vehicleType)) {
            if (availability === 'cooldown' && state) {
                state.availability = 'no_vehicle';
                state.vehicleObjId = null;
            }
        } else {
            if (availability === 'cooldown' || availability === 'full') {
                clickToast(player, `bail: ${availability}`);
                return;
            }
        }
        const gen = (playerSeatGeneration.get(playerId) ?? 0) + 1;
        playerSeatGeneration.set(playerId, gen);
        pendingSpawnRequestsByPlayerId.delete(playerId);
        assignedSpawnedVehicleIdByPlayerId.delete(playerId);
        if (spawnerId < 0) {
            handleSentinelClick(player, playerId, teamId, vehicleType, matchTypes, vehicleLabel, gen);
            return;
        }
        if (availability === 'no_vehicle') {
            const isJetClick = isJetVehicle(vehicleType);
            type JetCand = { vid: number; v: mod.Vehicle; priority: number };
            const jetCandidates: JetCand[] = [];
            try {
                const allV = mod.AllVehicles();
                if (allV) {
                    const vc = mod.CountOf(allV);
                    for (let i = 0; i < vc; i++) {
                        const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                        if (!v) continue;
                        let occ = true;
                        try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                        if (occ) continue;
                        const isJetClick2 = isJetVehicle(vehicleType);
                        if (isJetClick2) {
                            if (!matchesAnyVehicleType(v, matchTypes)) continue;
                        } else {
                            if (!mod.CompareVehicleName(v, vehicleType)) continue;
                        }
                        let vid = 0;
                        try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                        if (vid === 0) continue;
                        if (reservedVehicleIds.has(vid)) continue;
                        const trackedTo = vehicleIdToSpawnerId.get(vid);
                        if (isJetClick) {
                            let priority = -1;
                            if (trackedTo === spawnerId) priority = 0;
                            else if (trackedTo === undefined) priority = 1;
                            if (priority < 0) continue;
                            jetCandidates.push({ vid, v, priority });
                            continue;
                        }
                        if (trackedTo !== undefined && trackedTo !== spawnerId) continue;
                        if (trackedTo === undefined) {
                            try {
                                const sp = getVehicleSpawnerById(spawnerId);
                                if (sp) {
                                    const spPos = mod.GetObjectPosition(sp as unknown as mod.Object);
                                    const vPos = getVehiclePosition(v);
                                    if (spPos && vPos) {
                                        const dx = mod.XComponentOf(spPos) - mod.XComponentOf(vPos);
                                        const dz = mod.ZComponentOf(spPos) - mod.ZComponentOf(vPos);
                                        const distSq = dx * dx + dz * dz;
                                        if (distSq > 50 * 50) continue;
                                    }
                                }
                            } catch (_e) {}
                        }
                        if (state) {
                            state.vehicleObjId = vid; state.availability = 'empty';
                            vehicleIdToSpawnerId.set(vid, spawnerId);
                        }
                        log(`[VehicleUI] Player ${playerId} clicked ${vehicleLabel} (found existing vehicle ${vid} -> direct seat)`);
                        reserveVehicleForHuman(vid, playerId);
                        deployAndSeatPlayer(player, playerId, vid, 0, vehicleLabel, gen, true);
                        return;
                    }
                }
                if (isJetClick && jetCandidates.length > 0) {
                    jetCandidates.sort((a, b) => a.priority - b.priority);
                    const best = jetCandidates[0];
                    const vid = best.vid; const v = best.v;
                    const trackedTo = vehicleIdToSpawnerId.get(vid);
                    if (state && trackedTo === undefined) {
                        state.vehicleObjId = vid; state.availability = 'empty';
                        vehicleIdToSpawnerId.set(vid, spawnerId);
                    }
                    log(`[VehicleUI] Player ${playerId} clicked ${vehicleLabel} (found jet ${vid} priority ${best.priority} -> direct seat)`);
                    reserveVehicleForHuman(vid, playerId);
                    deployAndSeatPlayer(player, playerId, vid, 0, vehicleLabel, gen, true);
                    return;
                }
                if (isJetClick && jetCandidates.length === 0) {
                    try {
                        const allV2 = mod.AllVehicles();
                        if (!allV2) { /* nothing */ }
                        else {
                            const vc2 = mod.CountOf(allV2);
                            const jetAnchors: { x: number; y: number; z: number }[] = [];
                            for (let i = 0; i < vc2; i++) {
                                const v = mod.ValueInArray(allV2, i) as mod.Vehicle;
                                if (!v) continue;
                                let isAnyKnownJet = false;
                                try {
                                    isAnyKnownJet =
                                        mod.CompareVehicleName(v, mod.VehicleList.F22) ||
                                        mod.CompareVehicleName(v, mod.VehicleList.F16) ||
                                        mod.CompareVehicleName(v, mod.VehicleList.JAS39) ||
                                        mod.CompareVehicleName(v, mod.VehicleList.SU57);
                                } catch (_e) {}
                                if (!isAnyKnownJet) continue;
                                const p = getVehiclePosition(v);
                                if (!p) continue;
                                jetAnchors.push({
                                    x: mod.XComponentOf(p),
                                    y: mod.YComponentOf(p),
                                    z: mod.ZComponentOf(p),
                                });
                            }
                            const hq = AutoDiscovery_GetTeamHQCentroid(teamId);
                            if (hq) jetAnchors.push(hq);
                            const F16_PROXIMITY_TIGHT_SQ = 400.0 * 400.0;
                            const F16_PROXIMITY_HQ_SQ = 1500.0 * 1500.0;
                            log(`[VehicleUI] Jet fallback (${vehicleLabel}): anchors=${jetAnchors.length} (jets+HQ)`);
                            if (jetAnchors.length === 0) {
                                log(`[VehicleUI] Jet fallback: no anchors, skipping (will deploy on foot)`);
                            } else {
                                for (let i = 0; i < vc2; i++) {
                                    const v = mod.ValueInArray(allV2, i) as mod.Vehicle;
                                    if (!v) continue;
                                    let occ = true;
                                    try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                                    if (occ) continue;
                                    let isAnyKnown = false;
                                    try {
                                        for (const def of ALL_KNOWN_VEHICLE_TYPES) {
                                            if (mod.CompareVehicleName(v, def)) { isAnyKnown = true; break; }
                                        }
                                    } catch (_e) {}
                                    if (isAnyKnown) continue;
                                    const p = getVehiclePosition(v);
                                    if (!p) continue;
                                    const px = mod.XComponentOf(p);
                                    const py = mod.YComponentOf(p);
                                    const pz = mod.ZComponentOf(p);
                                    let nearAnchor = false;
                                    for (let ai = 0; ai < jetAnchors.length; ai++) {
                                        const a = jetAnchors[ai];
                                        const dx = px - a.x, dy = py - a.y, dz = pz - a.z;
                                        const distSq = dx * dx + dy * dy + dz * dz;
                                        const isHqAnchor = (hq !== null && ai === jetAnchors.length - 1);
                                        const limit = isHqAnchor ? F16_PROXIMITY_HQ_SQ : F16_PROXIMITY_TIGHT_SQ;
                                        if (distSq <= limit) { nearAnchor = true; break; }
                                    }
                                    if (!nearAnchor) continue;
                                    let vid = 0;
                                    try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                                    if (vid === 0) continue;
                                    if (reservedVehicleIds.has(vid)) continue;
                                    const trackedTo = vehicleIdToSpawnerId.get(vid);
                                    if (trackedTo !== undefined && trackedTo !== spawnerId) continue;
                                    if (state && trackedTo === undefined) {
                                        state.vehicleObjId = vid; state.availability = 'empty';
                                        vehicleIdToSpawnerId.set(vid, spawnerId);
                                    }
                                    log(`[VehicleUI] Player ${playerId} clicked ${vehicleLabel} (jet elimination fallback found unidentified jet ${vid} -> direct seat)`);
                                    reserveVehicleForHuman(vid, playerId);
                                    deployAndSeatPlayer(player, playerId, vid, 0, vehicleLabel, gen, true);
                                    return;
                                }
                                log(`[VehicleUI] Jet fallback: no unidentified vehicle near anchors for ${vehicleLabel}`);
                            }
                        }
                    } catch (_e) {}
                }
            } catch (_e) {}
            log(`[VehicleUI] Player ${playerId} clicked ${vehicleLabel} (no_vehicle -> force spawn)`);
            clickToast(player, `spawning ${vehicleLabel}...`);
            pendingSpawnRequestsByPlayerId.set(playerId, { spawnerId, teamId, vehicleType, matchTypes, label: vehicleLabel, seatGen: gen, time: matchTime });
            beginDeployFlow(player, playerId);
            if (isJetVehicle(vehicleType)) {
                try { mod.EnablePlayerDeploy(player, true); mod.SetRedeployTime(player, 0); mod.DeployPlayer(player); } catch (_e) { clearSuppressState(playerId); return; }
                waitForAliveThenSpawnJetAndSeat(player, playerId, spawnerId, vehicleType, matchTypes, vehicleLabel, gen, teamId, 0);
            } else {
                try {
                    const spawner = getVehicleSpawnerById(spawnerId);
                    if (!spawner) {
                        clickToast(player, `bail: spawner ${spawnerId} not found`);
                        return;
                    }
                    mod.ForceVehicleSpawnerSpawn(spawner);
                } catch (e) {
                    clickToast(player, `force-spawn threw: ${e}`);
                    clearSuppressState(playerId); showPlayerUI(player); return;
                }
                try { mod.EnablePlayerDeploy(player, true); mod.SetRedeployTime(player, 0); mod.DeployPlayer(player); } catch (_e) { clearSuppressState(playerId); return; }
                waitForSpawnedVehicleThenDeploy(player, playerId, matchTypes, new Set(), spawnerId, vehicleLabel, gen, teamId, 0);
            }
            return;
        }
        log(`[VehicleUI] Player ${playerId} clicked ${vehicleLabel} (${availability})`);
        if (availability === 'empty' && state?.vehicleObjId !== null) {
            const verifyV = findVehicleById(state!.vehicleObjId!);
            if (!verifyV) {
                clickToast(player, `bail: vehicle gone (empty)`);
                log(`[VehicleUI] ${vehicleLabel} vehicle ${state!.vehicleObjId} gone before deploy`);
                state!.vehicleObjId = null; state!.availability = 'no_vehicle';
                showPlayerUI(player);
                return;
            }
            clickToast(player, `seating pilot into ${vehicleLabel}`);
            reserveVehicleForHuman(state!.vehicleObjId!, playerId);
            deployAndSeatPlayer(player, playerId, state!.vehicleObjId!, 0, vehicleLabel, gen, true);
        } else {
            clickToast(player, `${vehicleLabel} unavailable (state=${availability})`);
            showVehicleRequestNotification(`${vehicleLabel} unavailable`);
            showPlayerUI(player);
        }
    }
    function clearSuppressState(playerId: number): void {
        suppressUIUntilByPlayerId.delete(playerId);
        pendingDeploySeat.delete(playerId);
        pendingSpawnRequestsByPlayerId.delete(playerId);
        assignedSpawnedVehicleIdByPlayerId.delete(playerId);
        clearReservationsForPlayer(playerId);
        clearJetClaimsForPlayer(playerId);
    }
    function isCurrentSeatGeneration(playerId: number, seatGen: number): boolean {
        return (playerSeatGeneration.get(playerId) ?? 0) === seatGen;
    }
    function clearSuppressStateIfCurrent(playerId: number, seatGen?: number): void {
        if (seatGen !== undefined && !isCurrentSeatGeneration(playerId, seatGen)) return;
        clearSuppressState(playerId);
    }
    function beginDeployFlow(player: mod.Player, playerId: number): void {
        suppressUIUntilByPlayerId.set(playerId, mod.GetMatchTimeElapsed() + (MAX_SPAWN_ASSIGN_SECONDS + 2.0));
        hidePlayerUI(player);
    }
    const reservedVehicleIds: Map<number, { playerId: number; expiresAt: number }> = new Map();
    const RESERVATION_DURATION = 12.0;
    function reserveVehicleForHuman(vehicleObjId: number, playerId: number): void {
        reservedVehicleIds.set(vehicleObjId, { playerId, expiresAt: mod.GetMatchTimeElapsed() + RESERVATION_DURATION });
    }
    function clearReservationsForPlayer(playerId: number): void {
        for (const [key, res] of reservedVehicleIds.entries()) { if (res.playerId === playerId) reservedVehicleIds.delete(key); }
    }
    interface HumanJetClaim {
        player: mod.Player;
        playerId: number;
        teamId: number;
        label: string;
        seatGen: number;
        expiresAt: number;
    }
    const humanJetClaimsBySpawnerId: Map<number, HumanJetClaim> = new Map();
    const HUMAN_JET_CLAIM_DURATION = 90.0;
    export function vehicleUI_GetHumanJetClaim(spawnerId: number): HumanJetClaim | null {
        const claim = humanJetClaimsBySpawnerId.get(spawnerId);
        if (!claim) return null;
        if (mod.GetMatchTimeElapsed() > claim.expiresAt) { humanJetClaimsBySpawnerId.delete(spawnerId); return null; }
        return claim;
    }
    export function vehicleUI_SeatHumanForSpawner(spawnerId: number, vehicle: mod.Vehicle, vehicleObjId: number): boolean {
        const claim = humanJetClaimsBySpawnerId.get(spawnerId);
        if (!claim) return false;
        if (mod.GetMatchTimeElapsed() > claim.expiresAt) { humanJetClaimsBySpawnerId.delete(spawnerId); return false; }
        if (!isCurrentSeatGeneration(claim.playerId, claim.seatGen)) { humanJetClaimsBySpawnerId.delete(spawnerId); return false; }
        let humanAlive = false;
        try { humanAlive = hasSoldier(claim.player) && isAlive(claim.player); } catch (_e) {}
        let humanInVehicle = false;
        try { humanInVehicle = safeGetSoldierStateBool(claim.player, mod.SoldierStateBool.IsInVehicle); } catch (_e) {}
        humanJetClaimsBySpawnerId.delete(spawnerId);
        if (!humanAlive || humanInVehicle) {
            log(`[VehicleUI] Jet claim for player ${claim.playerId} expired (alive=${humanAlive}, inVehicle=${humanInVehicle})`);
            showPlayerUI(claim.player);
            return false;
        }
        const state = spawnerStateMap.get(spawnerId);
        if (state && state.vehicleObjId === null) {
            state.vehicleObjId = vehicleObjId;
            vehicleIdToSpawnerId.set(vehicleObjId, spawnerId);
            const initPos = getVehiclePosition(vehicle);
            if (initPos) vehicleInitialPosition.set(vehicleObjId, initPos);
        }
        AutoDiscovery_ConfirmSpawner(spawnerId, claim.teamId);
        reserveVehicleForHuman(vehicleObjId, claim.playerId);
        setJetCooldown(claim.playerId); // Cooldown only on successful jet seat
        seatPlayerDirectly(claim.player, vehicle, 0, claim.label, 0, true, claim.seatGen);
        log(`[VehicleUI] VDir-triggered seat: player ${claim.playerId} -> ${claim.label} vId=${vehicleObjId}`);
        return true;
    }
    function clearJetClaimsForPlayer(playerId: number): void {
        for (const [sid, claim] of humanJetClaimsBySpawnerId.entries()) {
            if (claim.playerId === playerId) humanJetClaimsBySpawnerId.delete(sid);
        }
    }
    export function vehicleUI_IsVehicleReservedForHuman(vehicle: mod.Vehicle): boolean {
        try {
            const vid = mod.GetObjId(vehicle);
            const res = reservedVehicleIds.get(vid);
            if (!res) return false;
            if (mod.GetMatchTimeElapsed() > res.expiresAt) { reservedVehicleIds.delete(vid); return false; }
            return true;
        } catch (_e) { return false; }
    }
    export function vehicleUI_GetVehicleTeamId(vehicleObjId: number): number {
        const spawnerId = vehicleIdToSpawnerId.get(vehicleObjId);
        if (spawnerId !== undefined) return getSpawnerTeamId(spawnerId);
        return 0;
    }
    export function vehicleUI_IsSpawnerVehicleGone(spawnerId: number): boolean {
        const state = spawnerStateMap.get(spawnerId);
        if (!state) return true;
        return state.vehicleObjId === null;
    }
    export function vehicleUI_ForceTrackVehicle(spawnerId: number, vehicleObjId: number, vehicle: mod.Vehicle): void {
        if (vehicleIdToSpawnerId.has(vehicleObjId)) return; // already tracked
        const state = spawnerStateMap.get(spawnerId);
        if (!state) return;
        state.vehicleObjId = vehicleObjId;
        vehicleIdToSpawnerId.set(vehicleObjId, spawnerId);
        const initPos = getVehiclePosition(vehicle);
        if (initPos) vehicleInitialPosition.set(vehicleObjId, initPos);
        probeVehicleSeats(state);
        log(`[VehicleUI] Force-tracked vehicle ${vehicleObjId} -> spawner ${spawnerId} (${state.vehicleDef.label}, from VDir)`);
    }
    function deployAndSeatPlayer(player: mod.Player, playerId: number, vehicleObjId: number, seatIndex: number, label: string, seatGen: number, claimRequestedPilot: boolean): void {
        beginDeployFlow(player, playerId);
        try { mod.EnablePlayerDeploy(player, true); mod.SetRedeployTime(player, 0); mod.DeployPlayer(player); } catch (_e) {
            log(`[VehicleUI] DeployPlayer failed for player ${playerId} -> ${label}`);
            clearSuppressState(playerId);
            showPlayerUI(player);
            return;
        }
        pendingDeploySeat.set(playerId, { vehicleObjId, seatIndex, label, seatGen, claimRequestedPilot });
        waitForAliveAndSeat(player, playerId, vehicleObjId, seatIndex, label, seatGen, claimRequestedPilot, 0);
    }
    function waitForSpawnedVehicleThenDeploy(player: mod.Player, playerId: number, matchTypes: mod.VehicleList[], preSpawnIds: Set<number>, spawnerId: number, label: string, seatGen: number, teamId: number, retryCount: number): void {
        const maxRetries = includesAttackHeli(matchTypes) ? Math.floor(ATTACK_HELI_SPAWN_WAIT_SECONDS / 0.1) : 60;
        if (!isCurrentSeatGeneration(playerId, seatGen)) return;
        const assignedVehicleId = assignedSpawnedVehicleIdByPlayerId.get(playerId);
        if (assignedVehicleId !== undefined) {
            const av = findVehicleById(assignedVehicleId);
            if (av) {
                assignedSpawnedVehicleIdByPlayerId.delete(playerId);
                pendingSpawnRequestsByPlayerId.delete(playerId);
                AutoDiscovery_ConfirmSpawner(spawnerId, teamId);
                reserveVehicleForHuman(assignedVehicleId, playerId);
                if (hasSoldier(player) && isAlive(player)) seatPlayerDirectly(player, av, 0, label, 0, true, seatGen);
                else deployAndSeatPlayer(player, playerId, assignedVehicleId, 0, label, seatGen, true);
                return;
            }
            assignedSpawnedVehicleIdByPlayerId.delete(playerId);
        }
        const trackedVehicle = findTrackedVehicleForSpawner(spawnerId, matchTypes, teamId);
        if (trackedVehicle) {
            const tid = mod.GetObjId(trackedVehicle);
            pendingSpawnRequestsByPlayerId.delete(playerId);
            AutoDiscovery_ConfirmSpawner(spawnerId, teamId);
            reserveVehicleForHuman(tid, playerId);
            if (hasSoldier(player) && isAlive(player)) seatPlayerDirectly(player, trackedVehicle, 0, label, 0, true, seatGen);
            else deployAndSeatPlayer(player, playerId, tid, 0, label, seatGen, true);
            return;
        }
        if (preSpawnIds.size > 0) {
            try {
                const allV = mod.AllVehicles();
                if (allV) {
                    const c = mod.CountOf(allV);
                    for (let i = 0; i < c; i++) {
                        const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                        if (!v) continue;
                        let vid = 0;
                        try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                        if (preSpawnIds.has(vid)) continue;
                        let occ = true;
                        try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                        if (occ) continue;
                        const sid = vehicleIdToSpawnerId.get(vid);
                        if (sid !== undefined && getSpawnerTeamId(sid) !== 0 && getSpawnerTeamId(sid) !== teamId) continue;
                        if (!matchesAnyVehicleType(v, matchTypes)) continue;
                        log(`[VehicleUI] Non-jet fallback: found new vehicle ${vid} for ${label} (enum-shift)`);
                        pendingSpawnRequestsByPlayerId.delete(playerId);
                        AutoDiscovery_ConfirmSpawner(spawnerId, teamId);
                        reserveVehicleForHuman(vid, playerId);
                        if (hasSoldier(player) && isAlive(player)) seatPlayerDirectly(player, v, 0, label, 0, true, seatGen);
                        else deployAndSeatPlayer(player, playerId, vid, 0, label, seatGen, true);
                        return;
                    }
                }
            } catch (_e) {}
        }
        if (retryCount < maxRetries) {
            mod.Wait(0.1).then(() => waitForSpawnedVehicleThenDeploy(player, playerId, matchTypes, preSpawnIds, spawnerId, label, seatGen, teamId, retryCount + 1));
            return;
        }
        {
            const triedSpawners = preSpawnIds.size > 0 ? preSpawnIds : new Set<number>();
            triedSpawners.add(spawnerId);
            const alternates = AutoDiscovery_GetAlternateSpawners(spawnerId, teamId);
            for (const altId of alternates) {
                if (triedSpawners.has(altId)) continue;
                triedSpawners.add(altId);
                log(`[VehicleUI] Spawner ${spawnerId} failed, trying alternate ${altId}`);
                try {
                    const altSpawner = getVehicleSpawnerById(altId);
                    if (!altSpawner) continue;
                    try { mod.SetVehicleSpawnerVehicleType(altSpawner, matchTypes[0]); } catch (_e) {}
                    mod.ForceVehicleSpawnerSpawn(altSpawner);
                    const req = pendingSpawnRequestsByPlayerId.get(playerId);
                    if (req) req.spawnerId = altId;
                    waitForSpawnedVehicleThenDeploy(player, playerId, matchTypes, triedSpawners, altId, label, seatGen, teamId, 0);
                    return;
                } catch (_e) {}
            }
            log(`[VehicleUI] All alternate spawners exhausted for ${label} T${teamId}`);
        }
        clearSuppressStateIfCurrent(playerId, seatGen);
        showPlayerUI(player);
    }
    function waitForAliveThenSpawnJetAndSeat(player: mod.Player, playerId: number, spawnerId: number, vehicleType: mod.VehicleList, matchTypes: mod.VehicleList[], label: string, seatGen: number, teamId: number, retryCount: number): void {
        if (!isCurrentSeatGeneration(playerId, seatGen)) return;
        try { if (safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle)) { clearSuppressStateIfCurrent(playerId, seatGen); return; } } catch (_e) {}
        let alive = false;
        try { if (hasSoldier(player)) alive = isAlive(player); } catch (_e) {}
        if (!alive) {
            if (retryCount >= 80) {
                log(`[VehicleUI] Jet flow: Player ${playerId} never deployed - aborting`);
                clearSuppressStateIfCurrent(playerId, seatGen);
                showPlayerUI(player);
                return;
            }
            mod.Wait(0.1).then(() => waitForAliveThenSpawnJetAndSeat(player, playerId, spawnerId, vehicleType, matchTypes, label, seatGen, teamId, retryCount + 1));
            return;
        }
        log(`[VehicleUI] Jet flow: Player ${playerId} alive after ${retryCount} ticks - looking for ${label}`);
        let aiOccupiedJet: mod.Vehicle | null = null;
        let aiOccupiedJetId = 0;
        let aiOccupiedJetPilot: mod.Player | null = null;
        type JetCandidate = { v: mod.Vehicle; vid: number; priority: number };
        const unoccupiedCandidates: JetCandidate[] = [];
        try {
            const allV = mod.AllVehicles();
            if (allV) {
                const c = mod.CountOf(allV);
                for (let i = 0; i < c; i++) {
                    const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                    if (!v) continue;
                    if (!matchesAnyVehicleType(v, matchTypes)) continue;
                    let vid = 0;
                    try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                    if (vid === 0) continue;
                    if (reservedVehicleIds.has(vid)) continue;
                    let occ = true;
                    try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                    const trackedTo = vehicleIdToSpawnerId.get(vid);
                    let priority = -1;
                    if (trackedTo === spawnerId) priority = 0;
                    else if (trackedTo === undefined) priority = 1;
                    if (priority < 0) continue;
                    if (!occ) {
                        unoccupiedCandidates.push({ v, vid, priority });
                    } else if (!aiOccupiedJet) {
                        try {
                            const pilot = mod.GetPlayerFromVehicleSeat(v, 0) as mod.Player | null;
                            if (pilot && isAISoldier(pilot)) {
                                aiOccupiedJet = v;
                                aiOccupiedJetId = vid;
                                aiOccupiedJetPilot = pilot;
                            }
                        } catch (_e) {}
                    }
                }
            }
        } catch (_e) {}
        if (unoccupiedCandidates.length > 0) {
            unoccupiedCandidates.sort((a, b) => a.priority - b.priority);
            const best = unoccupiedCandidates[0];
            const v = best.v; const vid = best.vid;
            log(`[VehicleUI] Jet flow: Found existing ${label} vehicle ${vid} (priority ${best.priority}) - seating player ${playerId}`);
            const st = spawnerStateMap.get(spawnerId);
            const trackedTo = vehicleIdToSpawnerId.get(vid);
            if (trackedTo === undefined && st && st.vehicleObjId === null) {
                st.vehicleObjId = vid;
                vehicleIdToSpawnerId.set(vid, spawnerId);
                const initPos = getVehiclePosition(v);
                if (initPos) vehicleInitialPosition.set(vid, initPos);
            }
            AutoDiscovery_ConfirmSpawner(spawnerId, teamId);
            reserveVehicleForHuman(vid, playerId);
            pendingSpawnRequestsByPlayerId.delete(playerId);
            seatPlayerDirectly(player, v, 0, label, 0, true, seatGen);
            return;
        }
        if (aiOccupiedJet && aiOccupiedJetPilot && aiOccupiedJetId !== 0) {
            log(`[VehicleUI] Jet flow: All ${label} occupied by AI - kicking AI pilot from vehicle ${aiOccupiedJetId} for player ${playerId}`);
            safeForcePlayerExitVehicle(aiOccupiedJetPilot, aiOccupiedJet);
            const st = spawnerStateMap.get(spawnerId);
            if (st && st.vehicleObjId === null) {
                st.vehicleObjId = aiOccupiedJetId;
                vehicleIdToSpawnerId.set(aiOccupiedJetId, spawnerId);
                const initPos = getVehiclePosition(aiOccupiedJet);
                if (initPos) vehicleInitialPosition.set(aiOccupiedJetId, initPos);
            }
            AutoDiscovery_ConfirmSpawner(spawnerId, teamId);
            reserveVehicleForHuman(aiOccupiedJetId, playerId);
            pendingSpawnRequestsByPlayerId.delete(playerId);
            seatPlayerDirectly(player, aiOccupiedJet, 0, label, 0, true, seatGen);
            return;
        }
        log(`[VehicleUI] Jet flow: No existing ${label} found - trying force-spawn path`);
        const preSpawnIds = new Set<number>();
        try {
            const allV = mod.AllVehicles();
            if (allV) {
                const c = mod.CountOf(allV);
                for (let i = 0; i < c; i++) {
                    try { preSpawnIds.add(mod.GetObjId(mod.ValueInArray(allV, i) as mod.Vehicle)); } catch (_e) {}
                }
            }
        } catch (_e) {}
        log(`[VehicleUI] Jet flow: Pre-spawn snapshot has ${preSpawnIds.size} vehicles`);
        let spawnerRef: mod.VehicleSpawner | null = null;
        const ds = discoveredVehicleSpawners.find(d => d.spawnerId === spawnerId);
        if (ds) {
            spawnerRef = ds.spawner;
        } else {
            spawnerRef = getVehicleSpawnerById(spawnerId);
        }
        if (!spawnerRef) {
            log(`[VehicleUI] Jet flow: No spawner found for ${spawnerId}`);
            clearSuppressStateIfCurrent(playerId, seatGen);
            return;
        }
        try {
            mod.SetVehicleSpawnerVehicleType(spawnerRef, vehicleType);
            log(`[VehicleUI] Jet flow: Set spawner ${spawnerId} type OK`);
        } catch (e) {
            log(`[VehicleUI] Jet flow: SetVehicleType failed (continuing): ${e}`);
        }
        try {
            mod.ForceVehicleSpawnerSpawn(spawnerRef);
            log(`[VehicleUI] Jet flow: ForceVehicleSpawnerSpawn OK on ${spawnerId}`);
        } catch (e) {
            log(`[VehicleUI] Jet flow: Force-spawn failed: ${e}`);
            clearSuppressStateIfCurrent(playerId, seatGen);
            showPlayerUI(player);
            return;
        }
        waitForNewJetThenSeat(player, playerId, spawnerId, matchTypes, label, seatGen, teamId, preSpawnIds, 0);
    }
    function waitForNewJetThenSeat(player: mod.Player, playerId: number, spawnerId: number, matchTypes: mod.VehicleList[], label: string, seatGen: number, teamId: number, preSpawnIds: Set<number>, attempt: number): void {
        if (!isCurrentSeatGeneration(playerId, seatGen)) return;
        try { if (safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle)) { clearSuppressStateIfCurrent(playerId, seatGen); return; } } catch (_e) {}
        let newJet: mod.Vehicle | null = null;
        let newJetId = 0;
        let matchMethod = "none";
        try {
            const allV = mod.AllVehicles();
            if (allV) {
                const c = mod.CountOf(allV);
                for (let i = 0; i < c; i++) {
                    const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                    if (!v) continue;
                    let vid = 0;
                    try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                    if (preSpawnIds.has(vid)) continue;
                    if (matchesAnyVehicleType(v, matchTypes)) {
                        newJet = v;
                        newJetId = vid;
                        matchMethod = "type";
                        break;
                    }
                }
                if (attempt === 0 || attempt === 10 || attempt === 30 || attempt === 50) {
                    log(`[VehicleUI] Jet flow poll #${attempt}: ${c} total vehicles, snapshot=${preSpawnIds.size}, match=${matchMethod}`);
                }
            }
        } catch (_e) {}
        if (newJet) {
            log(`[VehicleUI] Jet flow: Found new ${label} vehicle ${newJetId} (${matchMethod}) after ${attempt} attempts`);
            const state = spawnerStateMap.get(spawnerId);
            if (state && state.vehicleObjId === null) {
                state.vehicleObjId = newJetId;
                vehicleIdToSpawnerId.set(newJetId, spawnerId);
                const initPos = getVehiclePosition(newJet);
                if (initPos) vehicleInitialPosition.set(newJetId, initPos);
            }
            AutoDiscovery_ConfirmSpawner(spawnerId, teamId);
            reserveVehicleForHuman(newJetId, playerId);
            pendingSpawnRequestsByPlayerId.delete(playerId);
            setJetCooldown(playerId); // Cooldown only on successful jet seat
            seatPlayerDirectly(player, newJet, 0, label, 0, true, seatGen);
            return;
        }
        if (attempt >= 60) { // 6 seconds max -- jet not in AllVehicles yet
            try {
                const allV = mod.AllVehicles();
                if (allV) {
                    const c = mod.CountOf(allV);
                    for (let i = 0; i < c; i++) {
                        const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                        if (!v) continue;
                        let occ = true;
                        try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                        if (occ) continue;
                        if (!matchesAnyVehicleType(v, matchTypes)) continue;
                        let vid = 0;
                        try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                        if (vid === 0) continue;
                        const trackedTo = vehicleIdToSpawnerId.get(vid);
                        if (trackedTo !== undefined && trackedTo !== spawnerId) continue;
                        if (reservedVehicleIds.has(vid)) continue;
                        log(`[VehicleUI] Jet flow: Found existing ${label} vehicle ${vid} (autospawn fallback)`);
                        const st = spawnerStateMap.get(spawnerId);
                        if (st && st.vehicleObjId === null) {
                            st.vehicleObjId = vid;
                            vehicleIdToSpawnerId.set(vid, spawnerId);
                        }
                        reserveVehicleForHuman(vid, playerId);
                        pendingSpawnRequestsByPlayerId.delete(playerId);
                        setJetCooldown(playerId); // Cooldown only on successful jet seat
                        seatPlayerDirectly(player, v, 0, label, 0, true, seatGen);
                        return;
                    }
                }
            } catch (_e) {}
            let stillAlive = false;
            try { stillAlive = hasSoldier(player) && isAlive(player); } catch (_e) {}
            let inVehicle = false;
            try { inVehicle = safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle); } catch (_e) {}
            const pTeamId = teamId;
            if (stillAlive && !inVehicle && isCurrentSeatGeneration(playerId, seatGen)) {
                humanJetClaimsBySpawnerId.set(spawnerId, {
                    player, playerId, teamId: pTeamId, label, seatGen,
                    expiresAt: mod.GetMatchTimeElapsed() + HUMAN_JET_CLAIM_DURATION
                });
                log(`[VehicleUI] Jet flow: Registered human claim spawner ${spawnerId} player ${playerId} - VDir will seat when jet appears`);
                clearSuppressStateIfCurrent(playerId, seatGen);
                return;
            }
            log(`[VehicleUI] Jet flow: Could not find new ${label} after ${attempt} attempts - aborting`);
            clearSuppressStateIfCurrent(playerId, seatGen);
            showPlayerUI(player);
            return;
        }
        mod.Wait(0.1).then(() => waitForNewJetThenSeat(player, playerId, spawnerId, matchTypes, label, seatGen, teamId, preSpawnIds, attempt + 1));
    }
    function waitForAliveAndSeat(player: mod.Player, playerId: number, vehicleObjId: number, seatIndex: number, label: string, seatGen: number, claimRequestedPilot: boolean, retryCount: number): void {
        if (!isCurrentSeatGeneration(playerId, seatGen)) return;
        try { if (safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle)) { clearSuppressStateIfCurrent(playerId, seatGen); return; } } catch (_e) {}
        let alive = false;
        try { if (hasSoldier(player)) alive = isAlive(player); } catch (_e) {}
        if (!alive) {
            if (retryCount >= 6 && isPlayerOnDeployScreen(player)) { clearSuppressStateIfCurrent(playerId, seatGen); showPlayerUI(player); return; }
            if (retryCount < 80) { mod.Wait(0.1).then(() => waitForAliveAndSeat(player, playerId, vehicleObjId, seatIndex, label, seatGen, claimRequestedPilot, retryCount + 1)); return; }
            clearSuppressStateIfCurrent(playerId, seatGen); showPlayerUI(player); return;
        }
        const vehicle = findVehicleById(vehicleObjId);
        if (!vehicle) {
            log(`[VehicleUI] Vehicle ${vehicleObjId} gone before seating player ${playerId}`);
            clearSuppressStateIfCurrent(playerId, seatGen);
            try { mod.DisplayCustomNotificationMessage(mod.Message("{0}", `${label} no longer available`), mod.CustomNotificationSlots.MessageText1, 3.0, player); } catch (_e) {}
            return;
        }
        seatPlayerDirectly(player, vehicle, seatIndex, label, 0, claimRequestedPilot, seatGen);
    }
    function seatPlayerDirectly(player: mod.Player, vehicle: mod.Vehicle, seatIndex: number, label: string, retryCount: number = 0, claimRequestedPilot: boolean = false, seatGen?: number): void {
        const playerId = mod.GetObjId(player);
        if (seatGen !== undefined && !isCurrentSeatGeneration(playerId, seatGen)) return;
        try {
            if (safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle)) {
                clearSuppressStateIfCurrent(playerId, seatGen);
                return;
            }
        } catch (_e) {}
        try {
            const playerTeam = getPlayerTeamId(player);
            let vehicleTeam = 0;
            try {
                const vTeam = mod.GetVehicleTeam(vehicle);
                if (vTeam) {
                    const t1 = mod.GetTeam(1); const t2 = mod.GetTeam(2);
                    if (t1 && mod.GetObjId(vTeam) === mod.GetObjId(t1)) vehicleTeam = 1;
                    else if (t2 && mod.GetObjId(vTeam) === mod.GetObjId(t2)) vehicleTeam = 2;
                }
            } catch (_e) {}
            if (vehicleTeam === 0) {
                try {
                    const vid = mod.GetObjId(vehicle);
                    const sid = vehicleIdToSpawnerId.get(vid);
                    if (sid !== undefined) vehicleTeam = getSpawnerTeamId(sid);
                } catch (_e) {}
            }
            if (vehicleTeam === 0) {
                try {
                    for (const vt of [
                        mod.VehicleList.Leopard, mod.VehicleList.Abrams,
                        mod.VehicleList.M2Bradley, mod.VehicleList.CV90,
                        mod.VehicleList.Cheetah, mod.VehicleList.Gepard,
                        mod.VehicleList.Marauder, mod.VehicleList.Marauder_Pax,
                        mod.VehicleList.AH6M, mod.VehicleList.AH6M_Pax,
                        mod.VehicleList.UH60, mod.VehicleList.UH60_Pax,
                        mod.VehicleList.DirtBike, mod.VehicleList.DirtBike_Pax,
                        mod.VehicleList.F22, mod.VehicleList.SU57,
                        mod.VehicleList.F16, mod.VehicleList.JAS39,
                        mod.VehicleList.AH64, mod.VehicleList.Eurocopter,
                    ]) {
                        if (mod.CompareVehicleName(vehicle, vt)) {
                            if (isFactionAppropriate(vt, 1)) { vehicleTeam = 1; break; }
                            if (isFactionAppropriate(vt, 2)) { vehicleTeam = 2; break; }
                        }
                    }
                } catch (_e) {}
            }
            if (vehicleTeam !== 0 && playerTeam !== 0 && vehicleTeam !== playerTeam) {
                clickToast(player, `bail: vehicle is T${vehicleTeam}, you are T${playerTeam}`);
                clearSuppressStateIfCurrent(playerId, seatGen); showPlayerUI(player); return;
            }
        } catch (_e) {}
        let targetSeat = seatIndex;
        if (targetSeat === 0 && claimRequestedPilot) {
            try {
                if (mod.IsVehicleSeatOccupied(vehicle, 0)) {
                    const currentPilot = safeGetPlayerFromVehicleSeat(vehicle, 0);
                    if (currentPilot && isAISoldier(currentPilot)) {
                        safeForcePlayerExitVehicle(currentPilot, vehicle);
                    } else {
                        clearSuppressStateIfCurrent(playerId, seatGen);
                        showPlayerUI(player);
                        try { mod.DisplayCustomNotificationMessage(mod.Message("{0}", `${label} just taken`), mod.CustomNotificationSlots.MessageText1, 2.5, player); } catch (_e) {}
                        return;
                    }
                }
            } catch (_e) {}
        }
        let screenEffectOn = false;
        try { mod.EnableScreenEffect(player, SEAT_TRANSITION_SCREEN_EFFECT, true); screenEffectOn = true; } catch (_e) {}
        try { mod.ForcePlayerToSeat(player, vehicle, targetSeat); } catch (_e) {}
        mod.Wait(0.25).then(() => {
            const inVehicle = safeGetSoldierStateBool(player, mod.SoldierStateBool.IsInVehicle);
            if (inVehicle) {
                if (screenEffectOn) { try { mod.EnableScreenEffect(player, SEAT_TRANSITION_SCREEN_EFFECT, false); } catch (_e) {} screenEffectOn = false; }
                clearSuppressStateIfCurrent(playerId, seatGen);
                if (claimRequestedPilot && targetSeat === 0) {
                    try {
                        const isTank = mod.CompareVehicleName(vehicle, mod.VehicleList.Abrams) || mod.CompareVehicleName(vehicle, mod.VehicleList.Leopard);
                        const isIFV = mod.CompareVehicleName(vehicle, mod.VehicleList.M2Bradley) || mod.CompareVehicleName(vehicle, mod.VehicleList.CV90);
                        const isAA = mod.CompareVehicleName(vehicle, mod.VehicleList.Cheetah) || mod.CompareVehicleName(vehicle, mod.VehicleList.Gepard);
                        const isMarauder = mod.CompareVehicleName(vehicle, mod.VehicleList.Marauder) || mod.CompareVehicleName(vehicle, mod.VehicleList.Marauder_Pax);
                        if (isTank) mod.SetVehicleMaxHealthMultiplier(vehicle, TANK_HEALTH_MULTIPLIER);
                        else if (isIFV) mod.SetVehicleMaxHealthMultiplier(vehicle, IFV_HEALTH_MULTIPLIER);
                        else if (isAA) mod.SetVehicleMaxHealthMultiplier(vehicle, AA_HEALTH_MULTIPLIER);
                        else if (isMarauder) mod.SetVehicleMaxHealthMultiplier(vehicle, MARAUDER_HEALTH_MULTIPLIER);
                    } catch (_e) {}
                    try {
                        const sc = mod.GetVehicleSeatCount(vehicle);
                        for (let s = 1; s < sc; s++) {
                            const occ = safeGetPlayerFromVehicleSeat(vehicle, s);
                            if (occ && isAISoldier(occ)) safeForcePlayerExitVehicle(occ, vehicle);
                        }
                    } catch (_e) {}
                }
                return;
            }
            if (retryCount < 4) seatPlayerDirectly(player, vehicle, targetSeat, label, retryCount + 1, claimRequestedPilot, seatGen);
            else {
                if (screenEffectOn) { try { mod.EnableScreenEffect(player, SEAT_TRANSITION_SCREEN_EFFECT, false); } catch (_e) {} screenEffectOn = false; }
                log(`[VehicleUI] Seating failed after retries for player ${playerId} -> ${label}`);
                clearSuppressStateIfCurrent(playerId, seatGen);
                showPlayerUI(player);
                try { mod.DisplayCustomNotificationMessage(mod.Message("{0}", `Failed to enter ${label}`), mod.CustomNotificationSlots.MessageText1, 3.0, player); } catch (_e) {}
            }
        });
    }
    function showPlayerUI(player: mod.Player): void {
        const pid = mod.GetObjId(player);
        if (!isPlayerOnDeployScreen(player)) { playerUIVisible.delete(pid); return; }
        const panel = playerPanels.get(pid);
        if (!panel) return;
        try { panel.show(); playerUIVisible.add(pid); } catch (_e) { destroyStalePanel(pid); }
    }
    function hidePlayerUI(player: mod.Player): void {
        const pid = mod.GetObjId(player);
        const panel = playerPanels.get(pid);
        if (panel) panel.hide();
        playerUIVisible.delete(pid);
    }
    function getVehicleSpawnerById(spawnerId: number): mod.VehicleSpawner | null {
        try { return mod.GetVehicleSpawner(spawnerId); } catch (_e) { return null; }
    }
    function findVehicleById(vehicleId: number): mod.Vehicle | null {
        try {
            const allVehicles = mod.AllVehicles();
            if (!allVehicles) return null;
            const count = mod.CountOf(allVehicles);
            for (let i = 0; i < count; i++) {
                const v = mod.ValueInArray(allVehicles, i) as mod.Vehicle;
                if (!v) continue;
                try { if (mod.GetObjId(v) === vehicleId) return v; } catch (_e) {}
            }
        } catch (_e) {}
        return null;
    }
    function handleSentinelClick(player: mod.Player, playerId: number, teamId: number, vehicleType: mod.VehicleList, matchTypes: mod.VehicleList[], vehicleLabel: string, gen: number): void {
        const isJetClick = isJetVehicle(vehicleType);
        let chosen: mod.Vehicle | null = null;
        let chosenId = 0;
        try {
            const allV = mod.AllVehicles();
            if (allV) {
                const c = mod.CountOf(allV);
                for (let i = 0; i < c; i++) {
                    const v = mod.ValueInArray(allV, i) as mod.Vehicle;
                    if (!v) continue;
                    let occ = true;
                    try { occ = mod.IsVehicleOccupied(v); } catch (_e) {}
                    if (occ) continue;
                    if (isJetClick) {
                        if (!matchesAnyVehicleType(v, matchTypes)) continue;
                    } else {
                        if (!mod.CompareVehicleName(v, vehicleType)) continue;
                    }
                    let vid = 0;
                    try { vid = mod.GetObjId(v); } catch (_e) { continue; }
                    if (!vid) continue;
                    if (reservedVehicleIds.has(vid)) continue;
                    let vehicleTeam = 0;
                    try {
                        const vTeam = mod.GetVehicleTeam(v);
                        if (vTeam) {
                            const t1 = mod.GetTeam(1); const t2 = mod.GetTeam(2);
                            if (t1 && mod.GetObjId(vTeam) === mod.GetObjId(t1)) vehicleTeam = 1;
                            else if (t2 && mod.GetObjId(vTeam) === mod.GetObjId(t2)) vehicleTeam = 2;
                        }
                    } catch (_e) {}
                    if (vehicleTeam === 0) {
                        const types = isJetClick ? matchTypes : [vehicleType];
                        for (const vt of types) {
                            if (!mod.CompareVehicleName(v, vt)) continue;
                            if (isFactionAppropriate(vt, 1)) { vehicleTeam = 1; break; }
                            if (isFactionAppropriate(vt, 2)) { vehicleTeam = 2; break; }
                        }
                    }
                    if (vehicleTeam !== 0 && vehicleTeam !== teamId) continue;
                    chosen = v; chosenId = vid;
                    break;
                }
            }
        } catch (_e) {}
        if (!chosen || !chosenId) {
            clickToast(player, `no live ${vehicleLabel} (sentinel - set ObjId on its spawner)`);
            try { mod.DisplayCustomNotificationMessage(mod.Message("{0}", `No ${vehicleLabel} available`), mod.CustomNotificationSlots.MessageText1, 3.0, player); } catch (_e) {}
            return;
        }
        log(`[VehicleUI] Sentinel click: T${teamId} player ${playerId} -> ${vehicleLabel} vehicle ${chosenId}`);
        reserveVehicleForHuman(chosenId, playerId);
        deployAndSeatPlayer(player, playerId, chosenId, 0, vehicleLabel, gen, true);
    }
    function findTrackedVehicleForSpawner(spawnerId: number, vehicleTypes: mod.VehicleList[], teamId: number): mod.Vehicle | null {
        const state = spawnerStateMap.get(spawnerId);
        if (!state || state.vehicleObjId === null) return null;
        const vehicle = findVehicleById(state.vehicleObjId);
        if (!vehicle || !matchesAnyVehicleType(vehicle, vehicleTypes)) return null;
        const spawnerTeam = getSpawnerTeamId(spawnerId);
        if (spawnerTeam !== 0 && spawnerTeam !== teamId) return null;
        return vehicle;
    }
    function matchesAnyVehicleType(vehicle: mod.Vehicle, vehicleTypes: mod.VehicleList[]): boolean {
        for (const vt of vehicleTypes) { try { if (mod.CompareVehicleName(vehicle, vt)) return true; } catch (_e) {} }
        return false;
    }
    function isAirVehicleType(vehicle: mod.Vehicle): boolean {
        try {
            return mod.CompareVehicleName(vehicle, mod.VehicleList.UH60) || mod.CompareVehicleName(vehicle, mod.VehicleList.UH60_Pax) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.AH64) || mod.CompareVehicleName(vehicle, mod.VehicleList.AH6M) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.AH6M_Pax) || mod.CompareVehicleName(vehicle, mod.VehicleList.Eurocopter) || mod.CompareVehicleName(vehicle, mod.VehicleList.F22) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.F16) || mod.CompareVehicleName(vehicle, mod.VehicleList.JAS39) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.SU57);
        } catch (_e) { return false; }
    }
    function isLightGroundVehicleType(vehicle: mod.Vehicle): boolean {
        try {
            return mod.CompareVehicleName(vehicle, mod.VehicleList.Marauder) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.Marauder_Pax) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.Vector) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.Flyer60) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.Quadbike) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.GolfCart) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.RHIB) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.DirtBike) ||
                   mod.CompareVehicleName(vehicle, mod.VehicleList.DirtBike_Pax);
        } catch (_e) { return false; }
    }
    const COLOR_BLUE = mod.CreateVector(0.0, 0.4, 0.9);
    const COLOR_GREEN = mod.CreateVector(0.2, 0.8, 0.3);
    const COLOR_BLACK = mod.CreateVector(0.1, 0.1, 0.1);
    function updateButtonStatusForPlayer(playerId: number, teamId: number): void {
        const buttons = playerButtons.get(playerId);
        if (!buttons) return;
        const vehicles = teamId === 1 ? getTeam1Vehicles() : getTeam2Vehicles();
        for (const vehicle of vehicles) {
            const button = buttons.get(vehicle.spawnerId);
            if (!button) continue;
            try {
                let buttonEnabled = true;
                let baseColor = COLOR_BLUE;
                if (isJetVehicle(vehicle.type) && getJetCooldownRemaining(playerId) > 0
                    && !hasIdleMatchingJet(vehicle.matchTypes ?? [vehicle.type], teamId)) {
                    buttonEnabled = false; baseColor = COLOR_BLACK;
                    button.setEnabled(buttonEnabled).setBaseColor(baseColor);
                    continue;
                }
                const state = spawnerStateMap.get(vehicle.spawnerId);
                const jetClick = isJetVehicle(vehicle.type);
                if (state) {
                    probeVehicleSeats(state);
                    if (state.availability === 'full') {
                        buttonEnabled = false; baseColor = COLOR_BLACK;
                    } else if (state.availability === 'no_vehicle' || state.availability === 'cooldown') {
                        if (jetClick && hasIdleMatchingJet(vehicle.matchTypes ?? [vehicle.type], teamId)) {
                        } else {
                            buttonEnabled = false; baseColor = COLOR_BLACK;
                        }
                    }
                } else if (jetClick) {
                    if (!hasIdleMatchingJet(vehicle.matchTypes ?? [vehicle.type], teamId)) {
                        buttonEnabled = false; baseColor = COLOR_BLACK;
                    }
                } else {
                    buttonEnabled = false; baseColor = COLOR_BLACK;
                }
                button.setEnabled(buttonEnabled).setBaseColor(baseColor);
            } catch (_e) {}
        }
    }
    const _lastButtonLabel = new Map<number, string>();
    export function vehicleUI_ApplyLabelCorrections(): void {
        if (!vehicleUIInitialized) return;
        const team1 = getTeam1Vehicles();
        const team2 = getTeam2Vehicles();
        const allDefs = [...team1, ...team2];
        let corrected = 0;
        for (const def of allDefs) {
            const prev = _lastButtonLabel.get(def.spawnerId);
            if (prev === def.label) continue;
            _lastButtonLabel.set(def.spawnerId, def.label);
            for (const [_pid, buttons] of playerButtons) {
                const button = buttons.get(def.spawnerId);
                if (!button) continue;
                try {
                    button.setMessage(mod.Message("{0}", def.label));
                    corrected++;
                } catch (_e) {}
            }
        }
        if (corrected > 0) log(`[VehicleUI] Label corrections applied in-place (${corrected} buttons updated)`);
    }
    function assignSpawnedVehicleToPendingPlayer(vehicle: mod.Vehicle, vehicleObjId: number): void {
        if (pendingSpawnRequestsByPlayerId.size === 0) return;
        const now = mod.GetMatchTimeElapsed();
        for (const [pid, req] of pendingSpawnRequestsByPlayerId.entries()) {
            if (now - req.time > MAX_SPAWN_ASSIGN_SECONDS) { pendingSpawnRequestsByPlayerId.delete(pid); continue; }
        }
        const matchedSpawnerId = vehicleIdToSpawnerId.get(vehicleObjId);
        if (matchedSpawnerId !== undefined) {
            for (const [pid, req] of pendingSpawnRequestsByPlayerId.entries()) {
                if (req.spawnerId === matchedSpawnerId) {
                    reserveVehicleForHuman(vehicleObjId, pid);
                    assignedSpawnedVehicleIdByPlayerId.set(pid, vehicleObjId);
                    pendingSpawnRequestsByPlayerId.delete(pid);
                    return;
                }
            }
        }
        for (const [pid, req] of pendingSpawnRequestsByPlayerId.entries()) {
            const reqMatchTypes = req.matchTypes ?? [req.vehicleType];
            if (matchesAnyVehicleType(vehicle, reqMatchTypes)) {
                const state = spawnerStateMap.get(req.spawnerId);
                if (state && state.vehicleObjId === null) {
                    state.vehicleObjId = vehicleObjId;
                    vehicleIdToSpawnerId.set(vehicleObjId, req.spawnerId);
                    const initPos = getVehiclePosition(vehicle);
                    if (initPos) vehicleInitialPosition.set(vehicleObjId, initPos);
                }
                reserveVehicleForHuman(vehicleObjId, pid);
                assignedSpawnedVehicleIdByPlayerId.set(pid, vehicleObjId);
                pendingSpawnRequestsByPlayerId.delete(pid);
                log(`[VehicleUI] Assigned ${req.label} vehicle ${vehicleObjId} to player ${pid} (type fallback)`);
                return;
            }
        }
    }
    export function vehicleUI_OnVehicleSpawned(vehicle: mod.Vehicle): void {
        if (!vehicleUIInitialized) return;
        try {
            const vid = mod.GetObjId(vehicle);
            if (pendingSpawnRequestsByPlayerId.size > 0) {
                let vehicleTeamNorm = 0;
                try {
                    const vTeam = mod.GetVehicleTeam(vehicle);
                    if (vTeam) {
                        const t1 = mod.GetTeam(1);
                        const t2 = mod.GetTeam(2);
                        if (t1 && mod.GetObjId(vTeam) === mod.GetObjId(t1)) vehicleTeamNorm = 1;
                        else if (t2 && mod.GetObjId(vTeam) === mod.GetObjId(t2)) vehicleTeamNorm = 2;
                    }
                } catch (_e) {}
                if (vehicleTeamNorm !== 0) {
                    for (const [_pid, req] of pendingSpawnRequestsByPlayerId) {
                        const matchTypes = [req.vehicleType];
                        if (matchesAnyVehicleType(vehicle, matchTypes)) {
                            spawnerTeamCache.set(req.spawnerId, vehicleTeamNorm);
                            if (vehicleTeamNorm !== req.teamId) {
                                log(`[VehicleUI] Learned spawner ${req.spawnerId} is T${vehicleTeamNorm} (expected T${req.teamId})`);
                            }
                            break;
                        }
                    }
                }
            }
            matchVehicleToSpawner(vehicle, vid, false);
            assignSpawnedVehicleToPendingPlayer(vehicle, vid);
        } catch (_e) {}
    }
    export function vehicleUI_OnVehicleDestroyed(vehicle: mod.Vehicle): void {
        if (!vehicleUIInitialized) return;
        try {
            const vid = mod.GetObjId(vehicle);
            const spawnerId = vehicleIdToSpawnerId.get(vid);
            if (spawnerId !== undefined) {
                const state = spawnerStateMap.get(spawnerId);
                if (state) {
                    state.vehicleObjId = null;
                    if (isJetVehicle(state.vehicleDef.type)) {
                        state.availability = 'no_vehicle';
                    } else {
                        state.availability = 'cooldown';
                        state.cooldownStartTime = mod.GetMatchTimeElapsed();
                        state.cooldownDuration = SPAWNER_COOLDOWN_SECONDS;
                    }
                }
                vehicleIdToSpawnerId.delete(vid);
                vehicleInitialPosition.delete(vid);
            }
        } catch (_e) {}
    }
    export function vehicleUI_OnPlayerEnterVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
        if (!vehicleUIInitialized) return;
        let vehicleObjId = 0;
        try {
            vehicleObjId = mod.GetObjId(vehicle);
            reprobeVehicle(vehicleObjId);
        } catch (_e) {}
        try {
            const playerTeamId = getPlayerTeamId(player);
            if (playerTeamId === 0) return;
            const matchedSpawnerId = vehicleIdToSpawnerId.get(vehicleObjId);
            if (matchedSpawnerId === undefined) return;
            const expectedTeamId = getSpawnerTeamId(matchedSpawnerId);
            if (expectedTeamId === 0 || expectedTeamId === playerTeamId) return;
            const playerId = mod.GetObjId(player);
            log(`[VehicleUI] Wrong-team vehicle entry blocked: player ${playerId} T${playerTeamId} entered spawner ${matchedSpawnerId} T${expectedTeamId}`);
            try { mod.ForcePlayerExitVehicle(player); } catch (_e) {}
        } catch (_e) {}
    }
    export function vehicleUI_OnPlayerExitVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
        if (!vehicleUIInitialized) return;
        try { reprobeVehicle(mod.GetObjId(vehicle)); } catch (_e) {}
    }
    export function vehicleUI_OnPlayerDeployed(player: mod.Player): void {
        if (!vehicleUIInitialized) return;
        if (!isPlayerHumanCached(player)) return;
        const pid = mod.GetObjId(player);
        hasEverDeployedByPlayerId.add(pid);
        const pending = pendingDeploySeat.get(pid);
        if (pending && isCurrentSeatGeneration(pid, pending.seatGen)) {
            pendingDeploySeat.delete(pid);
            const vehicle = findVehicleById(pending.vehicleObjId);
            if (vehicle) {
                seatPlayerDirectly(player, vehicle, pending.seatIndex, pending.label, 0, pending.claimRequestedPilot, pending.seatGen);
                return;
            }
        }
    }
    export function vehicleUI_OnPlayerUndeployed(player: mod.Player): void {
        if (!vehicleUIInitialized) return;
        if (!isPlayerHumanCached(player)) return;
        try {
            const pid = mod.GetObjId(player);
            clearJetClaimsForPlayer(pid);
        } catch (_e) {}
    }
    export function vehicleUI_HandleButtonEvent(player: mod.Player, widget: mod.UIWidget, buttonEvent: mod.UIButtonEvent): void {
    }
    export function onPlayerDeployedHideVehicleUI(player: mod.Player): void {
        hidePlayerUI(player);
    }
    export function onPlayerDiedShowUI(player: mod.Player): void {
        const pid = mod.GetObjId(player);
        lastDeathTimeByPlayerId.set(pid, mod.GetMatchTimeElapsed());
    }
    export function tickVehicleUI(): void {
        if (!vehicleUIInitialized) return;
        const matchTime = mod.GetMatchTimeElapsed();
        for (const [_sid, state] of spawnerStateMap) {
            if (state.availability === 'cooldown') {
                if (matchTime - state.cooldownStartTime >= state.cooldownDuration) {
                    state.availability = 'no_vehicle';
                    state.vehicleObjId = null;
                }
            }
        }
        if (matchTime - lastUIStatusUpdateTime >= UI_STATUS_UPDATE_INTERVAL) {
            lastUIStatusUpdateTime = matchTime;
            scanExistingVehicles();
            for (const [key, res] of reservedVehicleIds.entries()) { if (matchTime > res.expiresAt) reservedVehicleIds.delete(key); }
            for (const [pid, expiry] of suppressUIUntilByPlayerId.entries()) {
                if (matchTime > expiry) suppressUIUntilByPlayerId.delete(pid);
            }
        }
        try {
            const allPlayers = mod.AllPlayers();
            if (!allPlayers) return;
            const count = mod.CountOf(allPlayers);
            for (let i = 0; i < count; i++) {
                const player = mod.ValueInArray(allPlayers, i) as mod.Player;
                if (!player) continue;
                if (!isPlayerHumanCached(player)) continue;
                const pid = mod.GetObjId(player);
                const suppressed = suppressUIUntilByPlayerId.has(pid);
                const onDeployScreen = isPlayerOnDeployScreen(player);
                if (onDeployScreen && !suppressed) {
                    const teamId = getPlayerTeamId(player);
                    if (teamId !== 1 && teamId !== 2) continue;
                    const cachedTeam = playerPanelTeam.get(pid);
                    if (cachedTeam !== undefined && cachedTeam !== teamId) {
                        destroyStalePanel(pid);
                    }
                    if (!playerPanels.has(pid) || !isPanelAlive(pid)) {
                        createPlayerUI(player);
                    }
                    if (!playerUIVisible.has(pid)) showPlayerUI(player);
                    updateButtonStatusForPlayer(pid, teamId);
                } else if (playerUIVisible.has(pid)) {
                    hidePlayerUI(player);
                }
            }
        } catch (_e) {}
    }
    export function initVehicleSpawnUI(forceRebuild: boolean = false): void {
        const prevT1 = team1Vehicles.length;
        const prevT2 = team2Vehicles.length;
        const prevSig = currentSpawnerSetSignature();
        buildVehicleDefsFromDiscovery();
        if (team1Vehicles.length === 0 && team2Vehicles.length === 0) {
            if (!vehicleUIInitialized) {
                log(`[VehicleUI] No vehicles discovered yet - waiting for map to spawn vehicles`);
            }
            return;
        }
        const newSig = currentSpawnerSetSignature();
        if (vehicleUIInitialized && !forceRebuild && newSig === prevSig &&
            team1Vehicles.length === prevT1 && team2Vehicles.length === prevT2) {
            return;
        }
        if (vehicleUIInitialized && newSig !== prevSig) {
            log(`[VehicleUI] Spawner set changed -> rebuild (was ${prevSig} now ${newSig})`);
        }
        if (vehicleUIInitialized) {
            for (const [_pid, panel] of playerPanels) {
                try { panel.hide(); panel.delete(); } catch (_e) {}
            }
            for (const [_pid, disposer] of playerPanelDisposers) {
                try { disposer(); } catch (_e) {}
            }
            playerPanels.clear();
            playerButtons.clear();
            playerButtonStateSetters.clear();
            playerPanelDisposers.clear();
            playerUIVisible.clear();
            log(`[VehicleUI] Rebuilt UI with new vehicles`);
        }
        initSpawnerStateTracking();
        scanExistingVehicles();
        vehicleUIInitialized = true;
        log(`[VehicleUI] Initialized with ${team1Vehicles.length + team2Vehicles.length} vehicles (T1=${team1Vehicles.length}, T2=${team2Vehicles.length})`);
    }
}


// ===== Module: main.script.ts =====
let __vuiInitialized = false;
let __vuiRunning = false;
let __vuiRunToken = 0;
const __VUI_TICK_INTERVAL_SECONDS = 1.0;
function VehicleUIStandalone_Init(): void {
    if (__vuiInitialized) return;
    __vuiInitialized = true;
    VehicleUIStandalone.log("======================================================");
    VehicleUIStandalone.log("Vehicle UI Standalone - initializing");
    VehicleUIStandalone.log("======================================================");
    try {
        mod.SetAllVehiclesAllowedInSurroundingArea(true);
        mod.SetVehicleCategoryAllowedInSurroundingArea(mod.VehicleCategories.Air_All, true);
        mod.SetVehicleCategoryAllowedInSurroundingArea(mod.VehicleCategories.Air_Plane, true);
        mod.SetVehicleCategoryAllowedInSurroundingArea(mod.VehicleCategories.Air_Heli, true);
        mod.SetMaxVehicleHeightLimitScale(2);
    } catch (e) {
        VehicleUIStandalone.logError(`[Init] vehicle allow-list: ${e}`);
    }
    VehicleUIStandalone.safeCall("AutoDiscovery_Init", () => VehicleUIStandalone.AutoDiscovery_Init());
    if (VehicleUIStandalone.discoveredVehicleSpawners.length > 0) {
        VehicleUIStandalone.log(`[VehicleUI] ${VehicleUIStandalone.discoveredVehicleSpawners.length} spawner(s) discovered at init`);
    } else {
        VehicleUIStandalone.log("[VehicleUI] No vehicles observed at init - waiting for OnVehicleSpawned events");
    }
    VehicleUIStandalone.safeCall("initVehicleSpawnUI", () => VehicleUIStandalone.initVehicleSpawnUI());
    __vuiRunning = true;
    __vuiRunToken++;
    void VehicleUIStandalone_TickLoop(__vuiRunToken);
}
async function VehicleUIStandalone_TickLoop(token: number): Promise<void> {
    while (__vuiRunning && token === __vuiRunToken) {
        VehicleUIStandalone.safeCall("AutoDiscovery_ResweepLiveVehicles", () => VehicleUIStandalone.AutoDiscovery_ResweepLiveVehicles());
        VehicleUIStandalone.safeCall("initVehicleSpawnUI", () => VehicleUIStandalone.initVehicleSpawnUI());
        VehicleUIStandalone.safeCall("tickVehicleUI", () => VehicleUIStandalone.tickVehicleUI());
        VehicleUIStandalone.safeCall("vehicleUI_ApplyLabelCorrections", () => VehicleUIStandalone.vehicleUI_ApplyLabelCorrections());
        try {
            await mod.Wait(__VUI_TICK_INTERVAL_SECONDS);
        } catch (_e) {
            return;
        }
    }
}
function VehicleUIStandalone_Shutdown(): void {
    __vuiRunning = false;
    __vuiInitialized = false;
}
function VehicleUIStandalone_Tick(): void {
    if (!__vuiInitialized) return;
    VehicleUIStandalone.safeCall("AutoDiscovery_ResweepLiveVehicles", () => VehicleUIStandalone.AutoDiscovery_ResweepLiveVehicles());
    VehicleUIStandalone.safeCall("initVehicleSpawnUI", () => VehicleUIStandalone.initVehicleSpawnUI());
    VehicleUIStandalone.safeCall("tickVehicleUI", () => VehicleUIStandalone.tickVehicleUI());
    VehicleUIStandalone.safeCall("vehicleUI_ApplyLabelCorrections", () => VehicleUIStandalone.vehicleUI_ApplyLabelCorrections());
}
function VehicleUIStandalone_OnPlayerDeployed(player: mod.Player): void {
    if (!player) return;
    Events.OnPlayerDeployed.trigger(player);
}
function VehicleUIStandalone_OnPlayerUndeployed(player: mod.Player): void {
    if (!player) return;
    Events.OnPlayerUndeploy.trigger(player);
}
function VehicleUIStandalone_OnPlayerDied(player: mod.Player): void {
    if (!player) return;
    Events.OnPlayerDied.trigger(player, null, null, null);
}
function VehicleUIStandalone_OnVehicleSpawned(vehicle: mod.Vehicle): void {
    if (!vehicle) return;
    Events.OnVehicleSpawned.trigger(vehicle);
}
function VehicleUIStandalone_OnVehicleDestroyed(vehicle: mod.Vehicle): void {
    if (!vehicle) return;
    Events.OnVehicleDestroyed.trigger(vehicle);
}
function VehicleUIStandalone_OnPlayerEnterVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
    if (!player || !vehicle) return;
    Events.OnPlayerEnterVehicle.trigger(player, vehicle);
}
function VehicleUIStandalone_OnPlayerExitVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
    if (!player || !vehicle) return;
    Events.OnPlayerExitVehicle.trigger(player, vehicle);
}
function VehicleUIStandalone_OnPlayerUIButtonEvent(player: mod.Player, widget: mod.UIWidget, buttonEvent: mod.UIButtonEvent): void {
    if (!player || !widget) return;
    Events.OnPlayerUIButtonEvent.trigger(player, widget, buttonEvent);
}
Events.OnGameModeStarted.subscribe(() => VehicleUIStandalone_Init());
Events.OnPlayerDeployed.subscribe((player: mod.Player) => {
    if (!player) return;
    VehicleUIStandalone.markPlayerDeployed(player);
    if (!__vuiInitialized) return;
    const isAI = VehicleUIStandalone.isAISoldier(player);
    VehicleUIStandalone.safeCall("vehicleUI_OnPlayerDeployed", () => VehicleUIStandalone.vehicleUI_OnPlayerDeployed(player));
    if (!isAI) {
        VehicleUIStandalone.safeCall("onPlayerDeployedHideVehicleUI", () => VehicleUIStandalone.onPlayerDeployedHideVehicleUI(player));
    }
});
Events.OnPlayerUndeploy.subscribe((player: mod.Player) => {
    if (!player) return;
    if (__vuiInitialized) {
        VehicleUIStandalone.safeCall("vehicleUI_OnPlayerUndeployed", () => VehicleUIStandalone.vehicleUI_OnPlayerUndeployed(player));
    }
    VehicleUIStandalone.markPlayerUndeployed(player);
});
Events.OnPlayerDied.subscribe((player: mod.Player) => {
    if (!__vuiInitialized || !player) return;
    if (VehicleUIStandalone.isAISoldier(player)) return;
    VehicleUIStandalone.safeCall("onPlayerDiedShowUI", () => VehicleUIStandalone.onPlayerDiedShowUI(player));
});
Events.OnVehicleSpawned.subscribe((vehicle: mod.Vehicle) => {
    if (!__vuiInitialized || !vehicle) return;
    VehicleUIStandalone.safeCall("AutoDiscovery_OnVehicleSpawned", () => VehicleUIStandalone.AutoDiscovery_OnVehicleSpawned(vehicle));
    VehicleUIStandalone.safeCall("vehicleUI_OnVehicleSpawned", () => VehicleUIStandalone.vehicleUI_OnVehicleSpawned(vehicle));
});
Events.OnVehicleDestroyed.subscribe((vehicle: mod.Vehicle) => {
    if (!__vuiInitialized || !vehicle) return;
    VehicleUIStandalone.safeCall("vehicleUI_OnVehicleDestroyed", () => VehicleUIStandalone.vehicleUI_OnVehicleDestroyed(vehicle));
});
Events.OnPlayerEnterVehicle.subscribe((player: mod.Player, vehicle: mod.Vehicle) => {
    if (!__vuiInitialized || !player || !vehicle) return;
    VehicleUIStandalone.safeCall("vehicleUI_OnPlayerEnterVehicle", () => VehicleUIStandalone.vehicleUI_OnPlayerEnterVehicle(player, vehicle));
});
Events.OnPlayerExitVehicle.subscribe((player: mod.Player, vehicle: mod.Vehicle) => {
    if (!__vuiInitialized || !player || !vehicle) return;
    VehicleUIStandalone.safeCall("vehicleUI_OnPlayerExitVehicle", () => VehicleUIStandalone.vehicleUI_OnPlayerExitVehicle(player, vehicle));
});
Events.OnPlayerUIButtonEvent.subscribe((player: mod.Player, widget: mod.UIWidget, buttonEvent: mod.UIButtonEvent) => {
    if (!__vuiInitialized || !player || !widget) return;
    VehicleUIStandalone.safeCall("vehicleUI_HandleButtonEvent", () => VehicleUIStandalone.vehicleUI_HandleButtonEvent(player, widget, buttonEvent));
});
export function OnGameModeStarted(): void {
    Events.OnGameModeStarted.trigger();
}
export function OnPlayerDeployed(player: mod.Player): void {
    Events.OnPlayerDeployed.trigger(player);
}
export function OnPlayerUndeploy(player: mod.Player): void {
    Events.OnPlayerUndeploy.trigger(player);
}
export function OnPlayerDied(player: mod.Player, killer: mod.Player, deathType: mod.DeathType, weapon: mod.WeaponUnlock): void {
    Events.OnPlayerDied.trigger(player, killer, deathType, weapon);
}
export function OnVehicleSpawned(vehicle: mod.Vehicle): void {
    Events.OnVehicleSpawned.trigger(vehicle);
}
export function OnVehicleDestroyed(vehicle: mod.Vehicle, destroyer: mod.Player, weapon: mod.WeaponUnlock): void {
    Events.OnVehicleDestroyed.trigger(vehicle, destroyer, weapon);
}
export function OnPlayerEnterVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
    Events.OnPlayerEnterVehicle.trigger(player, vehicle);
}
export function OnPlayerExitVehicle(player: mod.Player, vehicle: mod.Vehicle): void {
    Events.OnPlayerExitVehicle.trigger(player, vehicle);
}
export function OnPlayerUIButtonEvent(player: mod.Player, widget: mod.UIWidget, buttonEvent: mod.UIButtonEvent): void {
    Events.OnPlayerUIButtonEvent.trigger(player, widget, buttonEvent);
}

