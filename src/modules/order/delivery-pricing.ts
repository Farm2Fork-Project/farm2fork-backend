import { DeliverySettings } from '../admin/services/system-config.service';
import { LatLng, haversineKm } from '../../common/geo/geo';

export interface DeliveryQuote {
  /** Estimated road distance farm -> drop-off, 0.1 km precision. */
  distanceKm: number;
  /** PKR, rounded up to the nearest 10. */
  fee: number;
}

/**
 * Fixed delivery price, computed once at checkout and frozen on the order:
 * base + perKm x (straight-line distance x road factor). Straight-line is
 * used instead of a routing API so pricing is free, instant and
 * deterministic; the road factor corrects for typical detours.
 */
export function quoteDelivery(
  pickup: LatLng,
  dropoff: LatLng,
  settings: Pick<DeliverySettings, 'baseFee' | 'feePerKm' | 'roadFactor'>,
): DeliveryQuote {
  const distanceKm =
    Math.round(haversineKm(pickup, dropoff) * settings.roadFactor * 10) / 10;
  const fee =
    Math.ceil((settings.baseFee + settings.feePerKm * distanceKm) / 10) * 10;
  return { distanceKm, fee };
}
