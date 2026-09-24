import { ApiProperty } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, Max, Min } from 'class-validator';

/**
 * Generous bounding box around Pakistan (incl. Gilgit-Baltistan and AJK).
 * Rejects swapped lat/lng and pins dropped in the wrong country.
 */
export const PAKISTAN_BOUNDS = {
  minLat: 23.5,
  maxLat: 37.2,
  minLng: 60.5,
  maxLng: 77.9,
} as const;

export interface LatLng {
  lat: number;
  lng: number;
}

/** A map pin inside Pakistan. */
export class LatLngDto implements LatLng {
  @ApiProperty({ example: 30.1575 })
  @IsLatitude()
  @Min(PAKISTAN_BOUNDS.minLat, { message: 'Location must be inside Pakistan' })
  @Max(PAKISTAN_BOUNDS.maxLat, { message: 'Location must be inside Pakistan' })
  lat!: number;

  @ApiProperty({ example: 71.5249 })
  @IsLongitude()
  @Min(PAKISTAN_BOUNDS.minLng, { message: 'Location must be inside Pakistan' })
  @Max(PAKISTAN_BOUNDS.maxLng, { message: 'Location must be inside Pakistan' })
  lng!: number;
}

export interface GeoJsonPoint {
  type: 'Point';
  /** GeoJSON order: [longitude, latitude]. */
  coordinates: [number, number];
}

export function toGeoPoint({ lat, lng }: LatLng): GeoJsonPoint {
  return { type: 'Point', coordinates: [lng, lat] };
}

export function fromGeoPoint(point: GeoJsonPoint): LatLng {
  return { lat: point.coordinates[1], lng: point.coordinates[0] };
}

export function hasCoordinates(
  value:
    | {
        lat?: number | null;
        lng?: number | null;
      }
    | null
    | undefined,
): value is LatLng {
  return (
    typeof value?.lat === 'number' &&
    Number.isFinite(value.lat) &&
    typeof value?.lng === 'number' &&
    Number.isFinite(value.lng)
  );
}

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Coarsens a point to a ~1 km grid, for showing a buyer's drop-off area to
 * transporters who have not accepted the delivery yet.
 */
export function approximate({ lat, lng }: LatLng): LatLng {
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}
