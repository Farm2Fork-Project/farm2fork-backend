import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  FilterQuery,
  Model,
  SortOrder as MongooseSortOrder,
  Types,
} from 'mongoose';
import * as QRCode from 'qrcode';
import {
  Product,
  ProductDocument,
  ProductStatus,
} from './schemas/product.schema';
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
 */
@Injectable()
export class MarketplaceService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  async create(
    farmerId: string,
    dto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    // Pre-allocate the id so the QR trace URL can embed it before persistence.
    const id = new Types.ObjectId();
    const created = await this.productModel.create({
      _id: id,
      farmerId: new Types.ObjectId(farmerId),
      name: dto.name,
      category: dto.category,
      description: dto.description,
      price: dto.price,
      quantity: dto.quantity,
      unit: dto.unit,
      images: dto.images ?? [],
      qualityGrade: dto.qualityGrade,
      qrCode: this.buildTraceUrl(id.toHexString()),
      status: ProductStatus.Active,
    });
    return this.toResponse(created);
  }

  async findAll(query: QueryProductDto): Promise<ProductListResponseDto> {
    return this.search(query, this.buildFilter(query));
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
    return this.toResponse(await this.getOwnedOrAny(id));
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
    return this.toResponse(product);
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
    const qrCode = product.qrCode ?? this.buildTraceUrl(product.id as string);
    const qrImageDataUri = await QRCode.toDataURL(qrCode, {
      errorCorrectionLevel: 'M',
      margin: 1,
    });
    return { productId: product.id as string, qrCode, qrImageDataUri };
  }

  // --- internals -------------------------------------------------------------

  private buildTraceUrl(id: string): string {
    return `https://farm2fork.com/trace/${id}`;
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
      data: items.map((p) => this.toResponse(p)),
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

  private toResponse(product: ProductDocument): ProductResponseDto {
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
