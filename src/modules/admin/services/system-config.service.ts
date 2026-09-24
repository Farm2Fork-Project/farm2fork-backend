import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SystemConfig,
  SystemConfigDocument,
  SystemConfigKey,
} from '../schemas/system-config.schema';

export interface DeliverySettings {
  /** Flat PKR amount every delivery starts at. */
  baseFee: number;
  /** PKR per estimated road kilometre. */
  feePerKm: number;
  /** Straight-line distance x factor approximates road distance. */
  roadFactor: number;
  /** Transporters within this distance of the farm are offered the order. */
  radiusKm: number;
  /** A transporter location older than this is not used for matching. */
  locationMaxAgeMinutes: number;
}

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

  /** Illustrative PKR bounds until the owner seeds min/max_loan_amount. */
  static readonly defaultLoanLimits = { min: 10_000, max: 1_000_000 };

  /** Illustrative PKR defaults until the owner seeds real rates. */
  static readonly defaultDeliverySettings: DeliverySettings = {
    baseFee: 150,
    feePerKm: 25,
    roadFactor: 1.3,
    radiusKm: 25,
    locationMaxAgeMinutes: 60,
  };

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

  /**
   * Delivery pricing and dispatch settings. Each key falls back to its
   * default independently when missing or out of range.
   */
  async getDeliverySettings(): Promise<DeliverySettings> {
    const read = async (
      key: SystemConfigKey,
      fallback: number,
      min: number,
      max: number,
    ): Promise<number> => {
      const raw = await this.readValue(key);
      const n =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string'
            ? Number(raw)
            : NaN;
      return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
    };
    const d = SystemConfigService.defaultDeliverySettings;
    const [baseFee, feePerKm, roadFactor, radiusKm, locationMaxAgeMinutes] =
      await Promise.all([
        read(SystemConfigKey.DeliveryBaseFee, d.baseFee, 0, 100_000),
        read(SystemConfigKey.DeliveryFeePerKm, d.feePerKm, 0, 10_000),
        read(SystemConfigKey.DeliveryRoadFactor, d.roadFactor, 1, 3),
        read(SystemConfigKey.DispatchRadiusKm, d.radiusKm, 1, 500),
        read(
          SystemConfigKey.TransporterLocationMaxAgeMinutes,
          d.locationMaxAgeMinutes,
          1,
          24 * 60,
        ),
      ]);
    return { baseFee, feePerKm, roadFactor, radiusKm, locationMaxAgeMinutes };
  }

  /** Loan amount bounds in PKR (master context 5.17 keys). */
  async getLoanLimits(): Promise<{ min: number; max: number }> {
    const [rawMin, rawMax] = await Promise.all([
      this.readValue(SystemConfigKey.MinLoanAmount),
      this.readValue(SystemConfigKey.MaxLoanAmount),
    ]);
    const toAmount = (raw: unknown) => {
      const n =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string'
            ? Number(raw)
            : NaN;
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const d = SystemConfigService.defaultLoanLimits;
    const min = toAmount(rawMin) ?? d.min;
    const max = toAmount(rawMax) ?? d.max;
    return min <= max ? { min, max } : d;
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
