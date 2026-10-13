import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import type { RequestUser } from '../../common/guards/roles.guard';
import { hasCoordinates } from '../../common/geo/geo';
import { avatarUrl } from '../../infrastructure/storage/avatar';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditLog, AuditLogDocument } from '../admin/schemas/audit-log.schema';
import {
  ProfileDetailsDto,
  ProfileResponseDto,
  UpdateProfileDto,
} from './dto/profile.dto';
import {
  BuyerProfile,
  BuyerProfileDocument,
} from './schemas/buyer-profile.schema';
import {
  FarmerProfile,
  FarmerProfileDocument,
} from './schemas/farmer-profile.schema';
import {
  FinancialPartnerProfile,
  FinancialPartnerProfileDocument,
} from './schemas/financial-partner-profile.schema';
import {
  TransporterProfile,
  TransporterProfileDocument,
} from './schemas/transporter-profile.schema';
import { User, UserDocument } from './schemas/user.schema';

type ProfileField = keyof UpdateProfileDto;

const COMMON_FIELDS: ProfileField[] = ['fullName', 'phone'];

/** Fields that live on the role's own profile document. */
const ROLE_FIELDS: Partial<Record<UserRole, ProfileField[]>> = {
  [UserRole.Buyer]: ['businessName', 'businessType'],
  [UserRole.Farmer]: ['farmName', 'cropTypes', 'landSizeAcres'],
  [UserRole.Transporter]: ['vehicleType', 'vehicleNumber', 'serviceAreas'],
};

/** Hides all but the last 4 characters of an identity number. */
export function maskCnic(cnic: string | undefined): string | undefined {
  if (!cnic) return undefined;
  const digits = cnic.replace(/\D/g, '');
  if (digits.length < 4) return undefined;
  return `${'*'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
}

/**
 * Self-service profile: read, edit and avatar. Identity data (email, CNIC) is
 * never writable here, and role-specific fields are only accepted for the
 * caller's own role. The avatar is stored in Cloudinary; MongoDB keeps just its
 * delivery path.
 */
@Injectable()
export class AccountService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(FarmerProfile.name)
    private readonly farmerModel: Model<FarmerProfileDocument>,
    @InjectModel(BuyerProfile.name)
    private readonly buyerModel: Model<BuyerProfileDocument>,
    @InjectModel(TransporterProfile.name)
    private readonly transporterModel: Model<TransporterProfileDocument>,
    @InjectModel(FinancialPartnerProfile.name)
    private readonly financialModel: Model<FinancialPartnerProfileDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    private readonly storage: StorageService,
  ) {}

  async getProfile(userId: string): Promise<ProfileResponseDto> {
    const user = await this.loadUser(userId);
    return this.toResponse(user);
  }

  async updateProfile(
    actor: RequestUser,
    dto: UpdateProfileDto,
    ipAddress?: string,
  ): Promise<ProfileResponseDto> {
    const user = await this.loadUser(actor.id);
    const sent = (Object.keys(dto) as ProfileField[]).filter(
      (key) => dto[key] !== undefined && dto[key] !== null,
    );
    if (sent.length === 0) {
      throw new BadRequestException('Send at least one field to update');
    }

    const roleFields = ROLE_FIELDS[user.role] ?? [];
    const rejected = sent.filter(
      (key) => !COMMON_FIELDS.includes(key) && !roleFields.includes(key),
    );
    if (rejected.length > 0) {
      throw new BadRequestException(
        `${rejected.join(', ')} cannot be edited for the ${user.role} role`,
      );
    }

    const userSet: Record<string, unknown> = {};
    const profileSet: Record<string, unknown> = {};
    for (const key of sent) {
      if (COMMON_FIELDS.includes(key)) userSet[key] = dto[key];
      else profileSet[key] = dto[key];
    }

    if (Object.keys(userSet).length > 0) {
      await this.userModel.updateOne({ _id: user._id }, { $set: userSet });
    }
    if (Object.keys(profileSet).length > 0) {
      const matched = await this.updateRoleProfile(user, profileSet);
      if (!matched) {
        throw new BadRequestException('Profile not found for this account');
      }
    }

    // Field names only: values are personal data and stay out of audit logs.
    await this.audit(actor, 'profile.updated', user._id, ipAddress, {
      changedFields: sent,
    });
    return this.getProfile(actor.id);
  }

  async setAvatar(
    actor: RequestUser,
    file: Buffer | undefined,
    ipAddress?: string,
  ): Promise<ProfileResponseDto> {
    const user = await this.loadUser(actor.id);
    const path = await this.storage.uploadAvatar(
      file as Buffer,
      user._id.toString(),
    );
    const previous = user.avatarPath;
    await this.userModel.updateOne(
      { _id: user._id },
      { $set: { avatarPath: path } },
    );
    // A new Cloudinary version of the same public_id replaces the old asset;
    // only a changed path (local dev files) needs explicit cleanup.
    if (previous && previous !== path) void this.storage.deleteAvatar(previous);
    await this.audit(actor, 'profile.avatar_set', user._id, ipAddress, {
      changedFields: ['avatar'],
    });
    return this.getProfile(actor.id);
  }

  async removeAvatar(
    actor: RequestUser,
    ipAddress?: string,
  ): Promise<ProfileResponseDto> {
    const user = await this.loadUser(actor.id);
    if (user.avatarPath) {
      const previous = user.avatarPath;
      await this.userModel.updateOne(
        { _id: user._id },
        { $unset: { avatarPath: 1 } },
      );
      await this.storage.deleteAvatar(previous);
      await this.audit(actor, 'profile.avatar_removed', user._id, ipAddress, {
        changedFields: ['avatar'],
      });
    }
    return this.getProfile(actor.id);
  }

  // ---------------------------------------------------------------------------

  private async loadUser(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new UnauthorizedException('Account no longer exists');
    return user;
  }

  /** Applies role-profile fields; false when the role has no profile document. */
  private async updateRoleProfile(
    user: UserDocument,
    set: Record<string, unknown>,
  ): Promise<boolean> {
    const filter = { userId: user._id };
    switch (user.role) {
      case UserRole.Buyer:
        return (
          (await this.buyerModel.updateOne(filter, { $set: set }))
            .matchedCount > 0
        );
      case UserRole.Farmer:
        return (
          (await this.farmerModel.updateOne(filter, { $set: set }))
            .matchedCount > 0
        );
      case UserRole.Transporter:
        return (
          (await this.transporterModel.updateOne(filter, { $set: set }))
            .matchedCount > 0
        );
      default:
        return false;
    }
  }

  private async toResponse(user: UserDocument): Promise<ProfileResponseDto> {
    const profile = await this.loadProfile(user);
    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        phone: user.phone,
        fullName: user.fullName,
        avatarUrl: avatarUrl(user.avatarPath),
        isVerified: user.isVerified,
        isActive: user.isActive,
      },
      displayName: this.displayName(user, profile),
      profile,
    };
  }

  private displayName(user: UserDocument, profile: ProfileDetailsDto): string {
    return (
      user.fullName?.trim() ||
      profile.businessName ||
      profile.farmName ||
      profile.institutionName ||
      user.email.split('@')[0]
    );
  }

  private async loadProfile(user: UserDocument): Promise<ProfileDetailsDto> {
    const userId = new Types.ObjectId(user._id.toString());
    switch (user.role) {
      case UserRole.Buyer: {
        const p = await this.buyerModel
          .findOne({ userId })
          .select('+cnic')
          .lean()
          .exec();
        return {
          kind: user.role,
          cnicMasked: maskCnic(p?.cnic),
          businessName: p?.businessName,
          businessType: p?.businessType,
        };
      }
      case UserRole.Farmer: {
        const p = await this.farmerModel
          .findOne({ userId })
          .select('+cnic')
          .lean()
          .exec();
        const loc = p?.farmLocation;
        const address = loc?.address?.trim() || undefined;
        const city = loc?.city?.trim() || undefined;
        const province = loc?.province?.trim() || undefined;
        const pinned = hasCoordinates(loc);
        return {
          kind: user.role,
          cnicMasked: maskCnic(p?.cnic),
          farmName: p?.farmName,
          cropTypes: p?.cropTypes ?? [],
          landSizeAcres: p?.landSizeAcres,
          farmLocation: {
            address,
            city,
            province,
            ...(pinned ? { lat: loc.lat, lng: loc.lng } : {}),
            complete: Boolean(address && city && province && pinned),
          },
        };
      }
      case UserRole.Transporter: {
        const p = await this.transporterModel
          .findOne({ userId })
          .select('+cnic')
          .lean()
          .exec();
        return {
          kind: user.role,
          cnicMasked: maskCnic(p?.cnic),
          vehicleType: p?.vehicleType,
          vehicleNumber: p?.vehicleNumber,
          serviceAreas: p?.serviceAreas ?? [],
        };
      }
      case UserRole.FinancialPartner: {
        const p = await this.financialModel
          .findOne({ userId })
          .select('+cnic')
          .lean()
          .exec();
        return {
          kind: user.role,
          cnicMasked: maskCnic(p?.cnic),
          institutionName: p?.institutionName,
          institutionType: p?.institutionType,
        };
      }
      default:
        return { kind: user.role };
    }
  }

  private async audit(
    actor: RequestUser,
    action: string,
    targetId: Types.ObjectId,
    ipAddress: string | undefined,
    after: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogModel.create({
      actorId: new Types.ObjectId(actor.id),
      actorRole: actor.role,
      action,
      targetEntity: 'User',
      targetId,
      metadata: { after },
      ipAddress,
    });
  }
}
