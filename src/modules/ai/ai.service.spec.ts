import {
  BadRequestException,
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
import {
  GRADABLE_CROPS,
  GradableCrop,
  QualityCheckRequestDto,
} from './dto/ai.dto';
import { validate } from 'class-validator';
import { AiPrediction, PredictionType } from './schemas/ai-prediction.schema';
import { FarmerProfile } from '../auth/schemas/farmer-profile.schema';

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
  let farmerProfileModel: { city?: string; findOne: jest.Mock };
  let fetchMock: jest.SpyInstance;
  let config: Record<string, string | undefined>;

  beforeEach(async () => {
    predictionModel = {
      create: jest.fn((doc: Record<string, unknown>) =>
        Promise.resolve({ ...doc, _id: new Types.ObjectId() }),
      ),
    };
    farmerProfileModel = {
      findOne: jest.fn(() => ({
        select: () => ({
          lean: () => ({
            exec: () =>
              Promise.resolve(
                farmerProfileModel.city
                  ? { farmLocation: { city: farmerProfileModel.city } }
                  : null,
              ),
          }),
        }),
      })),
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
        {
          provide: getModelToken(FarmerProfile.name),
          useValue: farmerProfileModel,
        },
        { provide: ConfigService, useValue: { get: (k: string) => config[k] } },
      ],
    }).compile();
    service = moduleRef.get(AiService);
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it.each(['other', 'cotton', 'sugarcane', 'tomato', '', undefined])(
    'rejects unsupported crop %s before fetching or storing a prediction',
    async (crop) => {
      const error = await service
        .checkQuality(FARMER, crop as GradableCrop, image())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect((error as Error).message).toContain(
        'wheat, rice, mango and maize',
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(predictionModel.create).not.toHaveBeenCalled();
    },
  );

  it('validates only the four supported crop selections at the API boundary', async () => {
    expect(GRADABLE_CROPS).toEqual(['wheat', 'rice', 'mango', 'maize']);
    for (const crop of [...GRADABLE_CROPS, 'other', 'cotton', 'sugarcane']) {
      const dto = Object.assign(new QualityCheckRequestDto(), { crop });
      const errors = await validate(dto);
      expect(errors.length).toBe(
        GRADABLE_CROPS.includes(crop as GradableCrop) ? 0 : 1,
      );
    }
  });

  it.each([
    { crop: 'mango', cropSupported: false },
    { crop: 'cotton', cropSupported: true },
    { crop: 'rice', cropSupported: true },
  ])(
    'does not suggest or persist a listing grade for unsupported or mismatched output %j',
    async (output) => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          qualityGrade: 'A',
          confidenceScore: 0.9,
          probabilities: { A: 0.9, B: 0.05, C: 0.03, D: 0.02 },
          ...output,
          lowConfidence: false,
          modelStatus: 'trained',
          modelVersion: 'test-model',
        }),
      );
      const result = await service.checkQuality(FARMER, 'mango', image());
      expect(result.suggestedListingGrade).toBeNull();
      expect(
        predictionModel.create.mock.calls[0][0].qualityGrade,
      ).toBeUndefined();
    },
  );

  it.each(GRADABLE_CROPS)(
    'grades a %s photo, forwards the internal token and stores the prediction',
    async (crop) => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          qualityGrade: 'B',
          confidenceScore: 0.81,
          probabilities: { A: 0.1, B: 0.81, C: 0.06, D: 0.03 },
          crop,
          cropSupported: true,
          lowConfidence: false,
          needsReview: false,
          reviewReason: null,
          modelStatus: 'trained',
          modelVersion: 'grade-cond-efficientnet_b0-1a2b3c4d',
        }),
      );

      const result = await service.checkQuality(FARMER, crop, image());

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://ai.internal:8000/predict/quality');
      expect(new Headers(init.headers).get('X-Internal-Token')).toBe(
        'internal-secret',
      );
      const form = init.body as FormData;
      expect(form.get('crop')).toBe(crop);
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
    },
  );

  it.each([
    ['low_confidence', 'low_confidence'],
    ['unfamiliar_photo', 'unfamiliar_photo'],
  ] as const)(
    'withholds a %s grade from the farmer but stores the raw output',
    async (reviewReason, expected) => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          qualityGrade: 'A',
          confidenceScore: 0.97,
          probabilities: { A: 0.97, B: 0.01, C: 0.01, D: 0.01 },
          crop: 'mango',
          cropSupported: true,
          lowConfidence: false,
          needsReview: true,
          reviewReason,
          photoSimilarity: 0.31,
          modelStatus: 'trained',
          modelVersion: 'grade-only-test',
        }),
      );

      const result = await service.checkQuality(FARMER, 'mango', image());

      expect(result).toMatchObject({
        modelGrade: null,
        suggestedListingGrade: null,
        probabilities: {},
        needsReview: true,
        reviewReason: expected,
        lowConfidence: true,
      });
      expect(predictionModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          modelGrade: 'A',
          reviewReason: expected,
          photoSimilarity: 0.31,
        }),
      );
      expect(
        predictionModel.create.mock.calls[0][0].qualityGrade,
      ).toBeUndefined();
    },
  );

  it('fails closed when a trained service does not report photo checks', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        qualityGrade: 'B',
        confidenceScore: 0.9,
        probabilities: { A: 0.05, B: 0.9, C: 0.03, D: 0.02 },
        crop: 'wheat',
        cropSupported: true,
        lowConfidence: false,
        modelStatus: 'trained',
        modelVersion: 'grade-only-old',
      }),
    );

    const result = await service.checkQuality(FARMER, 'wheat', image());

    expect(result).toMatchObject({
      modelGrade: null,
      suggestedListingGrade: null,
      needsReview: true,
      reviewReason: 'photo_check_unavailable',
    });
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

  it("returns a dated official price for the farmer's own market and stores it", async () => {
    farmerProfileModel.city = 'Faisalabad';
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        predictedMinPrice: 305,
        predictedMaxPrice: 305,
        modelVersion: 'amis-punjab-2026-10-22',
        method: 'official_wholesale',
        commodity: 'Rice Basmati Super (New)',
        observedOn: '2026-10-22',
        marketScope: 'Faisalabad',
        marketCount: 1,
        source: 'AMIS Punjab',
        sourceUrl: 'http://www.amis.pk',
      }),
    );

    const result = await service.suggestPrice(FARMER, {
      productName: 'Basmati Rice',
      category: 'grains',
      unit: ProductUnit.Kg,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      productName: 'Basmati Rice',
      location: 'Faisalabad',
    });
    expect(result).toMatchObject({
      predictedMinPrice: 305,
      method: 'official_wholesale',
      observedOn: '2026-10-22',
      marketScope: 'Faisalabad',
      source: 'AMIS Punjab',
      unit: 'kg',
    });
    expect(predictionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        predictionType: PredictionType.Price,
        predictedMinPrice: 305,
        modelVersion: 'amis-punjab-2026-10-22',
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
