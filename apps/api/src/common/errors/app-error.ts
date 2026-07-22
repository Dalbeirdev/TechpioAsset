import { ERROR_STATUS, type ErrorCode, type FieldError } from '@techpioasset/contracts';

/**
 * Domain-level error carrying a catalogued code.
 *
 * Services throw these rather than Nest HTTP exceptions so business rules stay
 * transport-agnostic; the filter maps code to HTTP status from the single table
 * in @techpioasset/contracts, which keeps API and clients from drifting.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: string;
  readonly fieldErrors?: FieldError[];
  /** Never serialised to the client; logged server-side only. */
  readonly internalContext?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      detail?: string;
      fieldErrors?: FieldError[];
      internalContext?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.detail = options?.detail;
    this.fieldErrors = options?.fieldErrors;
    this.internalContext = options?.internalContext;
  }

  static notFound(resource: string, id?: string): AppError {
    return new AppError('NOT_FOUND', `${resource} not found`, {
      internalContext: id ? { id } : undefined,
    });
  }

  static forbidden(reason = 'You do not have permission to perform this action'): AppError {
    return new AppError('FORBIDDEN', reason);
  }

  static conflict(code: ErrorCode, message: string): AppError {
    return new AppError(code, message);
  }
}
