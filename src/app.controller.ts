import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
}

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Health check',
    description: 'Check if the API is running',
  })
  @ApiResponse({
    status: 200,
    description: 'API is healthy',
    schema: {
      example: {
        status: 'ok',
        timestamp: '2025-12-22T10:00:00Z',
        version: 'v1',
      },
    },
  })
  health(): HealthResponse {
    return this.appService.health();
  }
}
