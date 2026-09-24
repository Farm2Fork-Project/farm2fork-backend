import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { GeoPoint, GeoPointSchema } from '../../../common/geo/geo-point.schema';

export type TransporterProfileDocument = HydratedDocument<TransporterProfile>;

export enum VehicleType {
  Bike = 'bike',
  Rickshaw = 'rickshaw',
  Van = 'van',
  Truck = 'truck',
}

@Schema({
  collection: 'transporter_profiles',
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class TransporterProfile {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({ required: true, type: String, enum: VehicleType })
  vehicleType!: VehicleType;

  @Prop({ required: true, trim: true })
  vehicleNumber!: string;

  /** licenseNumber (master context 6.6) - regulatory document, sensitive. */
  @Prop({ required: true, select: false })
  licenseNumber!: string;

  /** cnic (master context 6.6) - National ID, sensitive. */
  @Prop({ required: true, unique: true, index: true, select: false })
  cnic!: string;

  @Prop({ type: [String], default: [] })
  serviceAreas!: string[];

  /**
   * Online toggle in the transporter app: only available transporters with
   * a recent location receive delivery offers.
   */
  @Prop({ default: true })
  isAvailable!: boolean;

  /** Last location reported by the app while online (foreground only). */
  @Prop({ type: GeoPointSchema })
  lastLocation?: GeoPoint;

  @Prop()
  lastLocationAt?: Date;

  /**
   * Written by every claim so two concurrent claims by the same transporter
   * conflict in their transactions: one delivery at a time.
   */
  @Prop()
  lastClaimAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TransporterProfileSchema =
  SchemaFactory.createForClass(TransporterProfile);

TransporterProfileSchema.index({ lastLocation: '2dsphere' });
