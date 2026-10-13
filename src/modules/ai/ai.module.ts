import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import {
  AiPrediction,
  AiPredictionSchema,
} from './schemas/ai-prediction.schema';

/**
 * AiModule (EP-05). Farmer-facing quality grading and price suggestions,
 * proxied to the farm2fork-ai FastAPI service (master context 7.2) and
 * recorded in ai_predictions.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AiPrediction.name, schema: AiPredictionSchema },
    ]),
  ],
  controllers: [AiController],
  providers: [AiService],
  exports: [MongooseModule],
})
export class AiModule {}
