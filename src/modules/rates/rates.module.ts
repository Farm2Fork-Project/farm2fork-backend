import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import {
  AdminRateListController,
  RateListController,
} from './rate-list.controller';
import { RateListService } from './rate-list.service';
import { RateList, RateListSchema } from './schemas/rate-list.schema';

/**
 * RatesModule. Dated official market rate lists: uploaded and published by
 * admins, read by every member, and the first source for listing price
 * references.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RateList.name, schema: RateListSchema },
    ]),
    AdminModule,
  ],
  controllers: [AdminRateListController, RateListController],
  providers: [RateListService],
  exports: [RateListService],
})
export class RatesModule {}
