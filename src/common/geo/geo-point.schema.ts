import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** GeoJSON Point ([lng, lat]) for 2dsphere queries. */
@Schema({ _id: false })
export class GeoPoint {
  @Prop({ type: String, enum: ['Point'], required: true })
  type!: 'Point';

  @Prop({ type: [Number], required: true })
  coordinates!: [number, number];
}
export const GeoPointSchema = SchemaFactory.createForClass(GeoPoint);
