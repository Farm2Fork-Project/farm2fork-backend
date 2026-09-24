import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { RequestUser } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/user-role.enum';
import { SystemConfigService } from '../admin/services/system-config.service';
import { FarmerProfile } from '../auth/schemas/farmer-profile.schema';
import { NotificationService } from '../notification/notification.service';
import { Product, ProductStatus } from '../marketplace/schemas/product.schema';
import { OrderService } from './order.service';
import { Order, OrderStatus } from './schemas/order.schema';

const FARMER_A = '6a2fe77bb77795516febc111';
const FARMER_B = '6a2fe77bb77795516febc222';
const BUYER = '6a2fe77bb77795516febc333';
const PROD_1 = '6a2fe77bb77795516febc287';
const PROD_2 = '6a2fe77bb77795516febc288';

function fakeProduct(opts: {
  id: string;
  farmerId: string;
  price?: number;
  quantity?: number;
  name?: string;
  status?: ProductStatus;
}) {
  return {
    _id: new Types.ObjectId(opts.id),
    id: opts.id,
    farmerId: new Types.ObjectId(opts.farmerId),
    name: opts.name ?? 'Roma Tomatoes',
    price: opts.price ?? 120,
    quantity: opts.quantity ?? 500,
    status: opts.status ?? ProductStatus.Active,
  };
}

const ADDRESS = {
  street: '12 Mall Road',
  city: 'Lahore',
  province: 'Punjab',
  zip: '54000',
  lat: 31,
  lng: 70,
};

// Exactly one degree of latitude south of the drop-off: 111.2 km apart.
const FARM_PIN = { lat: 30, lng: 70 };

describe('OrderService', () => {
  let service: OrderService;
  let orderModel: {
    create: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
    countDocuments: jest.Mock;
  };
  let productModel: { find: jest.Mock };
  let configService: {
    getPlatformFeePercent: jest.Mock;
    getDeliverySettings: jest.Mock;
  };
  let farmerProfileModel: { findOne: jest.Mock };
  let notifications: { notifyInBackground: jest.Mock };

  function farmPinIs(pin: { lat?: number; lng?: number } | null) {
    farmerProfileModel.findOne.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: jest
            .fn()
            .mockResolvedValue(
              pin ? { farmLocation: { city: 'Multan', ...pin } } : null,
            ),
        }),
      }),
    });
  }

  function findProductsReturns(products: unknown[]) {
    productModel.find.mockReturnValue({
      exec: jest.fn().mockResolvedValue(products),
    });
  }

  beforeEach(async () => {
    orderModel = {
      create: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      countDocuments: jest.fn(),
    };
    productModel = { find: jest.fn() };
    configService = {
      getPlatformFeePercent: jest.fn().mockResolvedValue(5),
      getDeliverySettings: jest.fn().mockResolvedValue({
        ...SystemConfigService.defaultDeliverySettings,
        baseFee: 100,
        feePerKm: 10,
        roadFactor: 1,
      }),
    };
    farmerProfileModel = { findOne: jest.fn() };
    farmPinIs(FARM_PIN);
    notifications = { notifyInBackground: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(Product.name), useValue: productModel },
        { provide: SystemConfigService, useValue: configService },
        {
          provide: getModelToken(FarmerProfile.name),
          useValue: farmerProfileModel,
        },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compile();

    service = moduleRef.get(OrderService);
    // Echo the created document back as a saved order for toResponse().
    orderModel.create.mockImplementation((doc: Record<string, unknown>) =>
      Promise.resolve({
        ...doc,
        _id: new Types.ObjectId('6a2fe77bb77795516febc500'),
        id: '6a2fe77bb77795516febc500',
        createdAt: new Date('2026-06-15T12:00:00.000Z'),
        updatedAt: new Date('2026-06-15T12:00:00.000Z'),
      }),
    );
  });

  describe('create — One-Order-One-Farmer (§6.1)', () => {
    it('rejects an order spanning two farmers with 400', async () => {
      findProductsReturns([
        fakeProduct({ id: PROD_1, farmerId: FARMER_A }),
        fakeProduct({ id: PROD_2, farmerId: FARMER_B }),
      ]);

      await expect(
        service.create(BUYER, {
          items: [
            { productId: PROD_1, quantity: 2 },
            { productId: PROD_2, quantity: 1 },
          ],
          shippingAddress: ADDRESS,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(orderModel.create).not.toHaveBeenCalled();
    });

    it('accepts a single-farmer order and sets order.farmerId', async () => {
      findProductsReturns([
        fakeProduct({ id: PROD_1, farmerId: FARMER_A, price: 120 }),
        fakeProduct({ id: PROD_2, farmerId: FARMER_A, price: 50 }),
      ]);

      const result = await service.create(BUYER, {
        items: [
          { productId: PROD_1, quantity: 2 },
          { productId: PROD_2, quantity: 4 },
        ],
        shippingAddress: ADDRESS,
      });

      expect(result.farmerId).toBe(FARMER_A);
      expect(result.items).toHaveLength(2);
    });
  });

  describe('create — price snapshot & fee (§6.2)', () => {
    it('snapshots unitPrice/name from the DB product, not the client', async () => {
      findProductsReturns([
        fakeProduct({
          id: PROD_1,
          farmerId: FARMER_A,
          price: 200,
          name: 'Mangoes',
        }),
      ]);

      const result = await service.create(BUYER, {
        items: [{ productId: PROD_1, quantity: 3 }],
        shippingAddress: ADDRESS,
      });

      expect(result.items[0].unitPrice).toBe(200);
      expect(result.items[0].productName).toBe('Mangoes');
      expect(result.items[0].subtotal).toBe(600);
      expect(result.totalAmount).toBe(600);
    });

    it('reads the platform fee from ConfigService and snapshots it', async () => {
      configService.getPlatformFeePercent.mockResolvedValue(8);
      findProductsReturns([
        fakeProduct({ id: PROD_1, farmerId: FARMER_A, price: 100 }),
      ]);

      const result = await service.create(BUYER, {
        items: [{ productId: PROD_1, quantity: 10 }],
        shippingAddress: ADDRESS,
      });

      expect(configService.getPlatformFeePercent).toHaveBeenCalled();
      expect(result.totalAmount).toBe(1000);
      expect(result.platformFeePercent).toBe(8);
      expect(result.platformFeeAmount).toBe(80);
      // 111.2 km x Rs 10 + Rs 100 base, rounded up to Rs 10.
      expect(result.deliveryFee).toBe(1220);
      expect(result.deliveryDistanceKm).toBe(111.2);
      expect(result.grandTotal).toBe(1000 + 80 + 1220);
    });
  });

  describe('delivery fee', () => {
    it('freezes the fee and the farm pin on the order and notifies both parties', async () => {
      findProductsReturns([
        fakeProduct({ id: PROD_1, farmerId: FARMER_A, price: 100 }),
      ]);
      await service.create(BUYER, {
        items: [{ productId: PROD_1, quantity: 1 }],
        shippingAddress: ADDRESS,
      });
      const saved = orderModel.create.mock.calls[0][0];
      expect(saved.deliveryFee).toBe(1220);
      expect(saved.pickupLocation).toEqual({
        type: 'Point',
        coordinates: [70, 30],
      });
      const recipients = notifications.notifyInBackground.mock.calls.map(
        ([input]: [{ userIds: unknown[] }]) => String(input.userIds[0]),
      );
      expect(recipients).toEqual([FARMER_A, BUYER]);
    });

    it('quotes exactly what create would charge, without saving', async () => {
      findProductsReturns([
        fakeProduct({ id: PROD_1, farmerId: FARMER_A, price: 100 }),
      ]);
      const quote = await service.quote({
        items: [{ productId: PROD_1, quantity: 10 }],
        shippingAddress: ADDRESS,
      });
      expect(quote).toEqual({
        totalAmount: 1000,
        platformFeePercent: 5,
        platformFeeAmount: 50,
        deliveryFee: 1220,
        deliveryDistanceKm: 111.2,
        grandTotal: 2270,
      });
      expect(orderModel.create).not.toHaveBeenCalled();
    });

    it("rejects checkout when the farm hasn't pinned its location", async () => {
      farmPinIs({});
      findProductsReturns([fakeProduct({ id: PROD_1, farmerId: FARMER_A })]);
      await expect(
        service.create(BUYER, {
          items: [{ productId: PROD_1, quantity: 1 }],
          shippingAddress: ADDRESS,
        }),
      ).rejects.toThrow("hasn't set its pickup location");
      expect(orderModel.create).not.toHaveBeenCalled();
    });
  });

  describe('create — validation', () => {
    it('rejects a missing product', async () => {
      findProductsReturns([]); // none found
      await expect(
        service.create(BUYER, {
          items: [{ productId: PROD_1, quantity: 1 }],
          shippingAddress: ADDRESS,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an inactive product', async () => {
      findProductsReturns([
        fakeProduct({
          id: PROD_1,
          farmerId: FARMER_A,
          status: ProductStatus.Inactive,
        }),
      ]);
      await expect(
        service.create(BUYER, {
          items: [{ productId: PROD_1, quantity: 1 }],
          shippingAddress: ADDRESS,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects insufficient stock', async () => {
      findProductsReturns([
        fakeProduct({ id: PROD_1, farmerId: FARMER_A, quantity: 3 }),
      ]);
      await expect(
        service.create(BUYER, {
          items: [{ productId: PROD_1, quantity: 10 }],
          shippingAddress: ADDRESS,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects duplicate product lines', async () => {
      await expect(
        service.create(BUYER, {
          items: [
            { productId: PROD_1, quantity: 1 },
            { productId: PROD_1, quantity: 2 },
          ],
          shippingAddress: ADDRESS,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findAll — role scoping', () => {
    function expectFilterFor(role: UserRole, id: string) {
      orderModel.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });
      orderModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      });
      return service
        .findAll({ id, role } as RequestUser, {})
        .then(
          () => orderModel.find.mock.calls[0][0] as Record<string, unknown>,
        );
    }

    it('scopes a buyer to their own buyerId', async () => {
      const filter = await expectFilterFor(UserRole.Buyer, BUYER);
      expect((filter.buyerId as Types.ObjectId).toHexString()).toBe(BUYER);
      expect(filter.farmerId).toBeUndefined();
    });

    it('scopes a farmer to their own farmerId', async () => {
      const filter = await expectFilterFor(UserRole.Farmer, FARMER_A);
      expect((filter.farmerId as Types.ObjectId).toHexString()).toBe(FARMER_A);
      expect(filter.buyerId).toBeUndefined();
    });

    it('does not constrain an admin by owner', async () => {
      const filter = await expectFilterFor(UserRole.Admin, 'admin-id');
      expect(filter.buyerId).toBeUndefined();
      expect(filter.farmerId).toBeUndefined();
    });
  });

  describe('findOne / cancel', () => {
    function orderDoc(overrides: Record<string, unknown> = {}) {
      return {
        id: '6a2fe77bb77795516febc500',
        buyerId: new Types.ObjectId(BUYER),
        farmerId: new Types.ObjectId(FARMER_A),
        items: [],
        totalAmount: 0,
        platformFeePercent: 5,
        platformFeeAmount: 0,
        grandTotal: 0,
        shippingAddress: ADDRESS,
        status: OrderStatus.Pending,
        createdAt: new Date('2026-06-15T12:00:00.000Z'),
        updatedAt: new Date('2026-06-15T12:00:00.000Z'),
        save: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('404s an invalid id', async () => {
      await expect(
        service.findOne('nope', {
          id: BUYER,
          role: UserRole.Buyer,
        } as RequestUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('forbids a non-owner non-admin from viewing', async () => {
      orderModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(orderDoc()),
      });
      await expect(
        service.findOne('6a2fe77bb77795516febc500', {
          id: 'someone-else',
          role: UserRole.Buyer,
        } as RequestUser),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets the buyer cancel a pending order', async () => {
      const doc = orderDoc();
      orderModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc),
      });
      const result = await service.cancel('6a2fe77bb77795516febc500', {
        id: BUYER,
        role: UserRole.Buyer,
      } as RequestUser);
      expect(doc.save).toHaveBeenCalled();
      expect(result.status).toBe(OrderStatus.Cancelled);
    });

    it('refuses to cancel a delivered order', async () => {
      orderModel.findById.mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue(orderDoc({ status: OrderStatus.Delivered })),
      });
      await expect(
        service.cancel('6a2fe77bb77795516febc500', {
          id: BUYER,
          role: UserRole.Buyer,
        } as RequestUser),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
