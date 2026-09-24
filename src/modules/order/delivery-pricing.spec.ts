import { quoteDelivery } from './delivery-pricing';

describe('quoteDelivery', () => {
  const settings = { baseFee: 150, feePerKm: 25, roadFactor: 1.3 };

  it('prices base + per-km x (straight line x road factor), rounded up to Rs 10', () => {
    // One degree of latitude = 111.19 km; x1.3 = 144.55 km.
    expect(
      quoteDelivery({ lat: 30, lng: 70 }, { lat: 31, lng: 70 }, settings),
    ).toEqual({
      distanceKm: 144.6,
      fee: 3770,
    });
  });

  it('charges only the base fee for a same-spot delivery', () => {
    const point = { lat: 31.52, lng: 74.35 };
    expect(quoteDelivery(point, point, settings)).toEqual({
      distanceKm: 0,
      fee: 150,
    });
  });

  it('is symmetric', () => {
    const a = { lat: 30.1575, lng: 71.5249 };
    const b = { lat: 31.5204, lng: 74.3587 };
    expect(quoteDelivery(a, b, settings)).toEqual(
      quoteDelivery(b, a, settings),
    );
  });
});
