import {
  ArgumentMetadata,
  HttpStatus,
  Injectable,
  PipeTransform,
} from "@nestjs/common";
import { API_ERROR_CODES } from "@smile/shared";
import type { ZodType } from "zod";
import { DomainException } from "../exceptions/domain.exception";

@Injectable()
export class ZodValidationPipe<T = unknown> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      const summary = issues
        .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
        .join("; ");
      throw new DomainException(
        API_ERROR_CODES.INVALID_INPUT,
        summary || "Validation failed.",
        HttpStatus.BAD_REQUEST,
        issues
      );
    }
    return result.data;
  }
}
