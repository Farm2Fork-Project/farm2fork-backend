import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FarmerProfile,
  FarmerProfileDocument,
} from '../auth/schemas/farmer-profile.schema';
import { QualityGrade } from '../marketplace/schemas/product.schema';
import {
  AiStatusResponseDto,
  GRADABLE_CROPS,
  GradableCrop,
  ModelStatus,
  PriceSuggestionRequestDto,
  PriceSuggestionResponseDto,
  QualityCheckResponseDto,
  ReviewReason,
} from './dto/ai.dto';
import {
  AiPrediction,
  AiPredictionDocument,
  PredictionType,
} from './schemas/ai-prediction.schema';

export const MAX_QUALITY_IMAGE_BYTES = 8 * 1024 * 1024;
export const QUALITY_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

interface ServiceQuality {
  needsReview?: boolean;
  reviewReason?: ReviewReason | null;
  photoSimilarity?: number | null;
  qualityGrade: 'A' | 'B' | 'C' | 'D';
  confidenceScore: number;
  probabilities: Record<string, number>;
  crop: GradableCrop;
  cropSupported: boolean;
  lowConfidence: boolean;
  modelStatus: ModelStatus;
  modelVersion: string;
}

type ServicePrice = Omit<PriceSuggestionResponseDto, 'predictionId'>;

/**
 * AiModule (EP-05) - HTTP client for the farm2fork-ai FastAPI service
 * (master context 7.2). Every prediction is stored in ai_predictions
 * regardless of model or rule-based origin; modelVersion distinguishes them.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @InjectModel(AiPrediction.name)
    private readonly predictionModel: Model<AiPredictionDocument>,
    private readonly config: ConfigService,
    @InjectModel(FarmerProfile.name)
    private readonly farmerProfileModel: Model<FarmerProfileDocument>,
  ) {}

  async status(): Promise<AiStatusResponseDto> {
    try {
      const health = await this.call<{
        qualityModel: 'trained' | 'untrained' | 'unavailable';
        trainedCrops: string[];
        priceMethod: string;
      }>('/health', { method: 'GET' });
      return {
        available: true,
        qualityModel: health.qualityModel,
        trainedCrops: health.trainedCrops,
        priceMethod: health.priceMethod,
      };
    } catch {
      return { available: false };
    }
  }

  async checkQuality(
    farmerId: string,
    crop: GradableCrop,
    image: UploadedImage | undefined,
  ): Promise<QualityCheckResponseDto> {
    // Keep direct callers safe even when HTTP DTO validation is bypassed.
    if (!GRADABLE_CROPS.includes(crop)) {
      throw new BadRequestException(
        'Quality suggestions are available only for wheat, rice, mango and maize. Choose a listing grade manually for other crops.',
      );
    }
    if (!image) throw new BadRequestException('Attach a photo of the produce.');
    if (!QUALITY_IMAGE_TYPES.includes(image.mimetype)) {
      throw new UnsupportedMediaTypeException(
        'Upload a JPEG, PNG or WebP photo.',
      );
    }
    if (image.size > MAX_QUALITY_IMAGE_BYTES) {
      throw new PayloadTooLargeException('Photo is larger than 8 MB.');
    }

    const form = new FormData();
    form.append('crop', crop);
    form.append(
      'image',
      new Blob([new Uint8Array(image.buffer)], { type: image.mimetype }),
      image.originalname || 'produce.jpg',
    );
    const result = await this.call<ServiceQuality>('/predict/quality', {
      method: 'POST',
      body: form,
    });

    this.validateQuality(result);
    const unsupported =
      result.cropSupported !== true ||
      result.crop !== crop ||
      !GRADABLE_CROPS.includes(result.crop);
    const reviewReason: ReviewReason | null = unsupported
      ? 'unsupported_crop'
      : result.modelStatus !== 'trained'
        ? 'untrained_model'
        : result.needsReview === true && result.reviewReason != null
          ? result.reviewReason
          : result.lowConfidence !== false || result.confidenceScore < 0.7
            ? 'low_confidence'
            : result.needsReview !== false
              ? (result.reviewReason ?? 'photo_check_unavailable')
              : result.photoSimilarity == null ||
                  result.reviewReason === undefined
                ? 'photo_check_unavailable'
                : (result.reviewReason ?? null);
    const needsReview = reviewReason !== null || result.qualityGrade === 'D';
    const suggestedListingGrade = needsReview
      ? null
      : (result.qualityGrade as QualityGrade);
    const review = {
      needsReview,
      reviewReason,
      photoSimilarity: result.photoSimilarity ?? null,
    };
    const stored = await this.predictionModel.create({
      userId: new Types.ObjectId(farmerId),
      predictionType: PredictionType.Quality,
      inputData: { productName: crop, category: crop },
      qualityGrade: suggestedListingGrade ?? undefined,
      ...review,
      modelGrade: result.qualityGrade,
      confidenceScore: result.confidenceScore,
      modelVersion: result.modelVersion,
    });

    return {
      predictionId: stored._id.toHexString(),
      ...review,
      modelGrade: result.qualityGrade,
      suggestedListingGrade,
      confidenceScore: result.confidenceScore,
      probabilities: result.probabilities,
      crop: result.crop,
      cropSupported: result.cropSupported,
      lowConfidence: result.lowConfidence,
      modelStatus: result.modelStatus,
      modelVersion: result.modelVersion,
    };
  }

  async suggestPrice(
    farmerId: string,
    input: PriceSuggestionRequestDto,
  ): Promise<PriceSuggestionResponseDto> {
    const profile = await this.farmerProfileModel
      .findOne({ userId: new Types.ObjectId(farmerId) })
      .select('farmLocation.city')
      .lean()
      .exec();
    const city = profile?.farmLocation?.city?.trim() || undefined;
    const result = await this.call<ServicePrice>('/predict/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: city,
        productName: input.productName,
        category: input.category,
        unit: input.unit,
        quantity: input.quantity,
        qualityGrade: input.qualityGrade,
      }),
    });

    this.validatePrice(result, input.unit);
    const {
      predictedMinPrice,
      predictedMaxPrice,
      unit,
      currency,
      modelVersion,
      method,
      commodity,
      observedOn,
      marketScope,
      marketCount,
      source,
      sourceUrl,
    } = result;
    const price = {
      predictedMinPrice,
      predictedMaxPrice,
      unit,
      currency,
      modelVersion,
      method,
      commodity,
      observedOn,
      marketScope,
      marketCount,
      source,
      sourceUrl,
    };
    const stored = await this.predictionModel.create({
      ...price,
      userId: new Types.ObjectId(farmerId),
      predictionType: PredictionType.Price,
      inputData: {
        productName: input.productName,
        category: input.category,
        quantity: input.quantity,
        unit: input.unit,
        location: city,
      },
      predictedMinPrice: result.predictedMinPrice,
      predictedMaxPrice: result.predictedMaxPrice,
      modelVersion: result.modelVersion,
    });

    return {
      predictionId: stored._id.toHexString(),
      ...price,
    };
  }

  private invalidResponse(): never {
    throw new ServiceUnavailableException(
      'The AI service returned an invalid response. Please try again shortly.',
    );
  }

  private validateQuality(result: ServiceQuality): void {
    if (
      !result ||
      !['A', 'B', 'C', 'D'].includes(result.qualityGrade) ||
      !Number.isFinite(result.confidenceScore) ||
      result.confidenceScore < 0 ||
      result.confidenceScore > 1 ||
      typeof result.crop !== 'string' ||
      typeof result.cropSupported !== 'boolean' ||
      typeof result.lowConfidence !== 'boolean' ||
      !['trained', 'untrained'].includes(result.modelStatus) ||
      typeof result.modelVersion !== 'string' ||
      !result.modelVersion.trim() ||
      !result.probabilities ||
      ['A', 'B', 'C', 'D'].some(
        (grade) =>
          !Number.isFinite(result.probabilities[grade]) ||
          result.probabilities[grade] < 0 ||
          result.probabilities[grade] > 1,
      ) ||
      (result.needsReview !== undefined &&
        typeof result.needsReview !== 'boolean') ||
      (result.reviewReason != null &&
        ![
          'low_confidence',
          'crop_mismatch',
          'unfamiliar_photo',
          'photo_check_unavailable',
          'unsupported_crop',
          'untrained_model',
        ].includes(result.reviewReason)) ||
      (result.photoSimilarity != null &&
        (!Number.isFinite(result.photoSimilarity) ||
          result.photoSimilarity < -1 ||
          result.photoSimilarity > 1))
    )
      this.invalidResponse();
    // The Python service rounds probabilities and confidence to four decimals.
    // A 0.001 tolerance covers their cumulative rounding without accepting a
    // contradictory confidence or a grade other than a (possibly tied) maximum.
    const probabilities = ['A', 'B', 'C', 'D'].map(
      (grade) => result.probabilities[grade],
    );
    const selected = result.probabilities[result.qualityGrade];
    if (
      Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) >
        0.001 ||
      Math.abs(result.confidenceScore - selected) > 0.001 ||
      selected < Math.max(...probabilities)
    )
      this.invalidResponse();
  }

  private validatePrice(result: ServicePrice, unit: string): void {
    if (
      !result ||
      result.method !== 'official_wholesale' ||
      result.currency !== 'PKR' ||
      String(result.unit) !== unit ||
      !Number.isFinite(result.predictedMinPrice) ||
      result.predictedMinPrice <= 0 ||
      !Number.isFinite(result.predictedMaxPrice) ||
      result.predictedMaxPrice < result.predictedMinPrice ||
      !Number.isInteger(result.marketCount) ||
      result.marketCount < 1 ||
      (
        [
          'modelVersion',
          'commodity',
          'marketScope',
          'source',
          'sourceUrl',
        ] as const
      ).some((key) => typeof result[key] !== 'string' || !result[key].trim()) ||
      typeof result.observedOn !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(result.observedOn) ||
      !Number.isFinite(Date.parse(result.observedOn)) ||
      new Date(result.observedOn).toISOString().slice(0, 10) !==
        result.observedOn ||
      result.observedOn > new Date().toISOString().slice(0, 10)
    )
      this.invalidResponse();
    try {
      if (
        !['https:', 'http:'].includes(new URL(result.sourceUrl).protocol) ||
        new URL(result.sourceUrl).username ||
        new URL(result.sourceUrl).password
      )
        this.invalidResponse();
    } catch {
      this.invalidResponse();
    }
  }

  /**
   * Calls the AI service. Network failures and 5xx become 503 (the farmer
   * can retry); the service's own validation errors are relayed with their
   * status so the app can show a precise message.
   */
  private async call<T>(path: string, init: RequestInit): Promise<T> {
    const baseUrl = (
      this.config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000'
    ).replace(/\/+$/, '');
    const token = this.config.get<string>('AI_SERVICE_TOKEN');
    const timeoutMs = Number(
      this.config.get('AI_SERVICE_TIMEOUT_MS') ?? 20_000,
    );
    const headers = new Headers(init.headers);
    if (token) headers.set('X-Internal-Token', token);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      this.logger.warn(
        `AI service unreachable at ${baseUrl}${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException(
        'The AI service is unavailable. Please try again shortly.',
      );
    }

    const body: unknown = await response.json().catch(() => null);
    if (response.ok) return body as T;

    const detail =
      body && typeof body === 'object' && 'detail' in body
        ? body.detail
        : undefined;
    const message = typeof detail === 'string' ? detail : 'AI request failed.';
    if (response.status >= 500 || response.status === 401) {
      // 401 here means our internal token is misconfigured - not the user's fault.
      this.logger.error(
        `AI service ${path} answered ${response.status}: ${message}`,
      );
      throw new ServiceUnavailableException(
        'The AI service is unavailable. Please try again shortly.',
      );
    }
    throw new HttpException(message, response.status);
  }
}
