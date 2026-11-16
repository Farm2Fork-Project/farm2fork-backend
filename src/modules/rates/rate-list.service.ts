import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { RequestUser } from '../../common/guards/roles.guard';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditLog, AuditLogDocument } from '../admin/schemas/audit-log.schema';
import {
  MAX_RATE_FILE_BYTES,
  convertRate,
  matchRateEntry,
  parseRateList,
} from './rate-list.parser';
import {
  QueryRateListsDto,
  RateListDetailDto,
  RateListPageDto,
  RateListSummaryDto,
  UploadRateListDto,
} from './rate-list.dto';
import {
  RateList,
  RateListDocument,
  RateListStatus,
} from './schemas/rate-list.schema';

export interface UploadedRateFile {
  buffer: Buffer;
  size: number;
  originalname?: string;
}

export interface RateReference {
  commodity: string;
  minPrice: number;
  maxPrice: number;
  unit: string;
  observedOn: string;
  market: string;
  source: string;
  sourceUrl: string;
  rateListId: string;
}

/** A published list older than this no longer backs a price reference. */
export const RATE_FRESH_DAYS = 30;

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * RateListService. Admins upload dated official market rate lists; farmers
 * and buyers read the latest published one, and listing price references
 * are drawn from it.
 */
@Injectable()
export class RateListService {
  constructor(
    @InjectModel(RateList.name)
    private readonly rateListModel: Model<RateListDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditModel: Model<AuditLogDocument>,
    private readonly storage: StorageService,
  ) {}

  async upload(
    actor: RequestUser,
    dto: UploadRateListDto,
    file: UploadedRateFile | undefined,
    document: UploadedRateFile | undefined,
  ): Promise<RateListDetailDto> {
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException('Attach the rate list as a CSV file.');
    }
    if (file.size > MAX_RATE_FILE_BYTES) {
      throw new BadRequestException('The CSV file is larger than 512 KB.');
    }
    const tradingDate = new Date(`${dto.tradingDate}T00:00:00.000Z`);
    if (
      Number.isNaN(tradingDate.getTime()) ||
      isoDay(tradingDate) !== dto.tradingDate
    ) {
      throw new BadRequestException('Trading date is not a real date.');
    }
    if (dto.tradingDate > isoDay(new Date())) {
      throw new BadRequestException('Trading date cannot be in the future.');
    }
    const text = file.buffer.toString('utf8');
    if (text.includes('\u0000')) {
      throw new BadRequestException(
        'That is not a CSV text file. In Excel choose Save As, CSV.',
      );
    }
    const parsed = parseRateList(text);
    if (parsed.errors.length > 0) {
      throw new BadRequestException({
        message: 'The rate list has problems. Fix them and upload again.',
        errors: parsed.errors,
      });
    }
    let documentRef: string | undefined;
    if (document) {
      this.storage.validate(document.buffer, 'document');
      documentRef = await this.storage.uploadPrivateDocument(
        document.buffer,
        'rate-lists',
      );
    }
    const list = await this.rateListModel.create({
      tradingDate,
      market: dto.market,
      source: dto.source,
      sourceUrl: dto.sourceUrl,
      entries: parsed.entries,
      status: RateListStatus.Draft,
      fileName: file.originalname?.slice(0, 120),
      documentRef,
      uploadedBy: new Types.ObjectId(actor.id),
    });
    await this.audit(actor, 'rate_list.uploaded', list, {
      after: {
        market: list.market,
        tradingDate: dto.tradingDate,
        entries: list.entries.length,
      },
    });
    return this.detail(list, true);
  }

  /** draft -> published -> withdrawn; a withdrawn list can be published again. */
  async setStatus(
    id: string,
    status: RateListStatus.Published | RateListStatus.Withdrawn,
    reason: string,
    actor: RequestUser,
  ): Promise<RateListDetailDto> {
    const list = await this.require(id, true);
    if (list.status === status) {
      throw new ConflictException(`This rate list is already ${status}.`);
    }
    if (
      status === RateListStatus.Withdrawn &&
      list.status === RateListStatus.Draft
    ) {
      throw new ConflictException('A draft has nothing to withdraw.');
    }
    const before = list.status;
    list.status = status;
    if (status === RateListStatus.Published) list.publishedAt = new Date();
    await list.save();
    await this.audit(actor, `rate_list.${status}`, list, {
      before: { status: before },
      after: { status, reason: reason.trim() },
    });
    return this.detail(list, true);
  }

  async adminList(query: QueryRateListsDto): Promise<RateListPageDto> {
    return this.page(
      query,
      query.status ? { status: { $eq: query.status } } : {},
    );
  }

  async adminDetail(id: string): Promise<RateListDetailDto> {
    return this.detail(await this.require(id, true), true);
  }

  /** Published lists only, newest trading day first. */
  async published(query: QueryRateListsDto): Promise<RateListPageDto> {
    return this.page(query, { status: RateListStatus.Published });
  }

  async publishedDetail(id: string): Promise<RateListDetailDto> {
    const list = await this.require(id, false);
    if (list.status !== RateListStatus.Published) {
      throw new NotFoundException('Rate list not found');
    }
    return this.detail(list, false);
  }

  /** The newest published list, for the member's market when it has one. */
  async latest(market?: string): Promise<RateListDetailDto | null> {
    const list = await this.latestDocument(market);
    return list ? this.detail(list, false) : null;
  }

  async markets(): Promise<string[]> {
    const markets = await this.rateListModel
      .distinct('market', { status: RateListStatus.Published })
      .exec();
    return markets.sort((a, b) => a.localeCompare(b));
  }

  /**
   * An official price for a listing, from the freshest published list (the
   * farmer's own market first). Undefined when no fresh list names the
   * product in a convertible unit, so the caller can fall back.
   */
  async reference(
    productName: string,
    unit: string,
    city?: string,
  ): Promise<RateReference | undefined> {
    const since = new Date(Date.now() - RATE_FRESH_DAYS * 86_400_000);
    const lists = await this.rateListModel
      .find({ status: RateListStatus.Published, tradingDate: { $gte: since } })
      .sort({ tradingDate: -1, publishedAt: -1 })
      .limit(20)
      .exec();
    const own = city?.trim().toLowerCase();
    const ordered = [
      ...lists.filter((l) => own && l.market.toLowerCase() === own),
      ...lists.filter((l) => !own || l.market.toLowerCase() !== own),
    ];
    for (const list of ordered) {
      const entry = matchRateEntry(productName, list.entries);
      if (!entry) continue;
      const minPrice = convertRate(entry.minPrice, entry.unit, unit);
      const maxPrice = convertRate(entry.maxPrice, entry.unit, unit);
      if (minPrice === undefined || maxPrice === undefined) continue;
      return {
        commodity: entry.commodity,
        minPrice,
        maxPrice,
        unit,
        observedOn: isoDay(list.tradingDate),
        market: list.market,
        source: list.source,
        sourceUrl: list.sourceUrl,
        rateListId: list._id.toHexString(),
      };
    }
    return undefined;
  }

  // --- internals ------------------------------------------------------------

  private async latestDocument(
    market?: string,
  ): Promise<RateListDocument | null> {
    const base = { status: RateListStatus.Published };
    const wanted = market?.trim();
    if (wanted) {
      const own = await this.rateListModel
        .findOne({ ...base, market: { $eq: wanted } })
        .collation({ locale: 'en', strength: 2 })
        .sort({ tradingDate: -1, publishedAt: -1 })
        .exec();
      if (own) return own;
    }
    return this.rateListModel
      .findOne(base)
      .sort({ tradingDate: -1, publishedAt: -1 })
      .exec();
  }

  private async page(
    query: QueryRateListsDto,
    filter: FilterQuery<RateListDocument>,
  ): Promise<RateListPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    if (query.market) filter.market = { $eq: query.market };
    const [lists, total] = await Promise.all([
      this.rateListModel
        .find(filter)
        .sort({ tradingDate: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.rateListModel.countDocuments(filter).exec(),
    ]);
    return { data: lists.map((l) => this.summary(l)), total, page, limit };
  }

  private async require(id: string, withDocument: boolean) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Rate list not found');
    }
    const query = this.rateListModel.findById(id);
    const list = await (
      withDocument ? query.select('+documentRef') : query
    ).exec();
    if (!list) throw new NotFoundException('Rate list not found');
    return list;
  }

  private summary(list: RateListDocument): RateListSummaryDto {
    return {
      id: list._id.toHexString(),
      tradingDate: isoDay(list.tradingDate),
      market: list.market,
      source: list.source,
      sourceUrl: list.sourceUrl,
      status: list.status,
      entryCount: list.entries.length,
      fileName: list.fileName,
      publishedAt: list.publishedAt?.toISOString(),
      createdAt: list.createdAt.toISOString(),
    };
  }

  private detail(list: RateListDocument, forAdmin: boolean): RateListDetailDto {
    return {
      ...this.summary(list),
      entries: list.entries.map((entry) => ({
        commodity: entry.commodity,
        unit: entry.unit,
        minPrice: entry.minPrice,
        maxPrice: entry.maxPrice,
        fairPrice: entry.fairPrice,
      })),
      ...(forAdmin && list.documentRef
        ? { documentUrl: this.storage.signedUrl(list.documentRef) }
        : {}),
    };
  }

  private async audit(
    actor: RequestUser,
    action: string,
    list: RateListDocument,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.auditModel.create({
      actorId: new Types.ObjectId(actor.id),
      actorRole: actor.role,
      action,
      targetEntity: 'RateList',
      targetId: list._id,
      metadata,
    });
  }
}
