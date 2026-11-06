import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { OrderProvenanceService } from './order-provenance.service';
import { PaymentStatus } from '../payment/schemas/payment.schema';
const id = new Types.ObjectId();
const paymentId = new Types.ObjectId();
const query = (value: unknown) => ({
  exec: jest.fn().mockResolvedValue(value),
});
describe('OrderProvenanceService', () => {
  const order = { _id: id, id: String(id), paymentId, status: 'paid' };
  let payments: { findOne: jest.Mock };
  let visible: { findOne: jest.Mock };
  let service: OrderProvenanceService;
  beforeEach(() => {
    order.status = 'paid';
    payments = {
      findOne: jest
        .fn()
        .mockReturnValue(
          query({ status: PaymentStatus.Success, paidAt: new Date() }),
        ),
    };
    visible = { findOne: jest.fn().mockResolvedValue(order) };
    service = new OrderProvenanceService(
      { findById: () => query(order) } as never,
      payments as never,
      visible as never,
      new ConfigService({ PUBLIC_TRACE_ORIGIN: 'https://example.com/' }),
    );
  });
  it('requires settled payment evidence, including a settlement timestamp', async () => {
    for (const payment of [
      null,
      { status: PaymentStatus.Pending },
      { status: PaymentStatus.Success },
      { status: PaymentStatus.Refunded, paidAt: new Date() },
    ]) {
      payments.findOne.mockReturnValue(query(payment));
      await expect(service.getSettledOrder(String(id))).rejects.toThrow(
        'Order not found',
      );
    }
  });
  it('produces a canonical HTTPS QR PNG after ownership authorization', async () => {
    const result = await service.getQr(String(id), {} as never);
    expect(result).toMatchObject({
      orderId: String(id),
      qrCode: `https://example.com/trace/orders/${id}`,
    });
    expect(result.qrImageDataUri).toMatch(/^data:image\/png;base64,/);
    expect(visible.findOne).toHaveBeenCalled();
  });
  it('does not generate QR for a caller without order access', async () => {
    visible.findOne.mockRejectedValue(new Error('forbidden'));
    await expect(service.getQr(String(id), {} as never)).rejects.toThrow(
      'forbidden',
    );
    expect(payments.findOne).not.toHaveBeenCalled();
  });
  it('rejects pending and cancelled orders even with a successful payment', async () => {
    for (const status of ['pending', 'cancelled']) {
      order.status = status;
      await expect(service.getSettledOrder(String(id))).rejects.toThrow(
        'Order not found',
      );
    }
    order.status = 'paid';
  });
  it('reports invalid HTTPS configuration as unavailable', async () => {
    const invalid = new OrderProvenanceService(
      { findById: () => query(order) } as never,
      payments as never,
      visible as never,
      new ConfigService({ PUBLIC_TRACE_ORIGIN: 'http://localhost:3000' }),
    );
    await expect(invalid.getQr(String(id), {} as never)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('rejects malformed ids', async () => {
    await expect(service.getSettledOrder('bad')).rejects.toThrow(
      'Order not found',
    );
  });
});
