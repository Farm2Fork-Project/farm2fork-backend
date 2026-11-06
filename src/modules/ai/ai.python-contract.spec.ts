import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { AiService } from './ai.service';
import { AiPredictionDocument } from './schemas/ai-prediction.schema';
import { FarmerProfileDocument } from '../auth/schemas/farmer-profile.schema';
import { ProductUnit } from '../marketplace/schemas/product.schema';

// Recorded from the real Python FastAPI TestClient, trained frozen weights and
// matching reference on 2026-10-29. Public diagnostic/provenance fields only.
const fixture = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures/python-release-contracts.json'),
    'utf8',
  ),
) as { quality: Record<string, unknown>; price: Record<string, unknown> };
const farmerId = '6a2fe77bb77795516febc111';

describe('Python HTTP -> backend AI release contract', () => {
  const create = jest.fn((doc: Record<string, unknown>) =>
    Promise.resolve({ ...doc, _id: new Types.ObjectId() }),
  );
  let fetchMock: jest.SpyInstance;
  let service: AiService;
  beforeEach(() => {
    create.mockClear();
    fetchMock = jest.spyOn(globalThis, 'fetch');
    service = new AiService(
      { create } as unknown as Model<AiPredictionDocument>,
      new ConfigService({ AI_SERVICE_URL: 'http://fixture.invalid' }),
      {
        findOne: () => ({
          select: () => ({
            lean: () => ({
              exec: () => Promise.resolve({ farmLocation: { city: 'Lahore' } }),
            }),
          }),
        }),
      } as unknown as Model<FarmerProfileDocument>,
    );
  });
  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('suppresses the real blank-image grade while preserving photo review diagnostics', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(fixture.quality), { status: 200 }),
    );
    const result = await service.checkQuality(farmerId, 'wheat', {
      buffer: Buffer.from('fixture'),
      mimetype: 'image/png',
      originalname: 'blank.png',
      size: 7,
    });
    expect(result).toMatchObject({
      needsReview: true,
      suggestedListingGrade: null,
      modelGrade: fixture.quality.qualityGrade,
      reviewReason: fixture.quality.reviewReason,
      photoSimilarity: fixture.quality.photoSimilarity,
    });
    expect(create.mock.calls[0][0]).toMatchObject({
      needsReview: true,
      reviewReason: fixture.quality.reviewReason,
    });
    expect(create.mock.calls[0][0].qualityGrade).toBeUndefined();
  });

  it('preserves the real official wholesale observation and forwards profile city', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(fixture.price), { status: 200 }),
    );
    const result = await service.suggestPrice(farmerId, {
      productName: 'Wheat',
      category: 'grains',
      unit: ProductUnit.Kg,
    });
    expect(result).toMatchObject(fixture.price);
    expect(create.mock.calls[0][0]).toMatchObject(fixture.price);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toMatchObject({
      location: 'Lahore',
    });
    expect(result).not.toHaveProperty('confidenceScore');
    expect(result).not.toHaveProperty('basis');
  });
});
