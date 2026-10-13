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
import { QualityGrade } from '../marketplace/schemas/product.schema';
import {
  AiStatusResponseDto,
  GradableCrop,
  ModelStatus,
  PriceSuggestionRequestDto,
  PriceSuggestionResponseDto,
  QualityCheckResponseDto,
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
  qualityGrade: 'A' | 'B' | 'C' | 'D';
  confidenceScore: number;
  probabilities: Record<string, number>;
  crop: GradableCrop;
  cropSupported: boolean;
  lowConfidence: boolean;
  modelStatus: ModelStatus;
  modelVersion: string;
}

interface ServicePrice {
  predictedMinPrice: number;
  predictedMaxPrice: number;
  confidenceScore: number;
  modelVersion: string;
  method: 'rule_based';
  basis: 'crop' | 'category';
}

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

    const suggestedListingGrade =
      result.qualityGrade === 'D'
        ? null
        : (result.qualityGrade as QualityGrade);
    const stored = await this.predictionModel.create({
      userId: new Types.ObjectId(farmerId),
      predictionType: PredictionType.Quality,
      inputData: { productName: crop, category: crop },
      qualityGrade: suggestedListingGrade ?? undefined,
      modelGrade: result.qualityGrade,
      confidenceScore: result.confidenceScore,
      modelVersion: result.modelVersion,
    });

    return {
      predictionId: stored._id.toHexString(),
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
    const result = await this.call<ServicePrice>('/predict/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productName: input.productName,
        category: input.category,
        unit: input.unit,
        quantity: input.quantity,
        qualityGrade: input.qualityGrade,
      }),
    });

    const stored = await this.predictionModel.create({
      userId: new Types.ObjectId(farmerId),
      predictionType: PredictionType.Price,
      inputData: {
        productName: input.productName,
        category: input.category,
        quantity: input.quantity,
        unit: input.unit,
      },
      predictedMinPrice: result.predictedMinPrice,
      predictedMaxPrice: result.predictedMaxPrice,
      confidenceScore: result.confidenceScore,
      modelVersion: result.modelVersion,
    });

    return {
      predictionId: stored._id.toHexString(),
      predictedMinPrice: result.predictedMinPrice,
      predictedMaxPrice: result.predictedMaxPrice,
      unit: input.unit,
      confidenceScore: result.confidenceScore,
      method: result.method,
      basis: result.basis,
      modelVersion: result.modelVersion,
    };
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
