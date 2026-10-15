import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { avatarUrl } from '../../infrastructure/storage/avatar';
import {
  FarmerProfile,
  FarmerProfileDocument,
} from '../auth/schemas/farmer-profile.schema';
import { User, UserDocument } from '../auth/schemas/user.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
} from '../order/schemas/order.schema';
import { FarmProfileResponseDto } from './dto';
import {
  Product,
  ProductDocument,
  ProductStatus,
} from './schemas/product.schema';

/**
 * Public farm identity for product pages: the farm, the person behind it and
 * a few honest counts. Never exposes CNIC, contact details, bank details, the
 * street address or the exact map pin.
 */
@Injectable()
export class FarmProfileService {
  constructor(
    @InjectModel(FarmerProfile.name)
    private readonly farmerProfileModel: Model<FarmerProfileDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
  ) {}

  async getPublicProfile(farmerId: string): Promise<FarmProfileResponseDto> {
    if (!Types.ObjectId.isValid(farmerId)) {
      throw new NotFoundException('Farm not found');
    }
    const userId = new Types.ObjectId(farmerId);

    const [profile, user, activeListings, completedOrders] = await Promise.all([
      this.farmerProfileModel
        .findOne({ userId })
        .select(
          'farmName farmLocation.city farmLocation.province cropTypes landSizeAcres certifications.name certifications.issuedBy certifications.issuedDate certifications.expiryDate createdAt',
        )
        .lean()
        .exec(),
      this.userModel
        .findOne({ _id: userId, role: UserRole.Farmer, isActive: true })
        .select('fullName avatarPath')
        .lean()
        .exec(),
      this.productModel
        .countDocuments({
          farmerId: userId,
          status: ProductStatus.Active,
          quantity: { $gt: 0 },
        })
        .exec(),
      this.orderModel
        .countDocuments({ farmerId: userId, status: OrderStatus.Delivered })
        .exec(),
    ]);
    if (!profile || !user) throw new NotFoundException('Farm not found');

    const now = Date.now();
    return {
      farmerId,
      farmName: profile.farmName,
      ownerName: user.fullName?.trim() || undefined,
      avatarUrl: avatarUrl(user.avatarPath),
      city: profile.farmLocation?.city?.trim() || undefined,
      province: profile.farmLocation?.province?.trim() || undefined,
      cropTypes: profile.cropTypes ?? [],
      landSizeAcres: profile.landSizeAcres || undefined,
      certifications: (profile.certifications ?? [])
        .filter((cert) => cert.name)
        .map((cert) => ({
          name: cert.name as string,
          issuedBy: cert.issuedBy || undefined,
          issuedDate: cert.issuedDate?.toISOString(),
          expiryDate: cert.expiryDate?.toISOString(),
          expired: Boolean(cert.expiryDate && cert.expiryDate.getTime() < now),
        })),
      memberSince: profile.createdAt.toISOString(),
      stats: { activeListings, completedOrders },
    };
  }
}
