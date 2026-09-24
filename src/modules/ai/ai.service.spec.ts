import {
  HttpException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ProductUnit } from '../marketplace/schemas/product.schema';
import { AiService } from './ai.service';
import { AiPrediction, PredictionType } from './schemas/ai-prediction.schema';

const FARMER = '6a2fe77bb77795516febc111';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const image = (overrides: Record<string, unknown> = {}) => ({
  buffer: Buffer.from([0xff, 0xd8, 0xff]),
  mimetype: 'image/jpeg',
  originalname: 'mango.jpg',
  size: 3,
  ...overrides,
});

describe('AiService', () => {
  let service: AiService;
  let predictionModel: { create: jest.Mock };
  let fetchMock: jest.SpyInstance;
  let config: Record<string, string | undefined>;

  beforeEach(async () => {
    predictionModel = {
      create: jest.fn((doc: Record<string, unknown>) =>
        Promise.resolve({ ...doc, _id: new Types.ObjectId() }),
      ),
    };
    config = {
      AI_SERVICE_URL: 'http://ai.internal:8000/',
      AI_SERVICE_TOKEN: 'internal-secret',
    };
    fetchMock = jest.spyOn(globalThis, 'fetch');
    const moduleRef = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: getModelToken(AiPrediction.name),
          useValue: predictionModel,
        },
        { provide: ConfigService, useValue: { get: (k: string) => config[k] } },
      ],
    }).compile();
    service = moduleRef.get(AiService);
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('grades a photo, forwards the internal token and stores the prediction', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        qualityGrade: 'B',
        confidenceScore: 0.81,
        probabilities: { A: 0.1, B: 0.81, C: 0.06, D: 0.03 },
        crop: 'mango',
        cropSupported: true,
        lowConfidence: false,
        modelStatus: 'trained',
        modelVersion: 'grade-cond-efficientnet_b0-1a2b3c4d',
      }),
    );

    const result = await service.checkQuality(FARMER, 'mango', image());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ai.internal:8000/predict/quality');
    expect(new Headers(init.headers).get('X-Internal-Token')).toBe(
      'internal-secret',
    );
    const form = init.body as FormData;
    expect(form.get('crop')).toBe('mango');
    expect(form.get('image')).toBeInstanceOf(Blob);
    expect(result).toMatchObject({
      modelGrade: 'B',
      suggestedListingGrade: 'B',
      modelStatus: 'trained',
    });
    expect(predictionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        predictionType: PredictionType.Quality,
        qualityGrade: 'B',
        modelGrade: 'B',
        confidenceScore: 0.81,
        modelVersion: 'grade-cond-efficientnet_b0-1a2b3c4d',
      }),
    );
  });

  it('never suggests a listing grade for a D and keeps the enum-safe field empty', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        qualityGrade: 'D',
        confidenceScore: 0.7,
        probabilities: { A: 0.1, B: 0.1, C: 0.1, D: 0.7 },
        crop: 'rice',
        cropSupported: true,
        lowConfidence: false,
        modelStatus: 'untrained',
        modelVersion: 'grade-cond-efficientnet_b0-untrained',
      }),
    );

    const result = await service.checkQuality(FARMER, 'rice', image());

    expect(result.suggestedListingGrade).toBeNull();
    expect(result.modelStatus).toBe('untrained');
    const stored = predictionModel.create.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(stored.qualityGrade).toBeUndefined();
    expect(stored.modelGrade).toBe('D');
  });

  it('rejects missing, wrong-type and oversized photos before calling the service', async () => {
    await expect(
      service.checkQuality(FARMER, 'rice', undefined),
    ).rejects.toThrow('Attach a photo');
    await expect(
      service.checkQuality(FARMER, 'rice', image({ mimetype: 'image/gif' })),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    await expect(
      service.checkQuality(FARMER, 'rice', image({ size: 9 * 1024 * 1024 })),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('suggests a rule-based price and stores it', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        predictedMinPrice: 198,
        predictedMaxPrice: 418,
        confidenceScore: 0.45,
        modelVersion: 'price-rules-v1',
        method: 'rule_based',
        basis: 'crop',
      }),
    );

    const result = await service.suggestPrice(FARMER, {
      productName: 'Basmati Rice',
      category: 'grains',
      unit: ProductUnit.Kg,
    });

    expect(result).toMatchObject({
      predictedMinPrice: 198,
      predictedMaxPrice: 418,
      method: 'rule_based',
      unit: 'kg',
    });
    expect(predictionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        predictionType: PredictionType.Price,
        predictedMinPrice: 198,
        modelVersion: 'price-rules-v1',
      }),
    );
  });

  it('maps an unreachable or failing service to 503 and relays validation errors', async () => {
    const body = {
      productName: 'Eggs',
      category: 'dairy',
      unit: ProductUnit.Dozen,
    };
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(service.suggestPrice(FARMER, body)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { detail: 'boom' }));
    await expect(service.suggestPrice(FARMER, body)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { detail: "No price rule for unit 'dozen'." }),
    );
    const error: unknown = await service
      .suggestPrice(FARMER, body)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(422);
    expect((error as HttpException).message).toBe(
      "No price rule for unit 'dozen'.",
    );
    expect(predictionModel.create).not.toHaveBeenCalled();
  });

  it('reports the service as unavailable rather than failing status checks', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(service.status()).resolves.toEqual({ available: false });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        status: 'ok',
        qualityModel: 'untrained',
        trainedCrops: ['wheat'],
        priceMethod: 'rule_based',
      }),
    );
    await expect(service.status()).resolves.toEqual({
      available: true,
      qualityModel: 'untrained',
      trainedCrops: ['wheat'],
      priceMethod: 'rule_based',
    });
  });
});
