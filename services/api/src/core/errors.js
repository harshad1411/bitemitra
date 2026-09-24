// Standard error model (API.md §3, spec §71). Handlers throw AppError; the error handler renders
// { error: { code, message, fieldErrors?, requestId, details? } }. Stack traces never leave the server.
import { ERROR_STATUS } from '@jamzo/shared-types';

export class AppError extends Error {
  /**
   * @param {string} code one of ERROR_CODES
   * @param {string} message safe, user-facing message
   * @param {{ fieldErrors?: Record<string, string[]>, details?: Record<string, unknown>, status?: number }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = extra.status ?? ERROR_STATUS[code] ?? 500;
    this.fieldErrors = extra.fieldErrors;
    this.details = extra.details;
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found.`);
export const forbidden = (message = 'You do not have permission to do this.') => new AppError('FORBIDDEN', message);
export const conflict = (message, details) => new AppError('CONFLICT', message, { details });
export const unauthenticated = (message = 'Please sign in.') => new AppError('UNAUTHENTICATED', message);
export const invalid = (message, fieldErrors) => new AppError('VALIDATION_FAILED', message, { fieldErrors });
