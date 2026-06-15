import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  AUTHENTICATED_USER_ROLES,
  UserRole,
} from '../../../common/enums/user-role.enum';

export type UserDocument = HydratedDocument<User>;

/**
 * users (Collection 5.1) - root entity. All profiles reference this.
 *
 * Sensitive fields (master context 6.6): passwordHash and fcmToken must never
 * be exposed to any client or logged. They are `select: false` so they are
 * excluded from query results by default and stripped again in toJSON as a
 * second line of defence. Login explicitly re-selects passwordHash.
 */
@Schema({
  collection: 'users',
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.passwordHash;
      delete ret.fcmToken;
      delete ret.__v;
      return ret;
    },
  },
})
export class User {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  email!: string;

  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ required: true, type: String, enum: AUTHENTICATED_USER_ROLES })
  role!: UserRole;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ default: false })
  isVerified!: boolean;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ select: false })
  fcmToken?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
