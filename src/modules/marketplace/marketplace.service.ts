import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  ProductStatus,
  ProductUnit,
  QualityGrade,
} from './schemas/product.schema';
import {
  CreateProductDto,
  ProductListResponseDto,
  ProductQrResponseDto,
  ProductResponseDto,
  QueryProductDto,
  UpdateProductDto,
} from './dto';

/**
 * MarketplaceService (EP-02).
 *
 * NOTE: every method currently returns DTO-shaped MOCK data so the mobile/web
 * teams can integrate against the documented contract. Real Mongoose-backed
 * listings, search, filtering and QR generation land in Sprint 2.
 */
@Injectable()
export class MarketplaceService {
  create(farmerId: string, dto: CreateProductDto): ProductResponseDto {
    const id = new Types.ObjectId().toHexString();
    return this.sampleProduct({
      id,
      farmerId,
      name: dto.name,
      category: dto.category,
      description: dto.description,
      price: dto.price,
      quantity: dto.quantity,
      unit: dto.unit,
      images: dto.images ?? [],
      qualityGrade: dto.qualityGrade,
      qrCode: this.buildQrUrl(id),
      status: ProductStatus.Active,
    });
  }

  findAll(query: QueryProductDto): ProductListResponseDto {
    return this.paginate(query, this.sampleCatalog());
  }

  findMine(farmerId: string, query: QueryProductDto): ProductListResponseDto {
    const owned = this.sampleCatalog().map((p) => ({ ...p, farmerId }));
    return this.paginate(query, owned);
  }

  findOne(id: string): ProductResponseDto {
    return this.sampleProduct({ id, qrCode: this.buildQrUrl(id) });
  }

  update(
    id: string,
    _farmerId: string,
    dto: UpdateProductDto,
  ): ProductResponseDto {
    return this.sampleProduct({
      id,
      qrCode: this.buildQrUrl(id),
      ...dto,
      updatedAt: new Date().toISOString(),
    });
  }

  remove(id: string, _farmerId: string): { id: string; deleted: boolean } {
    return { id, deleted: true };
  }

  getQr(id: string): ProductQrResponseDto {
    return {
      productId: id,
      qrCode: this.buildQrUrl(id),
      qrImageDataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAMOCK',
    };
  }

  // --- mock helpers ----------------------------------------------------------

  private buildQrUrl(id: string): string {
    return `https://farm2fork.com/trace/${id}`;
  }

  private paginate(
    query: QueryProductDto,
    catalog: ProductResponseDto[],
  ): ProductListResponseDto {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const total = 42; // mock total
    return {
      data: catalog.slice(0, limit),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private sampleCatalog(): ProductResponseDto[] {
    return [
      this.sampleProduct({
        name: 'Roma Tomatoes',
        category: 'vegetables',
        price: 120,
        unit: ProductUnit.Kg,
        qualityGrade: QualityGrade.A,
      }),
      this.sampleProduct({
        id: '6a2fe77bb77795516febc288',
        name: 'Basmati Rice',
        category: 'grains',
        price: 380,
        unit: ProductUnit.Kg,
        qualityGrade: QualityGrade.B,
      }),
    ];
  }

  private sampleProduct(
    overrides: Partial<ProductResponseDto> = {},
  ): ProductResponseDto {
    const now = new Date().toISOString();
    const base: ProductResponseDto = {
      id: '6a2fe77bb77795516febc287',
      farmerId: '6a2fe77bb77795516febc111',
      name: 'Roma Tomatoes',
      category: 'vegetables',
      description: 'Fresh sun-ripened Roma tomatoes',
      price: 120,
      quantity: 500,
      unit: ProductUnit.Kg,
      images: ['https://cdn.farm2fork.com/products/tomatoes-1.jpg'],
      qualityGrade: QualityGrade.A,
      qrCode: 'https://farm2fork.com/trace/6a2fe77bb77795516febc287',
      initialBlockchainRecordId: '6a2fe77bb77795516febc999',
      status: ProductStatus.Active,
      createdAt: now,
      updatedAt: now,
    };
    return { ...base, ...overrides };
  }
}
