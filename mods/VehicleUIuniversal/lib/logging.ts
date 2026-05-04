// Logging class from bf6-portal-utils v1.0.2
// Stripped of export for namespace bundling

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
