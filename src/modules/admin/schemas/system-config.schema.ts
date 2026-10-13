import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type SystemConfigDocument = HydratedDocument<SystemConfig>;

/**
 * Known config keys (master context 5.17). Reads must always go through
 * ConfigService (never accessed directly by any client).
 */
export enum SystemConfigKey {
  PlatformFeePercent = 'platform_fee_percent',
  MaxLoanAmount = 'max_loan_amount',
  MinLoanAmount = 'min_loan_amount',
  SupportedGateways = 'supported_gateways',
  // Delivery pricing and dispatch (owner-approved, see DeliverySettings).
  DeliveryBaseFee = 'delivery_base_fee',
  DeliveryFeePerKm = 'delivery_fee_per_km',
  DeliveryRoadFactor = 'delivery_road_factor',
  DispatchRadiusKm = 'dispatch_radius_km',
  TransporterLocationMaxAgeMinutes = 'transporter_location_max_age_minutes',
}

@Schema({
  collection: 'system_config',
  timestamps: { createdAt: false, updatedAt: true },
})
export class SystemConfig {
  @Prop({ required: true, unique: true, index: true })
  key!: string;

  /** Type depends on key - validated by ConfigService before use. */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  value!: unknown;

  @Prop()
  description?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;

  updatedAt!: Date;
}

export const SystemConfigSchema = SchemaFactory.createForClass(SystemConfig);
