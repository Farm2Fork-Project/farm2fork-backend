import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  AUTH_PROVIDERS,
  AuthProvider,
} from '../../../common/enums/auth-provider.enum';
import {
  AUTHENTICATED_USER_ROLES,
  UserRole,
} from '../../../common/enums/user-role.enum';

export type UserDocument = HydratedDocument<User>;

/**
 * users (Collection 5.1) - root entity. All profiles reference this.
 *
 * Sensitive fields (master context 6.6): fcmToken and firebaseUid
 * must never be exposed to any client or logged. They are `select: false` so
 * they are excluded from query results by default and stripped again in toJSON
 * as a second line of defence.
 *
 * Auth: identity is verified by Firebase (Google / email-password); the backend
 * verifies the Firebase ID token and mints its own JWT. `firebaseUid` links the
 * account to Firebase. Credentials are owned solely by Firebase.
 */
@Schema({
  collection: 'users',
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.fcmToken;
      delete ret.firebaseUid;
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

  /** Firebase Auth UID - unique, sparse (legacy rows may not have one yet). */
  @Prop({ required: false, unique: true, sparse: true, select: false })
  firebaseUid?: string;

  /** Identity provider reported by Firebase for this account. */
  @Prop({ required: false, type: String, enum: AUTH_PROVIDERS })
  authProvider?: AuthProvider;

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
