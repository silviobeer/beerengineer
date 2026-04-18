export class AppError extends Error {
  public readonly code: string;
  public readonly cause?: unknown;

  public constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.cause = options?.cause;
  }
}

export class ConfigurationError extends AppError {
  public constructor(message: string, options?: { cause?: unknown }) {
    super("CONFIGURATION_ERROR", message, options);
    this.name = "ConfigurationError";
  }
}

export class PersistenceError extends AppError {
  public constructor(message: string, options?: { cause?: unknown }) {
    super("PERSISTENCE_ERROR", message, options);
    this.name = "PersistenceError";
  }
}
