import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { OrderModule } from '../order/order.module';
import { LoanController } from './loan.controller';
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
  ],
  controllers: [LoanController],
  providers: [LoanService],
  exports: [MongooseModule],
})
export class LoanModule {}
