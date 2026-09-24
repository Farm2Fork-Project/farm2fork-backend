import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FarmerProfile,
  FarmerProfileDocument,
} from '../auth/schemas/farmer-profile.schema';
import {
  BlockchainTransaction,
  BlockchainTransactionDocument,
  BlockchainTxStatus,
  BlockchainTxType,
} from '../blockchain/schemas/blockchain-transaction.schema';
import {
  Product,
  ProductDocument,
} from '../marketplace/schemas/product.schema';
import { Order, OrderDocument } from '../order/schemas/order.schema';
import {
  FABRIC_GATEWAY_CLIENT,
  type FabricGatewayClient,
} from '../blockchain/interfaces/fabric-gateway-client.interface';
import {
  LedgerCheckState,
  OnChainCheck,
  ProductTraceResponseDto,
  TraceEventDto,
  TraceEventType,
  TraceFarmerDto,
  TraceLedgerStatus,
} from './dto/product-trace-response.dto';

/** Upper bounds that keep a public, unauthenticated read cheap. */
export const MAX_SUPPLY_CHAIN_EVENTS = 200;
export const MAX_PAYMENT_EVENTS = 100;
/** Fabric reads per trace request, and how long to wait for each. */
export const MAX_ON_CHAIN_CHECKS = 50;
export const ON_CHAIN_CHECK_TIMEOUT_MS = 3_000;
const VERIFIED_CACHE_LIMIT = 5_000;

const SUPPLY_CHAIN_EVENT_TYPES = new Set<string>([
  TraceEventType.Listed,
  TraceEventType.ShipmentAssigned,
  TraceEventType.ShipmentPickedUp,
  TraceEventType.ShipmentInTransit,
  TraceEventType.ShipmentDelivered,
  TraceEventType.ShipmentFailed,
]);

/**
 * TraceabilityModule (EP-03) - public product provenance.
 *
 * Builds a product's journey from the blockchain outbox, which the Fabric
 * worker updates with the committed transaction id once each event is on the
 * ledger. Only a public projection is returned: event type, time, city-level
 * location and ledger proof. Payment amounts, buyer/transporter identities and
 * raw payload internals are never exposed (master context 6.6).
 */
@Injectable()
export class TraceabilityService {
  private readonly logger = new Logger(TraceabilityService.name);
  /**
   * Ledger records are immutable, so a positive check never needs repeating.
   * Only `verified` results are cached; mismatches are re-checked each time.
   */
  private readonly verifiedKeys = new Set<string>();

  constructor(
    @Inject(FABRIC_GATEWAY_CLIENT)
    private readonly fabric: FabricGatewayClient,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(BlockchainTransaction.name)
    private readonly blockchainModel: Model<BlockchainTransactionDocument>,
    @InjectModel(FarmerProfile.name)
    private readonly farmerProfileModel: Model<FarmerProfileDocument>,
  ) {}

  async traceProduct(productId: string): Promise<ProductTraceResponseDto> {
    if (!Types.ObjectId.isValid(productId)) {
      throw new NotFoundException('Product not found');
    }
    const id = new Types.ObjectId(productId);
    const product = await this.productModel.findById(id).exec();
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const [farmer, supplyChainRecords, paymentRecords] = await Promise.all([
      this.farmerSummary(product.farmerId),
      this.blockchainModel
        .find({
          type: BlockchainTxType.SupplyChainEvent,
          'payload.supplyChain.productId': id,
        })
        .sort({ createdAt: 1 })
        .limit(MAX_SUPPLY_CHAIN_EVENTS)
        .exec(),
      this.paymentRecordsFor(id),
    ]);

    const events = [
      ...supplyChainRecords
        .filter((record) =>
          SUPPLY_CHAIN_EVENT_TYPES.has(
            record.payload?.supplyChain?.eventType ?? '',
          ),
        )
        .map((record) => this.toSupplyChainEvent(record)),
      ...paymentRecords.map((record) => this.toPaymentEvent(record)),
    ].sort(
      (a, b) =>
        a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
    );

    const ledgerCheck = await this.checkOnChain(
      [...supplyChainRecords, ...paymentRecords],
      events,
    );

    const listed = events.find((event) => event.type === TraceEventType.Listed);
    return {
      product: {
        id: product.id as string,
        name: product.name,
        category: product.category,
        unit: product.unit,
        qualityGrade: product.qualityGrade,
        status: product.status,
        imageUrl: product.images?.[0],
        listedAt: product.createdAt.toISOString(),
      },
      farmer,
      events,
      summary: {
        totalEvents: events.length,
        confirmedEvents: events.filter(
          (event) => event.ledger.status === TraceLedgerStatus.Confirmed,
        ).length,
        // Verified means confirmed by the worker and, when the peer is
        // reachable, re-read from Fabric with a matching transaction id.
        originVerified:
          listed?.ledger.status === TraceLedgerStatus.Confirmed &&
          (listed.ledger.onChain === undefined ||
            listed.ledger.onChain === OnChainCheck.Verified),
        ledgerCheck,
      },
    };
  }

  // --- internals -------------------------------------------------------------

  /**
   * Re-reads confirmed events from the Fabric peer and annotates each with
   * whether the ledger really holds that transaction. Best effort: without
   * a peer connection (local dev without Fabric) the check is reported as
   * unavailable instead of failing the public trace.
   */
  private async checkOnChain(
    records: BlockchainTransactionDocument[],
    events: TraceEventDto[],
  ): Promise<LedgerCheckState> {
    if (!this.fabric.isAvailable()) return LedgerCheckState.Unavailable;

    const txHashById = new Map(
      records.map((record) => [record._id.toHexString(), record.txHash]),
    );
    const toCheck = events
      .filter((event) => event.ledger.status === TraceLedgerStatus.Confirmed)
      .slice(0, MAX_ON_CHAIN_CHECKS);

    try {
      await Promise.all(
        toCheck.map(async (event) => {
          event.ledger.onChain = await this.checkOne(
            event.id,
            txHashById.get(event.id),
          );
        }),
      );
      return LedgerCheckState.Checked;
    } catch (error) {
      this.logger.warn(
        `Fabric read-back unavailable for trace: ${error instanceof Error ? error.message : String(error)}`,
      );
      for (const event of toCheck) delete event.ledger.onChain;
      return LedgerCheckState.Unavailable;
    }
  }

  private async checkOne(
    ledgerKey: string,
    expectedTxHash: string | undefined,
  ): Promise<OnChainCheck> {
    if (this.verifiedKeys.has(ledgerKey)) return OnChainCheck.Verified;

    const record = await withTimeout(
      this.fabric.findByLedgerKey(ledgerKey),
      ON_CHAIN_CHECK_TIMEOUT_MS,
    );
    if (!record) return OnChainCheck.NotFound;
    if (!expectedTxHash || record.txHash !== expectedTxHash) {
      return OnChainCheck.Mismatch;
    }
    if (this.verifiedKeys.size >= VERIFIED_CACHE_LIMIT)
      this.verifiedKeys.clear();
    this.verifiedKeys.add(ledgerKey);
    return OnChainCheck.Verified;
  }

  private async paymentRecordsFor(
    productId: Types.ObjectId,
  ): Promise<BlockchainTransactionDocument[]> {
    const orders = await this.orderModel
      .find({ 'items.productId': productId, paymentId: { $exists: true } })
      .select('paymentId')
      .limit(MAX_PAYMENT_EVENTS)
      .lean()
      .exec();
    const paymentIds = orders
      .map((order) => order.paymentId)
      .filter((paymentId): paymentId is Types.ObjectId => Boolean(paymentId));
    if (paymentIds.length === 0) {
      return [];
    }
    return this.blockchainModel
      .find({
        type: BlockchainTxType.Payment,
        referenceId: { $in: paymentIds },
      })
      .sort({ createdAt: 1 })
      .limit(MAX_PAYMENT_EVENTS)
      .exec();
  }

  private async farmerSummary(
    farmerId: Types.ObjectId,
  ): Promise<TraceFarmerDto | null> {
    const profile = await this.farmerProfileModel
      .findOne({ userId: farmerId })
      .select('farmName farmLocation.city farmLocation.province')
      .lean()
      .exec();
    if (!profile?.farmName) {
      return null;
    }
    return {
      farmName: profile.farmName,
      city: profile.farmLocation?.city || undefined,
      province: profile.farmLocation?.province || undefined,
    };
  }

  private toSupplyChainEvent(
    record: BlockchainTransactionDocument,
  ): TraceEventDto {
    const supplyChain = record.payload.supplyChain!;
    const isShipment = supplyChain.eventType !== TraceEventType.Listed;
    return {
      id: record._id.toHexString(),
      type: supplyChain.eventType as TraceEventType,
      occurredAt: (supplyChain.timestamp ?? record.createdAt).toISOString(),
      location: supplyChain.location || undefined,
      reference: isShipment ? shortReference(record.referenceId) : undefined,
      ledger: this.toLedger(record),
    };
  }

  private toPaymentEvent(record: BlockchainTransactionDocument): TraceEventDto {
    return {
      id: record._id.toHexString(),
      type: TraceEventType.PaymentConfirmed,
      occurredAt: (
        record.payload?.payment?.paidAt ?? record.createdAt
      ).toISOString(),
      reference: shortReference(record.referenceId),
      ledger: this.toLedger(record),
    };
  }

  private toLedger(
    record: BlockchainTransactionDocument,
  ): TraceEventDto['ledger'] {
    if (record.status === BlockchainTxStatus.Confirmed) {
      return {
        status: TraceLedgerStatus.Confirmed,
        txHash: record.txHash,
        blockNumber: record.blockNumber,
        channelName: record.channelName,
        confirmedAt: record.confirmedAt?.toISOString(),
      };
    }
    return {
      status:
        record.status === BlockchainTxStatus.Failed
          ? TraceLedgerStatus.Failed
          : TraceLedgerStatus.Pending,
    };
  }
}

/** Last six hex chars, upper-cased: enough to group events, not to look up. */
export function shortReference(id: Types.ObjectId): string {
  return id.toHexString().slice(-6).toUpperCase();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Fabric read timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
