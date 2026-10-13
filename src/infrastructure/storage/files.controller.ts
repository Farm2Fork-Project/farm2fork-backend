import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { StorageService } from './storage.service';

/**
 * Serves locally stored uploads when Cloudinary is not configured. Private
 * files require the HMAC signature from StorageService.signedUrl.
 */
@ApiExcludeController()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get('public/:name')
  async publicFile(@Param('name') name: string, @Res() res: Response) {
    const file = await this.storage.readLocal('public', name);
    if (!file) throw new NotFoundException();
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    this.send(res, file);
  }

  @Public()
  @Get('private/:name')
  async privateFile(
    @Param('name') name: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    const file = await this.storage.readLocal('private', name, { exp, sig });
    if (!file) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, no-store');
    this.send(res, file);
  }

  private send(res: Response, file: { buffer: Buffer; mimeType: string }) {
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.buffer);
  }
}
