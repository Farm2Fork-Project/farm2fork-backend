import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 501 | 503;

const ERROR_DESCRIPTIONS: Record<ErrorStatus, string> = {
  400: 'The request is invalid for the current resource state or fails validation.',
  401: 'Authentication is missing, invalid, expired, or the account is inactive.',
  403: 'The authenticated user does not have permission to perform this action.',
  404: 'The requested resource is not available to the authenticated user.',
  409: 'The request conflicts with the current resource state.',
  413: 'The uploaded file is larger than the allowed limit.',
  429: 'Too many requests from this client; retry after the rate-limit window.',
  501: 'This integration endpoint is reserved but not implemented yet.',
  503: 'A dependent service (e.g. the AI model service) is unavailable.',
};

export function ApiErrorResponses(...statuses: ErrorStatus[]): MethodDecorator {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: ERROR_DESCRIPTIONS[status],
        schema: {
          example: {
            statusCode: status,
            message: ERROR_DESCRIPTIONS[status],
            error: 'Request failed',
          },
        },
      }),
    ),
  );
}
