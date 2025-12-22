import { BadRequestException, ValidationError } from '@nestjs/common';

export function formatValidationErrors(errors: ValidationError[]): string {
  const formattedErrors = errors.map((error) => {
    if (error.constraints) {
      return `${error.property}: ${Object.values(error.constraints).join(', ')}`;
    }
    return `${error.property}: Invalid value`;
  });
  return formattedErrors.join('; ');
}

export class ValidationUtil {
  static throwValidationError(errors: ValidationError[]): never {
    throw new BadRequestException(formatValidationErrors(errors));
  }
}
