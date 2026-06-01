import { ApiProperty } from '@nestjs/swagger';

export class SuccessResponseDto<T> {
  @ApiProperty({
    description: 'Success status',
  })
  success!: boolean;

  @ApiProperty({
    description: 'Response data',
  })
  data!: T;

  @ApiProperty({
    description: 'Response message',
    required: false,
  })
  message?: string;
}

export class PaginatedResponseDto<T> extends SuccessResponseDto<T[]> {
  @ApiProperty({
    description: 'Total count of items',
  })
  total!: number;

  @ApiProperty({
    description: 'Current page number',
  })
  page!: number;

  @ApiProperty({
    description: 'Items per page',
  })
  limit!: number;

  @ApiProperty({
    description: 'Total pages',
  })
  totalPages!: number;
}

export class ErrorResponseDto {
  @ApiProperty({
    description: 'Error status',
  })
  success!: boolean;

  @ApiProperty({
    description: 'Error message',
  })
  message!: string;

  @ApiProperty({
    description: 'Error details',
    required: false,
  })
  error?: string | Record<string, unknown>;

  @ApiProperty({
    description: 'Timestamp of error',
  })
  timestamp!: string;
}
