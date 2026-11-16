import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FarmerProfile,
  FarmerProfileDocument,
} from '../auth/schemas/farmer-profile.schema';
import { User, UserDocument } from '../auth/schemas/user.schema';
import {
  Review,
  ReviewDocument,
  ReviewStatus,
} from '../community/schemas/review.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
} from '../order/schemas/order.schema';
import { CreditAssessment, assessCredit } from './credit-assessment';
import {
  LoanApplication,
  LoanApplicationDocument,
  LoanStatus,
} from './schemas/loan-application.schema';

const RECENT_DAYS = 180;
const DAY_MS = 86_400_000;

export interface CreditSubject {
  loanId: Types.ObjectId;
  applicantId: Types.ObjectId;
  amount: number;
  durationMonths: number;
}

/**
 * Gathers what the platform knows about each applicant and hands it to the
 * pure scoring function. Batched per page of applications: five queries in
 * total however many loans are on the page.
 */
@Injectable()
export class LoanCreditService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(FarmerProfile.name)
    private readonly farmerProfileModel: Model<FarmerProfileDocument>,
    @InjectModel(LoanApplication.name)
    private readonly loanModel: Model<LoanApplicationDocument>,
    @InjectModel(Review.name)
    private readonly reviewModel: Model<ReviewDocument>,
  ) {}

  /** Assessments keyed by loan id. */
  async assess(
    subjects: CreditSubject[],
  ): Promise<Map<string, CreditAssessment>> {
    if (subjects.length === 0) return new Map();
    const ids = [
      ...new Map(
        subjects.map((s) => [s.applicantId.toHexString(), s.applicantId]),
      ).values(),
    ];
    const now = new Date();
    const recentSince = new Date(now.getTime() - RECENT_DAYS * DAY_MS);

    const [sales, users, profiles, loans, ratings] = await Promise.all([
      this.orderModel
        .aggregate<{
          _id: Types.ObjectId;
          delivered: number;
          recentRevenue: number;
          repeatBuyers: number;
        }>([
          {
            $match: { farmerId: { $in: ids }, status: OrderStatus.Delivered },
          },
          {
            $group: {
              _id: { farmerId: '$farmerId', buyerId: '$buyerId' },
              orders: { $sum: 1 },
              recentRevenue: {
                $sum: {
                  $cond: [
                    { $gte: ['$createdAt', recentSince] },
                    '$totalAmount',
                    0,
                  ],
                },
              },
            },
          },
          {
            $group: {
              _id: '$_id.farmerId',
              delivered: { $sum: '$orders' },
              recentRevenue: { $sum: '$recentRevenue' },
              repeatBuyers: {
                $sum: { $cond: [{ $gt: ['$orders', 1] }, 1, 0] },
              },
            },
          },
        ])
        .exec(),
      this.userModel
        .find({ _id: { $in: ids } })
        .select('createdAt')
        .lean()
        .exec(),
      this.farmerProfileModel
        .find({ userId: { $in: ids } })
        .select(
          'userId landSizeAcres farmLocation.city cropTypes certifications bankAccountDetails.accountNumber',
        )
        .lean()
        .exec(),
      this.loanModel
        .find({ applicantId: { $in: ids } })
        .select('applicantId status repaymentSchedule')
        .lean()
        .exec(),
      this.reviewModel
        .aggregate<{ _id: Types.ObjectId; average: number; count: number }>([
          {
            $match: { farmerId: { $in: ids }, status: ReviewStatus.Published },
          },
          {
            $group: {
              _id: '$farmerId',
              average: { $avg: '$rating' },
              count: { $sum: 1 },
            },
          },
        ])
        .exec(),
    ]);

    const salesBy = new Map(sales.map((row) => [row._id.toHexString(), row]));
    const userBy = new Map(users.map((u) => [u._id.toHexString(), u]));
    const profileBy = new Map(profiles.map((p) => [p.userId.toHexString(), p]));
    const ratingBy = new Map(ratings.map((r) => [r._id.toHexString(), r]));
    const history = new Map<
      string,
      { repaid: number; late: number; overdue: number }
    >();
    for (const loan of loans) {
      const key = loan.applicantId.toHexString();
      const entry = history.get(key) ?? { repaid: 0, late: 0, overdue: 0 };
      if (loan.status === LoanStatus.Repaid) entry.repaid += 1;
      for (const instalment of loan.repaymentSchedule ?? []) {
        if (instalment.isPaid) {
          if (instalment.paidAt && instalment.paidAt > instalment.dueDate)
            entry.late += 1;
        } else if (instalment.dueDate < now) {
          entry.overdue += 1;
        }
      }
      history.set(key, entry);
    }

    return new Map(
      subjects.map((subject) => {
        const key = subject.applicantId.toHexString();
        const farmerSales = salesBy.get(key);
        const profile = profileBy.get(key);
        const joined = (userBy.get(key) as { createdAt?: Date } | undefined)
          ?.createdAt;
        const past = history.get(key);
        const rating = ratingBy.get(key);
        return [
          subject.loanId.toHexString(),
          assessCredit({
            requestedAmount: subject.amount,
            durationMonths: subject.durationMonths,
            deliveredOrders: farmerSales?.delivered ?? 0,
            recentRevenue: farmerSales?.recentRevenue ?? 0,
            repeatBuyers: farmerSales?.repeatBuyers ?? 0,
            accountAgeDays: joined
              ? Math.max(
                  0,
                  Math.floor((now.getTime() - joined.getTime()) / DAY_MS),
                )
              : 0,
            repaidLoans: past?.repaid ?? 0,
            lateInstalments: past?.late ?? 0,
            overdueInstalments: past?.overdue ?? 0,
            reviewCount: rating?.count ?? 0,
            averageRating: rating?.average ?? 0,
            hasLandSize: (profile?.landSizeAcres ?? 0) > 0,
            hasLocation: !!profile?.farmLocation?.city,
            hasCrops: (profile?.cropTypes?.length ?? 0) > 0,
            hasBankDetails: !!profile?.bankAccountDetails?.accountNumber,
            hasCertification: (profile?.certifications?.length ?? 0) > 0,
          }),
        ];
      }),
    );
  }
}
