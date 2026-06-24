import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SystemConfig,
  SystemConfigDocument,
  SystemConfigKey,
} from '../schemas/system-config.schema';

/**
 * Typed access layer over the system_config collection (master context 5.17 /
 * 6.2). No client or other service may read system_config directly — every
 * read goes through here so values are validated and typed, with safe
 * fallbacks when a key is unseeded or malformed.
 */
@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name);

  /** Used when platform_fee_percent is missing or invalid in the DB. */
  static readonly defaultPlatformFeePercent = 5;

  constructor(
    @InjectModel(SystemConfig.name)
    private readonly configModel: Model<SystemConfigDocument>,
  ) {}

  /**
   * Returns the platform fee percentage. Falls back to
   * [defaultPlatformFeePercent] when the key is absent or not a sane number,
   * so order creation never fails on a fresh / un-seeded database.
   */
  async getPlatformFeePercent(): Promise<number> {
    const raw = await this.readValue(SystemConfigKey.PlatformFeePercent);
    const value = this.toFinitePercent(raw);
    if (value === null) {
      this.logger.warn(
        `platform_fee_percent missing/invalid; falling back to ` +
          `${SystemConfigService.defaultPlatformFeePercent}%`,
      );
      return SystemConfigService.defaultPlatformFeePercent;
    }
    return value;
  }

  private async readValue(key: SystemConfigKey): Promise<unknown> {
    const doc = await this.configModel.findOne({ key }).lean().exec();
    return doc?.value;
  }

  /** Accepts a number or numeric string in the inclusive range [0, 100]. */
  private toFinitePercent(raw: unknown): number | null {
    const n =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number(raw)
          : NaN;
    if (!Number.isFinite(n) || n < 0 || n > 100) return null;
    return n;
  }
}
