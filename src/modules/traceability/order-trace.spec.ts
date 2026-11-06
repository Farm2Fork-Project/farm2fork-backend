import { Types } from 'mongoose';
import { TraceabilityService } from './traceability.service';
const query = (result: unknown) => ({
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(result),
});
it('projects only public order snapshots and scopes listing/shipment/payment queries', async () => {
  const id = new Types.ObjectId(),
    productId = new Types.ObjectId(),
    shipmentId = new Types.ObjectId(),
    paymentId = new Types.ObjectId();
  const order = {
    _id: id,
    farmerId: new Types.ObjectId(),
    shipmentId,
    paymentId,
    status: 'paid',
    buyerId: 'PRIVATE',
    shippingAddress: { street: 'PRIVATE' },
    grandTotal: 99,
    items: [
      {
        productId,
        productName: 'Mango',
        quantity: 2,
        unit: 'kg',
        unitPrice: 42,
      },
    ],
  };
  const records = { find: jest.fn().mockReturnValue(query([])) };
  const service = new TraceabilityService(
    { isAvailable: () => false } as never,
    {} as never,
    {} as never,
    records as never,
    { findOne: () => query(null) } as never,
    {
      getSettledOrder: async () => ({ order, paidAt: new Date('2026-10-28') }),
    } as never,
  );
  const result = await service.traceOrder(String(id));
  expect(result.order.items).toEqual([
    {
      productId: String(productId),
      productName: 'Mango',
      quantity: 2,
      unit: 'kg',
    },
  ]);
  expect(JSON.stringify(result)).not.toMatch(
    /PRIVATE|unitPrice|grandTotal|shippingAddress|buyerId/,
  );
  expect(records.find.mock.calls).toEqual(
    expect.arrayContaining([
      [expect.objectContaining({ referenceId: shipmentId })],
      [expect.objectContaining({ referenceId: paymentId })],
      [
        expect.objectContaining({
          'payload.supplyChain.eventType': 'listed',
          'payload.supplyChain.productId': { $in: [productId] },
        }),
      ],
    ]),
  );
});
