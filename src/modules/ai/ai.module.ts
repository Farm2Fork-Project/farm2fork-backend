import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AiPrediction,
  AiPredictionSchema,
} from './schemas/ai-prediction.schema';

/**
 * AiModule (EP-05). Registers the ai_predictions data layer. The HTTP client
 * calling the FastAPI service (master context 7.2) arrives in Sprint 5.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AiPrediction.name, schema: AiPredictionSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class AiModule {}
