import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validates and *replaces* the incoming value with the parsed result.
 *
 * Returning the parsed output matters: it strips unknown keys and applies
 * coercions, so a handler can never act on a field the schema did not declare.
 * That is what stops mass-assignment - spec section 20's "never trust role or
 * permission values submitted by the frontend" depends on it.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    // A ZodError thrown here is turned into a 422 with field paths by
    // ProblemDetailsFilter; no try/catch needed.
    return this.schema.parse(value);
  }
}

/** Convenience factory: `@Body(zodBody(createAssetSchema))`. */
export function zodBody(schema: ZodSchema): ZodValidationPipe {
  return new ZodValidationPipe(schema);
}
