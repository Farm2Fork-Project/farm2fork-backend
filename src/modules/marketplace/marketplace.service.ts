import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  Connection,
  FilterQuery,
  Model,
  SortOrder as MongooseSortOrder,
  Types,
} from 'mongoose';
import * as QRCode from 'qrcode';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  FarmerProfile,
  FarmerProfileDocument,
} from '../auth/schemas/farmer-profile.schema';
import {
  BlockchainReferenceModel,
  BlockchainTransaction,
  BlockchainTransactionDocument,
  BlockchainTxStatus,
  BlockchainTxType,
} from '../blockchain/schemas/blockchain-transaction.schema';
import {
  Product,
  ProductDocument,
  ProductStatus,
} from './schemas/product.schema';
import {
  OriginLedgerStatus,
  ProductFarmerSummaryDto,
} from './dto/product-response.dto';
import {
  CreateProductDto,
  ProductListResponseDto,
  ProductQrResponseDto,
  ProductResponseDto,
  ProductSortBy,
  QueryProductDto,
  SortOrder,
  UpdateProductDto,
} from './dto';

/**
 * MarketplaceService (EP-02).
 *
 * Real Mongoose-backed listing, search, filtering, ownership enforcement and
 * traceability QR generation against the products collection (master context
 * 5.6). The first blockchain traceability record is referenced via
 * initialBlockchainRecordId - the retired name blockchainTxId is never used.
 *
 * Creating a listing also enqueues its `listed` supply-chain event in the
 * blockchain outbox (master context 6.4) in the same transaction, so a
 * product never exists without the first link of its provenance chain.
 */
export const LISTED_EVENT = 'listed';
export const UNKNOWN_LOCATION = 'Location not provided';
const DEFAULT_TRACE_ORIGIN = 'https://farm2fork.com';

/**
 * Public trace URL encoded in every product QR. Points at the web app's
 * public /trace/:id page (PUBLIC_TRACE_ORIGIN, falling back to
 * WEB_APP_ORIGIN) so a phone camera scan opens a real page, and the mobile
 * scanner can extract the product id from the last path segment.
 */
export function buildProductTraceUrl(
  config: ConfigService,
  productId: string,
): string {
  const origin =
    config.get<string>('PUBLIC_TRACE_ORIGIN') ||
    config.get<string>('WEB_APP_ORIGIN') ||
    DEFAULT_TRACE_ORIGIN;
  return `${origin.replace(/\/+$/, '')}/trace/${productId}`;
}

@Injectable()
export class MarketplaceService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(BlockchainTransaction.name)
    private readonly blockchainModel: Model<BlockchainTransactionDocument>,
    @InjectModel(FarmerProfile.name)
    private readonly farmerProfileModel: Model<FarmerProfileDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly config: ConfigService,
  ) {}

  async create(
    farmerId: string,
    dto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    // Pre-allocate the id so the QR trace URL can embed it before persistence.
    const id = new Types.ObjectId();
    const farmerObjectId = new Types.ObjectId(farmerId);
    const location = await this.farmLocationLabel(farmerObjectId);
    const listedAt = new Date();

    const session = await this.connection.startSession();
    try {
      const created = await session.withTransaction(async () => {
        const [listedEvent] = await this.blockchainModel.create(
          [
            {
              type: BlockchainTxType.SupplyChainEvent,
              referenceId: id,
              referenceModel: BlockchainReferenceModel.Product,
              payload: {
                payment: null,
                supplyChain: {
                  productId: id,
                  farmerId: farmerObjectId,
                  eventType: LISTED_EVENT,
                  location,
                  actorId: farmerObjectId,
                  actorRole: UserRole.Farmer,
                  timestamp: listedAt,
                },
              },
              status: BlockchainTxStatus.Pending,
            },
          ],
          { session },
        );
        const [product] = await this.productModel.create(
          [
            {
              _id: id,
              farmerId: farmerObjectId,
              name: dto.name,
              category: dto.category,
              description: dto.description,
              price: dto.price,
              quantity: dto.quantity,
              unit: dto.unit,
              images: dto.images ?? [],
              qualityGrade: dto.qualityGrade,
              qrCode: this.buildTraceUrl(id.toHexString()),
              initialBlockchainRecordId: listedEvent._id,
              status: ProductStatus.Active,
            },
          ],
          { session },
        );
        return product;
      });
      return (await this.toResponses([created]))[0];
    } finally {
      await session.endSession();
    }
  }

  /**
   * Public marketplace browse. Deactivated (soft-deleted) listings are never
   * returned here, whatever status filter is requested - farmers still see
   * their own through findMine.
   */
  async findAll(query: QueryProductDto): Promise<ProductListResponseDto> {
    const filter = this.buildFilter(query);
    if (!query.status || query.status === ProductStatus.Inactive) {
      filter.status = { $ne: ProductStatus.Inactive };
    }
    return this.search(query, filter);
  }

  async findMine(
    farmerId: string,
    query: QueryProductDto,
  ): Promise<ProductListResponseDto> {
    const filter = this.buildFilter(query);
    filter.farmerId = new Types.ObjectId(farmerId);
    return this.search(query, filter);
  }

  async findOne(id: string): Promise<ProductResponseDto> {
    return (await this.toResponses([await this.getOwnedOrAny(id)]))[0];
  }

  async update(
    id: string,
    farmerId: string,
    dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    const product = await this.getOwned(id, farmerId);
    if (dto.name !== undefined) product.name = dto.name;
    if (dto.category !== undefined) product.category = dto.category;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.price !== undefined) product.price = dto.price;
    if (dto.quantity !== undefined) product.quantity = dto.quantity;
    if (dto.unit !== undefined) product.unit = dto.unit;
    if (dto.images !== undefined) product.images = dto.images;
    if (dto.qualityGrade !== undefined) product.qualityGrade = dto.qualityGrade;
    if (dto.status !== undefined) product.status = dto.status;
    await product.save();
    return (await this.toResponses([product]))[0];
  }

  async remove(
    id: string,
    farmerId: string,
  ): Promise<{ id: string; deleted: boolean }> {
    const product = await this.getOwned(id, farmerId);
    // Soft delete: deactivate the listing so traceability/blockchain linkage and
    // historical order snapshots are preserved.
    product.status = ProductStatus.Inactive;
    await product.save();
    return { id, deleted: true };
  }

  async getQr(id: string): Promise<ProductQrResponseDto> {
    const product = await this.getOwnedOrAny(id);
    // Always derive from current config so listings created before the trace
    // origin was configured still produce a scannable, resolvable QR.
    const qrCode = this.buildTraceUrl(product.id as string);
    const qrImageDataUri = await QRCode.toDataURL(qrCode, {
      errorCorrectionLevel: 'M',
      margin: 1,
    });
    return { productId: product.id as string, qrCode, qrImageDataUri };
  }

  // --- internals -------------------------------------------------------------

  private buildTraceUrl(id: string): string {
    return buildProductTraceUrl(this.config, id);
  }

  /**
   * City-level provenance label for the ledger. The chaincode requires a
   * non-empty location; when the farmer never provided one we record that
   * honestly rather than inventing a place.
   */
  private async farmLocationLabel(farmerId: Types.ObjectId): Promise<string> {
    const profile = await this.farmerProfileModel
      .findOne({ userId: farmerId })
      .select('farmLocation')
      .lean()
      .exec();
    const place = [profile?.farmLocation?.city, profile?.farmLocation?.province]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(', ');
    return place || UNKNOWN_LOCATION;
  }

  private buildFilter(query: QueryProductDto): FilterQuery<ProductDocument> {
    const filter: FilterQuery<ProductDocument> = {};

    if (query.search) {
      // Escape user input before using it in a RegExp to avoid ReDoS / injection.
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.name = { $regex: escaped, $options: 'i' };
    }
    if (query.category) filter.category = query.category;
    if (query.unit) filter.unit = query.unit;
    if (query.qualityGrade) filter.qualityGrade = query.qualityGrade;
    if (query.status) filter.status = query.status;
    if (query.farmerId && Types.ObjectId.isValid(query.farmerId)) {
      filter.farmerId = new Types.ObjectId(query.farmerId);
    }
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const priceRange: { $gte?: number; $lte?: number } = {};
      if (query.minPrice !== undefined) priceRange.$gte = query.minPrice;
      if (query.maxPrice !== undefined) priceRange.$lte = query.maxPrice;
      filter.price = priceRange;
    }
    return filter;
  }

  private async search(
    query: QueryProductDto,
    filter: FilterQuery<ProductDocument>,
  ): Promise<ProductListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const sortField = query.sortBy ?? ProductSortBy.CreatedAt;
    const sortDir: MongooseSortOrder =
      (query.sortOrder ?? SortOrder.Desc) === SortOrder.Asc ? 1 : -1;

    const [items, total] = await Promise.all([
      this.productModel
        .find(filter)
        .sort({ [sortField]: sortDir })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.productModel.countDocuments(filter).exec(),
    ]);

    return {
      data: await this.toResponses(items),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  /** Loads a product the farmer owns, or throws 404/403. */
  private async getOwned(
    id: string,
    farmerId: string,
  ): Promise<ProductDocument> {
    const product = await this.getOwnedOrAny(id);
    if (product.farmerId.toHexString() !== farmerId) {
      throw new ForbiddenException('You do not own this listing');
    }
    return product;
  }

  /** Loads any product by id, or throws 404. */
  private async getOwnedOrAny(id: string): Promise<ProductDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Product not found');
    }
    const product = await this.productModel.findById(id).exec();
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  /**
   * Maps products to responses, attaching each one's public farm identity
   * and origin ledger state with two batched lookups per page (no N+1).
   */
  private async toResponses(
    products: ProductDocument[],
  ): Promise<ProductResponseDto[]> {
    if (products.length === 0) return [];
    const farmerIds = [
      ...new Map(
        products.map((p) => [p.farmerId.toHexString(), p.farmerId]),
      ).values(),
    ];
    const recordIds = products
      .map((p) => p.initialBlockchainRecordId)
      .filter((id): id is Types.ObjectId => Boolean(id));

    const [profiles, records] = await Promise.all([
      this.farmerProfileModel
        .find({ userId: { $in: farmerIds } })
        .select('userId farmName farmLocation.city farmLocation.province')
        .lean()
        .exec(),
      recordIds.length === 0
        ? Promise.resolve([])
        : this.blockchainModel
            .find({ _id: { $in: recordIds } })
            .select('status')
            .lean()
            .exec(),
    ]);

    const farmers = new Map<string, ProductFarmerSummaryDto>();
    for (const profile of profiles) {
      if (!profile.farmName) continue;
      farmers.set(profile.userId.toHexString(), {
        farmName: profile.farmName,
        city: profile.farmLocation?.city || undefined,
        province: profile.farmLocation?.province || undefined,
      });
    }
    const ledger = new Map<string, OriginLedgerStatus>();
    for (const record of records) {
      ledger.set(
        record._id.toHexString(),
        record.status === BlockchainTxStatus.Confirmed
          ? OriginLedgerStatus.Confirmed
          : record.status === BlockchainTxStatus.Failed
            ? OriginLedgerStatus.Failed
            : OriginLedgerStatus.Pending,
      );
    }

    return products.map((product) => ({
      ...this.toResponse(product),
      farmer: farmers.get(product.farmerId.toHexString()) ?? null,
      originLedgerStatus: product.initialBlockchainRecordId
        ? (ledger.get(product.initialBlockchainRecordId.toHexString()) ??
          OriginLedgerStatus.Pending)
        : OriginLedgerStatus.Missing,
    }));
  }

  private toResponse(
    product: ProductDocument,
  ): Omit<ProductResponseDto, 'farmer' | 'originLedgerStatus'> {
    return {
      id: product.id as string,
      farmerId: product.farmerId.toHexString(),
      name: product.name,
      category: product.category,
      description: product.description,
      price: product.price,
      quantity: product.quantity,
      unit: product.unit,
      images: product.images,
      qualityGrade: product.qualityGrade,
      qrCode: product.qrCode,
      initialBlockchainRecordId:
        product.initialBlockchainRecordId?.toHexString(),
      status: product.status,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
    };
  }
}
