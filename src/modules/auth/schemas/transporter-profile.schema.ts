import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

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

  @Prop({ default: true })
  isAvailable!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TransporterProfileSchema =
  SchemaFactory.createForClass(TransporterProfile);
