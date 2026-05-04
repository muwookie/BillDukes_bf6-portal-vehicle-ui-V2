// CallbackHandler from bf6-portal-utils v1.0.0
// Stripped of import/export for namespace bundling

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
