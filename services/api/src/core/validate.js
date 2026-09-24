import { toFieldErrors } from '@jamzo/validation';
import { AppError } from './errors.js';

/**
 * Parse input with a zod schema or throw VALIDATION_FAILED with field errors.
 * @template {import('zod').ZodType} S
 * @param {S} schema
 * @param {unknown} input
 * @returns {import('zod').output<S>}
 */
export function parse(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'Some fields are invalid.', {
      fieldErrors: toFieldErrors(result.error),
    });
  }
  return result.data;
}
