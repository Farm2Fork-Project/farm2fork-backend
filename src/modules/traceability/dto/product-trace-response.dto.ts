import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ProductStatus,
  ProductUnit,
  QualityGrade,
} from '../../marketplace/schemas/product.schema';

/** Supply-chain milestones a public trace can show, in lifecycle order. */
export enum TraceEventType {
  Listed = 'listed',
  PaymentConfirmed = 'payment_confirmed',
  ShipmentAssigned = 'shipment_assigned',
  ShipmentPickedUp = 'shipment_picked_up',
  ShipmentInTransit = 'shipment_in_transit',
  ShipmentDelivered = 'shipment_delivered',
  ShipmentFailed = 'shipment_failed',
}

/**
 * Ledger state of one event. `pending` means the event is durably queued in
 * the outbox but not yet committed to Fabric; only `confirmed` events carry a
 * Fabric transaction id.
 */
export enum TraceLedgerStatus {
  Pending = 'pending',
  Confirmed = 'confirmed',
  Failed = 'failed',
}

/**
 * Result of re-reading a confirmed event from Hyperledger Fabric.
 * - verified: the ledger holds the record with the same transaction id
 * - mismatch: the ledger holds the key with a different transaction id
 * - not_found: the ledger has no record under this key
 */
export enum OnChainCheck {
  Verified = 'verified',
  Mismatch = 'mismatch',
  NotFound = 'not_found',
}

/** Whether this response's confirmed events were re-checked on Fabric. */
export enum LedgerCheckState {
  Checked = 'checked',
  Unavailable = 'unavailable',
}

export class TraceLedgerDto {
  @ApiProperty({ enum: TraceLedgerStatus })
  status!: TraceLedgerStatus;

  @ApiPropertyOptional({ description: 'Fabric transaction id' })
  txHash?: string;

  @ApiPropertyOptional()
  blockNumber?: number;

  @ApiPropertyOptional()
  channelName?: string;

  @ApiPropertyOptional({ example: '2026-08-11T12:05:03.000Z' })
  confirmedAt?: string;

  @ApiPropertyOptional({
    enum: OnChainCheck,
    description:
      'Present only for confirmed events when the Fabric peer was reachable.',
  })
  onChain?: OnChainCheck;
}

export class TraceEventDto {
  @ApiProperty({ description: 'Stable event id (outbox record id)' })
  id!: string;

  @ApiProperty({ enum: TraceEventType })
  type!: TraceEventType;

  @ApiProperty({ example: '2026-08-11T12:05:00.000Z' })
  occurredAt!: string;

  @ApiPropertyOptional({
    example: 'Multan, Punjab',
    description: 'City-level location only; never a street address.',
  })
  location?: string;

  @ApiPropertyOptional({
    example: 'C287A1',
    description:
      'Short, non-identifying reference grouping events of one delivery or sale.',
  })
  reference?: string;

  @ApiProperty({ type: TraceLedgerDto })
  ledger!: TraceLedgerDto;
}

export class TraceProductDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  category!: string;

  @ApiProperty({ enum: ProductUnit })
  unit!: ProductUnit;

  @ApiPropertyOptional({ enum: QualityGrade })
  qualityGrade?: QualityGrade;

  @ApiProperty({ enum: ProductStatus })
  status!: ProductStatus;

  @ApiPropertyOptional()
  imageUrl?: string;

  @ApiProperty({ example: '2026-08-11T11:00:00.000Z' })
  listedAt!: string;
}

export class TraceFarmerDto {
  @ApiProperty({ example: 'Green Valley Farm' })
  farmName!: string;

  @ApiPropertyOptional({ example: 'Multan' })
  city?: string;

  @ApiPropertyOptional({ example: 'Punjab' })
  province?: string;
}

export class TraceSummaryDto {
  @ApiProperty()
  totalEvents!: number;

  @ApiProperty()
  confirmedEvents!: number;

  @ApiProperty({
    description: 'True once the listing event itself is confirmed on Fabric.',
  })
  originVerified!: boolean;

  @ApiProperty({
    enum: LedgerCheckState,
    description:
      'checked = confirmed events were re-read from the Fabric peer; unavailable = no peer connection, states come from the backend outbox only.',
  })
  ledgerCheck!: LedgerCheckState;
}

export class ProductTraceResponseDto {
  @ApiProperty({ type: TraceProductDto })
  product!: TraceProductDto;

  @ApiPropertyOptional({ type: TraceFarmerDto, nullable: true })
  farmer!: TraceFarmerDto | null;

  @ApiProperty({ type: [TraceEventDto] })
  events!: TraceEventDto[];

  @ApiProperty({ type: TraceSummaryDto })
  summary!: TraceSummaryDto;
}
