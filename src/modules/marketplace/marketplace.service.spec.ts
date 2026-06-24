import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { MarketplaceService } from './marketplace.service';
import {
  Product,
  ProductStatus,
  ProductUnit,
  QualityGrade,
} from './schemas/product.schema';
import { ProductSortBy, SortOrder } from './dto';

/**
 * Builds a fake ProductDocument-like object the service can map/mutate.
 */
function fakeProduct(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-06-15T11:52:27.282Z');
  const doc = {
    id: '6a2fe77bb77795516febc287',
    farmerId: new Types.ObjectId('6a2fe77bb77795516febc111'),
    name: 'Roma Tomatoes',
    category: 'vegetables',
    description: 'Fresh',
    price: 120,
    quantity: 500,
    unit: ProductUnit.Kg,
    images: [] as string[],
    qualityGrade: QualityGrade.A,
    qrCode: 'https://farm2fork.com/trace/6a2fe77bb77795516febc287',
    initialBlockchainRecordId: undefined,
    status: ProductStatus.Active,
    createdAt: now,
    updatedAt: now,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return doc;
}

describe('MarketplaceService', () => {
  let service: MarketplaceService;
  let model: {
    create: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
    countDocuments: jest.Mock;
  };

  const FARMER = '6a2fe77bb77795516febc111';
  const OTHER_FARMER = '6a2fe77bb77795516febc222';

  beforeEach(async () => {
    model = {
      create: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      countDocuments: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketplaceService,
        { provide: getModelToken(Product.name), useValue: model },
      ],
    }).compile();

    service = moduleRef.get(MarketplaceService);
  });

  describe('create', () => {
    it('persists a product with an active status and a trace QR derived from the new id', async () => {
      model.create.mockImplementation((doc: Record<string, unknown>) =>
        Promise.resolve(fakeProduct(doc)),
      );

      const result = await service.create(FARMER, {
        name: 'Mangoes',
        category: 'fruits',
        price: 300,
        quantity: 100,
        unit: ProductUnit.Kg,
      });

      const created = model.create.mock.calls[0][0] as Record<string, unknown>;
      expect(created.status).toBe(ProductStatus.Active);
      expect(created.farmerId).toBeInstanceOf(Types.ObjectId);
      expect(created.qrCode).toBe(
        `https://farm2fork.com/trace/${(created._id as Types.ObjectId).toHexString()}`,
      );
      expect(result.name).toBe('Mangoes');
      expect(result.farmerId).toBe(FARMER);
    });
  });

  describe('findAll', () => {
    it('builds an escaped case-insensitive search filter and paginates', async () => {
      const chain = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([fakeProduct()]),
      };
      model.find.mockReturnValue(chain);
      model.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      });

      const result = await service.findAll({
        page: 2,
        limit: 5,
        search: 'a.b*c',
        minPrice: 50,
        maxPrice: 500,
        sortBy: ProductSortBy.Price,
        sortOrder: SortOrder.Asc,
      });

      const filter = model.find.mock.calls[0][0] as {
        name: { $regex: string; $options: string };
        price: { $gte: number; $lte: number };
      };
      expect(filter.name.$regex).toBe('a\\.b\\*c');
      expect(filter.name.$options).toBe('i');
      expect(filter.price).toEqual({ $gte: 50, $lte: 500 });
      expect(chain.sort).toHaveBeenCalledWith({ price: 1 });
      expect(chain.skip).toHaveBeenCalledWith(5); // (page 2 - 1) * limit 5
      expect(chain.limit).toHaveBeenCalledWith(5);
      expect(result.total).toBe(1);
      expect(result.page).toBe(2);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('findOne', () => {
    it('throws NotFound for an invalid id', async () => {
      await expect(service.findOne('not-an-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFound when the product does not exist', async () => {
      model.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });
      await expect(
        service.findOne('6a2fe77bb77795516febc287'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('rejects updates from a farmer who does not own the listing', async () => {
      model.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(fakeProduct()),
      });
      await expect(
        service.update('6a2fe77bb77795516febc287', OTHER_FARMER, {
          price: 999,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('applies only provided fields and saves', async () => {
      const product = fakeProduct();
      model.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(product),
      });

      const result = await service.update('6a2fe77bb77795516febc287', FARMER, {
        price: 150,
        status: ProductStatus.SoldOut,
      });

      expect(product.save).toHaveBeenCalled();
      expect(product.price).toBe(150);
      expect(product.status).toBe(ProductStatus.SoldOut);
      expect(product.name).toBe('Roma Tomatoes'); // untouched
      expect(result.price).toBe(150);
    });
  });

  describe('remove', () => {
    it('soft-deletes by deactivating the listing (preserving traceability)', async () => {
      const product = fakeProduct();
      model.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(product),
      });

      const result = await service.remove('6a2fe77bb77795516febc287', FARMER);

      expect(product.status).toBe(ProductStatus.Inactive);
      expect(product.save).toHaveBeenCalled();
      expect(result).toEqual({
        id: '6a2fe77bb77795516febc287',
        deleted: true,
      });
    });
  });

  describe('getQr', () => {
    it('returns the trace url and a rendered png data uri', async () => {
      model.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(fakeProduct()),
      });

      const result = await service.getQr('6a2fe77bb77795516febc287');

      expect(result.qrCode).toBe(
        'https://farm2fork.com/trace/6a2fe77bb77795516febc287',
      );
      expect(result.qrImageDataUri).toMatch(/^data:image\/png;base64,/);
    });
  });
});
