import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService {
  constructor(private configService: ConfigService) {}

  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: this.configService.get<string>('API_VERSION', 'v1'),
    };
  }
}
