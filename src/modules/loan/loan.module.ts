import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  LoanApplication,
  LoanApplicationSchema,
} from './schemas/loan-application.schema';

/**
 * LoanModule (EP-06). Registers the loan_applications data layer. Loan
 * applications (farmers only, master context 6.3) and financial-partner review
 * arrive in Sprint 5.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LoanApplication.name, schema: LoanApplicationSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class LoanModule {}
