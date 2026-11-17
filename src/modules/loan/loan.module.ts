import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { CommunityModule } from '../community/community.module';
import { OrderModule } from '../order/order.module';
import { LoanController } from './loan.controller';
import { LoanCreditService } from './loan-credit.service';
import { LoanService } from './loan.service';
import {
  LoanApplication,
  LoanApplicationSchema,
} from './schemas/loan-application.schema';

/**
 * LoanModule (EP-06): farmer microfinance applications (master context 6.3)
 * and financial-partner review.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LoanApplication.name, schema: LoanApplicationSchema },
    ]),
    AuthModule,
    OrderModule,
    AdminModule,
    CommunityModule,
  ],
  controllers: [LoanController],
  providers: [LoanService, LoanCreditService],
  exports: [MongooseModule],
})
export class LoanModule {}
