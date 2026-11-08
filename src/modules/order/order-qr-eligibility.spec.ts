import { Types } from 'mongoose';
import { OrderService } from './order.service';
import { OrderStatus } from './schemas/order.schema';
import { UserRole } from '../../common/enums/user-role.enum';

const id = new Types.ObjectId();
const buyer = new Types.ObjectId();
const paymentId = new Types.ObjectId();
const order = {
  _id: id,
  id: String(id),
  buyerId: buyer,
  farmerId: new Types.ObjectId(),
  paymentId,
  items: [],
  status: OrderStatus.Delivered,
  shippingAddress: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('order QR action eligibility', () => {
  it.each([true, false])(
    'reports server-derived settled-payment eligibility %s',
    async (settled) => {
      const distinct = jest
        .fn()
        .mockReturnValue({ exec: async () => (settled ? [id] : []) });
      const service = new OrderService(
        { findById: () => ({ exec: async () => order }) } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { distinct } as never,
        {} as never,
      );
      const response = await service.findOne(String(id), {
        id: String(buyer),
        role: UserRole.Buyer,
      } as never);
      expect(response.canViewQr).toBe(settled);
      expect(distinct).toHaveBeenCalledWith(
        'orderId',
        expect.objectContaining({
          status: 'success',
          paidAt: { $type: 'date' },
          $or: [{ _id: paymentId, orderId: id }],
        }),
      );
    },
  );
});
