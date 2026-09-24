import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { FarmerProfile } from '../auth/schemas/farmer-profile.schema';
import {
  BlockchainReferenceModel,
  BlockchainTransaction,
  BlockchainTxStatus,
  BlockchainTxType,
} from '../blockchain/schemas/blockchain-transaction.schema';
import { MarketplaceService, UNKNOWN_LOCATION } from './marketplace.service';
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

interface QueuedEvent {
  type: string;
  referenceId: Types.ObjectId;
  referenceModel: string;
  status: string;
  payload: {
    payment: null;
    supplyChain: {
      productId: Types.ObjectId;
      actorId: Types.ObjectId;
      eventType: string;
      actorRole: string;
      location: string;
    };
  };
}

describe('MarketplaceService', () => {
  let service: MarketplaceService;
  let model: {
    create: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
    countDocuments: jest.Mock;
  };
  let blockchainModel: { create: jest.Mock };
  let farmerProfileModel: { findOne: jest.Mock };
  let session: { withTransaction: jest.Mock; endSession: jest.Mock };
  let configValues: Record<string, string | undefined>;

  function farmerProfileReturns(profile: unknown) {
    farmerProfileModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(profile),
    });
  }

  const FARMER = '6a2fe77bb77795516febc111';
  const OTHER_FARMER = '6a2fe77bb77795516febc222';

  beforeEach(async () => {
    model = {
      create: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      countDocuments: jest.fn(),
    };
    blockchainModel = {
      create: jest.fn((docs: Record<string, unknown>[]) =>
        Promise.resolve(
          docs.map((doc) => ({ ...doc, _id: new Types.ObjectId() })),
        ),
      ),
    };
    farmerProfileModel = { findOne: jest.fn() };
    farmerProfileReturns({
      farmLocation: { city: 'Multan', province: 'Punjab' },
    });
    session = {
      withTransaction: jest.fn((work: () => Promise<unknown>) => work()),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    configValues = {};

    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketplaceService,
        { provide: getModelToken(Product.name), useValue: model },
        {
          provide: getModelToken(BlockchainTransaction.name),
          useValue: blockchainModel,
        },
        {
          provide: getModelToken(FarmerProfile.name),
          useValue: farmerProfileModel,
        },
        {
          provide: getConnectionToken(),
          useValue: { startSession: jest.fn().mockResolvedValue(session) },
        },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => configValues[key] },
        },
      ],
    }).compile();

    service = moduleRef.get(MarketplaceService);
  });

  describe('create', () => {
    beforeEach(() => {
      model.create.mockImplementation((docs: Record<string, unknown>[]) =>
        Promise.resolve([fakeProduct(docs[0])]),
      );
    });

    it('persists a product with an active status and a trace QR derived from the new id', async () => {
      const result = await service.create(FARMER, {
        name: 'Mangoes',
        category: 'fruits',
        price: 300,
        quantity: 100,
        unit: ProductUnit.Kg,
      });

      const created = model.create.mock.calls[0][0][0] as Record<
        string,
        unknown
      >;
      expect(created.status).toBe(ProductStatus.Active);
      expect(created.farmerId).toBeInstanceOf(Types.ObjectId);
      expect(created.qrCode).toBe(
        `https://farm2fork.com/trace/${(created._id as Types.ObjectId).toHexString()}`,
      );
      expect(result.name).toBe('Mangoes');
      expect(result.farmerId).toBe(FARMER);
      expect(session.endSession).toHaveBeenCalled();
    });

    it('enqueues the listed provenance event in the same transaction and links it', async () => {
      await service.create(FARMER, {
        name: 'Mangoes',
        category: 'fruits',
        price: 300,
        quantity: 100,
        unit: ProductUnit.Kg,
      });

      expect(session.withTransaction).toHaveBeenCalledTimes(1);
      const [events, eventOptions] = blockchainModel.create.mock.calls[0] as [
        QueuedEvent[],
        { session: unknown },
      ];
      const [, productOptions] = model.create.mock.calls[0] as [
        unknown,
        { session: unknown },
      ];
      expect(eventOptions.session).toBe(session);
      expect(productOptions.session).toBe(session);

      const event = events[0];
      const product = model.create.mock.calls[0][0][0] as Record<
        string,
        unknown
      >;
      expect(event.type).toBe(BlockchainTxType.SupplyChainEvent);
      expect(event.referenceModel).toBe(BlockchainReferenceModel.Product);
      expect(event.status).toBe(BlockchainTxStatus.Pending);
      expect(event.referenceId).toEqual(product._id);
      expect(event.payload.payment).toBeNull();
      expect(event.payload.supplyChain).toMatchObject({
        eventType: 'listed',
        actorRole: 'farmer',
        location: 'Multan, Punjab',
      });
      expect(event.payload.supplyChain.productId).toEqual(product._id);
      expect(event.payload.supplyChain.actorId.toHexString()).toBe(FARMER);
      expect(product.initialBlockchainRecordId).toBeInstanceOf(Types.ObjectId);
    });

    it('records an honest placeholder when the farmer has no farm location', async () => {
      farmerProfileReturns(null);

      await service.create(FARMER, {
        name: 'Wheat',
        category: 'grains',
        price: 90,
        quantity: 1000,
        unit: ProductUnit.Kg,
      });

      const event = blockchainModel.create.mock.calls[0][0][0] as QueuedEvent;
      expect(event.payload.supplyChain.location).toBe(UNKNOWN_LOCATION);
    });

    it('uses the configured public trace origin for the QR url', async () => {
      configValues.PUBLIC_TRACE_ORIGIN = 'http://localhost:3001/';

      await service.create(FARMER, {
        name: 'Rice',
        category: 'grains',
        price: 200,
        quantity: 50,
        unit: ProductUnit.Kg,
      });

      const created = model.create.mock.calls[0][0][0] as Record<
        string,
        unknown
      >;
      expect(created.qrCode).toBe(
        `http://localhost:3001/trace/${(created._id as Types.ObjectId).toHexString()}`,
      );
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

    it('never returns deactivated listings to the public browse', async () => {
      const chain = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      model.find.mockReturnValue(chain);
      model.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      });

      await service.findAll({});
      await service.findAll({ status: ProductStatus.Inactive });
      await service.findAll({ status: ProductStatus.SoldOut });

      expect(model.find.mock.calls[0][0].status).toEqual({
        $ne: ProductStatus.Inactive,
      });
      expect(model.find.mock.calls[1][0].status).toEqual({
        $ne: ProductStatus.Inactive,
      });
      expect(model.find.mock.calls[2][0].status).toBe(ProductStatus.SoldOut);
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
