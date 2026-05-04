// SolidUI from bf6-portal-utils v2.2.0
// Reactive UI framework - createSignal, createEffect, createMemo, createStore, createRoot, Index
// Stripped of import/export for namespace bundling (uses Logging from lib/logging.ts)

namespace SolidUI {
    /****** Logging ******/

    const logging = new Logging('SolidUI');

    export const LogLevel = Logging.LogLevel;

    export function setLogging(
        log?: (text: string) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeError?: boolean
    ): void {
        logging.setLogging(log, logLevel, includeError);
    }

    /****** Classes and Types ******/

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

    /****** Local Utils ******/

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

    /****** Scheduling ******/

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

    /****** Reactivity Core ******/

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

    /****** Store ******/

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

    /****** Context (Theming & Dependency Injection) ******/

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

    /****** Factory ******/

    export function onCleanup(fn: () => void): void {
        currentCleanupList?.add(fn);
    }

    function setProperty<T>(instance: T, key: keyof T, value: unknown): void {
        try {
            (instance as unknown as Record<keyof T, unknown>)[key] = value;
        } catch {
            /* ignore read-only */
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
