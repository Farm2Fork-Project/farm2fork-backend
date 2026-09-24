import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { RequestUser } from '../../common/guards/roles.guard';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditLog, AuditLogDocument } from '../admin/schemas/audit-log.schema';
import { SystemConfigService } from '../admin/services/system-config.service';
import {
  FarmerProfile,
  FarmerProfileDocument,
} from '../auth/schemas/farmer-profile.schema';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
} from '../order/schemas/order.schema';
import {
  CreateLoanApplicationDto,
  LoanApplicantDto,
  LoanApplicationResponseDto,
  LoanDecisionDto,
  LoanLimitsDto,
  LoanPageDto,
  MAX_LOAN_DOCUMENTS,
  QueryLoansDto,
} from './dto/loan.dto';
import {
  LoanApplication,
  LoanApplicationDocument,
  LoanStatus,
  RepaymentInstallment,
} from './schemas/loan-application.schema';

export interface UploadedDocument {
  buffer: Buffer;
  size: number;
}

/** A farmer can have only one application in flight or being repaid. */
const OPEN_STATUSES = [
  LoanStatus.Pending,
  LoanStatus.UnderReview,
  LoanStatus.Approved,
];

const REVIEWER_ROLES = [UserRole.FinancialPartner, UserRole.Admin];

/**
 * LoanService (EP-06). Farmers apply (master context 6.3: farmers only);
 * financial partners review, approve with an equal-instalment schedule or
 * reject with a reason, and record repayments. Uploaded documents are
 * private: only short-lived signed links are ever returned, and only on the
 * single-application read.
 */
@Injectable()
export class LoanService {
  constructor(
    @InjectModel(LoanApplication.name)
    private readonly loanModel: Model<LoanApplicationDocument>,
    @InjectModel(FarmerProfile.name)
    private readonly farmerProfileModel: Model<FarmerProfileDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    private readonly systemConfig: SystemConfigService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
  ) {}

  async limits(): Promise<LoanLimitsDto> {
    const { min, max } = await this.systemConfig.getLoanLimits();
    return {
      minAmount: min,
      maxAmount: max,
      maxDurationMonths: 36,
      maxDocuments: MAX_LOAN_DOCUMENTS,
    };
  }

  async apply(
    user: RequestUser,
    dto: CreateLoanApplicationDto,
    files: UploadedDocument[] = [],
  ): Promise<LoanApplicationResponseDto> {
    // Defence in depth for master context 6.3; the route is farmer-only too.
    if (user.role !== UserRole.Farmer) {
      throw new ForbiddenException('Only farmers can apply for loans');
    }
    const { min, max } = await this.systemConfig.getLoanLimits();
    if (dto.amount < min || dto.amount > max) {
      throw new BadRequestException(
        `Loan amount must be between Rs ${min.toLocaleString('en-PK')} and Rs ${max.toLocaleString('en-PK')}`,
      );
    }
    if (files.length > MAX_LOAN_DOCUMENTS) {
      throw new BadRequestException(
        `Attach at most ${MAX_LOAN_DOCUMENTS} documents`,
      );
    }
    const applicantId = new Types.ObjectId(user.id);
    const open = await this.loanModel
      .exists({ applicantId, status: { $in: OPEN_STATUSES } })
      .exec();
    if (open) {
      throw new ConflictException(
        'You already have a loan application in progress or being repaid',
      );
    }
    // Validate every file before uploading any of them.
    files.forEach((file) => this.storage.validate(file.buffer, 'document'));
    const documents: string[] = [];
    for (const file of files) {
      documents.push(
        await this.storage.uploadPrivateDocument(file.buffer, 'loan-documents'),
      );
    }

    const loan = await this.loanModel.create({
      applicantId,
      amount: dto.amount,
      purpose: dto.purpose.trim(),
      durationMonths: dto.durationMonths,
      status: LoanStatus.Pending,
      documents,
    });
    return this.toResponse(loan, { documentCount: documents.length });
  }

  async findMine(farmerId: string): Promise<LoanApplicationResponseDto[]> {
    const loans = await this.loanModel
      .find({ applicantId: new Types.ObjectId(farmerId) })
      .select('+documents')
      .sort({ createdAt: -1 })
      .exec();
    return loans.map((loan) => this.toResponse(loan));
  }

  async findAll(query: QueryLoansDto): Promise<LoanPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: FilterQuery<LoanApplicationDocument> = query.status
      ? { status: query.status }
      : {};
    const [loans, total] = await Promise.all([
      this.loanModel
        .find(filter)
        .select('+documents')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.loanModel.countDocuments(filter).exec(),
    ]);
    const applicants = await this.applicantSummaries(
      loans.map((loan) => loan.applicantId),
    );
    return {
      data: loans.map((loan) =>
        this.toResponse(loan, {
          applicant: applicants.get(loan.applicantId.toHexString()),
        }),
      ),
      total,
      page,
      limit,
    };
  }

  async findOne(
    id: string,
    user: RequestUser,
  ): Promise<LoanApplicationResponseDto> {
    const loan = await this.requireLoan(id);
    const isApplicant = loan.applicantId.toHexString() === user.id;
    const isReviewer = REVIEWER_ROLES.includes(user.role);
    if (!isApplicant && !isReviewer) {
      throw new NotFoundException('Loan application not found');
    }
    const applicant = isReviewer
      ? (await this.applicantSummaries([loan.applicantId])).get(
          loan.applicantId.toHexString(),
        )
      : undefined;
    return this.toResponse(loan, {
      applicant,
      documents: loan.documents.map((ref, index) => ({
        index,
        url: this.storage.signedUrl(ref),
      })),
    });
  }

  async startReview(
    id: string,
    reviewer: RequestUser,
  ): Promise<LoanApplicationResponseDto> {
    const loan = await this.transition(id, LoanStatus.Pending, {
      status: LoanStatus.UnderReview,
      reviewedBy: new Types.ObjectId(reviewer.id),
    });
    this.notifyApplicant(
      loan,
      'Loan application under review',
      `A financial partner is reviewing your Rs ${loan.amount.toLocaleString('en-PK')} application.`,
    );
    return this.toResponse(loan);
  }

  async decide(
    id: string,
    reviewer: RequestUser,
    dto: LoanDecisionDto,
    ipAddress?: string,
  ): Promise<LoanApplicationResponseDto> {
    const before = await this.requireLoan(id);
    const update: Partial<LoanApplication> = {
      status: dto.decision,
      reviewedBy: new Types.ObjectId(reviewer.id),
      reviewNote: dto.note?.trim(),
    };
    if (dto.decision === LoanStatus.Approved) {
      update.repaymentSchedule = buildRepaymentSchedule(
        before.amount,
        before.durationMonths,
        new Date(),
      );
    }
    const loan = await this.transition(id, LoanStatus.UnderReview, update);

    await this.auditLogModel.create({
      actorId: new Types.ObjectId(reviewer.id),
      actorRole: reviewer.role,
      action: `loan.${dto.decision}`,
      targetEntity: 'LoanApplication',
      targetId: loan._id,
      // Status and amounts only: never documents (master context 6.6).
      metadata: {
        before: { status: before.status },
        after: { status: loan.status, amount: loan.amount },
      },
      ipAddress,
    });

    const amount = `Rs ${loan.amount.toLocaleString('en-PK')}`;
    if (dto.decision === LoanStatus.Approved) {
      const first = loan.repaymentSchedule[0];
      this.notifyApplicant(
        loan,
        'Loan approved',
        `Your ${amount} loan was approved. ${loan.durationMonths} monthly instalment(s) of about Rs ${first.amount.toLocaleString('en-PK')}, first due ${first.dueDate.toISOString().slice(0, 10)}.`,
      );
    } else {
      this.notifyApplicant(
        loan,
        'Loan application not approved',
        `Your ${amount} application was not approved: ${loan.reviewNote}`,
      );
    }
    return this.toResponse(loan);
  }

  async markInstalmentPaid(
    id: string,
    index: number,
  ): Promise<LoanApplicationResponseDto> {
    const loan = await this.requireLoan(id);
    if (loan.status !== LoanStatus.Approved) {
      throw new ConflictException(
        'Repayments can only be recorded on approved loans',
      );
    }
    const instalment = loan.repaymentSchedule[index];
    if (!instalment) throw new NotFoundException('Instalment not found');
    if (instalment.isPaid) return this.toResponse(loan);

    instalment.isPaid = true;
    instalment.paidAt = new Date();
    const repaid = loan.repaymentSchedule.every((i) => i.isPaid);
    if (repaid) loan.status = LoanStatus.Repaid;
    loan.markModified('repaymentSchedule');
    await loan.save();

    this.notifyApplicant(
      loan,
      repaid ? 'Loan fully repaid' : 'Repayment recorded',
      repaid
        ? `All instalments of your Rs ${loan.amount.toLocaleString('en-PK')} loan are paid. Thank you!`
        : `Instalment ${index + 1} of ${loan.repaymentSchedule.length} (Rs ${instalment.amount.toLocaleString('en-PK')}) is recorded as paid.`,
    );
    return this.toResponse(loan);
  }

  // --- internals ------------------------------------------------------------

  /** Atomic status change guarded on the expected current status. */
  private async transition(
    id: string,
    from: LoanStatus,
    update: Partial<LoanApplication>,
  ): Promise<LoanApplicationDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Loan application not found');
    }
    const loan = await this.loanModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), status: from },
        { $set: update },
        { new: true },
      )
      .select('+documents')
      .exec();
    if (loan) return loan;
    await this.requireLoan(id);
    throw new ConflictException(
      from === LoanStatus.Pending
        ? 'Only pending applications can be taken into review'
        : 'Start the review before approving or rejecting',
    );
  }

  private async requireLoan(id: string): Promise<LoanApplicationDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Loan application not found');
    }
    const loan = await this.loanModel.findById(id).select('+documents').exec();
    if (!loan) throw new NotFoundException('Loan application not found');
    return loan;
  }

  /** What a reviewer needs to judge the farm, without any sensitive field. */
  private async applicantSummaries(
    applicantIds: Types.ObjectId[],
  ): Promise<Map<string, LoanApplicantDto>> {
    if (applicantIds.length === 0) return new Map();
    const [profiles, sales] = await Promise.all([
      this.farmerProfileModel
        .find({ userId: { $in: applicantIds } })
        .select('userId farmName farmLocation landSizeAcres cropTypes')
        .lean()
        .exec(),
      this.orderModel
        .aggregate<{ _id: Types.ObjectId; count: number; revenue: number }>([
          {
            $match: {
              farmerId: { $in: applicantIds },
              status: OrderStatus.Delivered,
            },
          },
          {
            $group: {
              _id: '$farmerId',
              count: { $sum: 1 },
              revenue: { $sum: '$totalAmount' },
            },
          },
        ])
        .exec(),
    ]);
    const salesByFarmer = new Map(sales.map((s) => [s._id.toHexString(), s]));
    return new Map(
      profiles.map((profile) => {
        const key = profile.userId.toHexString();
        const farmerSales = salesByFarmer.get(key);
        return [
          key,
          {
            farmName: profile.farmName,
            city: profile.farmLocation?.city,
            province: profile.farmLocation?.province,
            landSizeAcres: profile.landSizeAcres,
            cropTypes: profile.cropTypes ?? [],
            deliveredOrders: farmerSales?.count ?? 0,
            deliveredRevenue: farmerSales?.revenue ?? 0,
          },
        ];
      }),
    );
  }

  private notifyApplicant(
    loan: LoanApplicationDocument,
    title: string,
    message: string,
  ): void {
    this.notifications.notifyInBackground({
      userIds: [loan.applicantId],
      type: NotificationType.LoanUpdate,
      title,
      message,
      relatedEntityId: loan._id,
      relatedEntityModel: 'LoanApplication',
    });
  }

  private toResponse(
    loan: LoanApplicationDocument,
    extra: Partial<LoanApplicationResponseDto> = {},
  ): LoanApplicationResponseDto {
    return {
      id: loan._id.toHexString(),
      applicantId: loan.applicantId.toHexString(),
      amount: loan.amount,
      purpose: loan.purpose,
      durationMonths: loan.durationMonths,
      status: loan.status,
      reviewNote: loan.reviewNote,
      documentCount: loan.documents?.length ?? 0,
      repaymentSchedule: loan.repaymentSchedule.map((instalment, index) => ({
        index,
        dueDate: instalment.dueDate.toISOString(),
        amount: instalment.amount,
        isPaid: instalment.isPaid,
        paidAt: instalment.paidAt?.toISOString(),
      })),
      createdAt: loan.createdAt.toISOString(),
      updatedAt: loan.updatedAt.toISOString(),
      ...extra,
    };
  }
}

/**
 * Equal monthly instalments in whole rupees, the last one absorbing the
 * rounding remainder, due on the same day of each following month. The
 * schema has no interest rate, so none is applied.
 */
export function buildRepaymentSchedule(
  amount: number,
  months: number,
  approvedAt: Date,
): RepaymentInstallment[] {
  const base = Math.floor(amount / months);
  return Array.from({ length: months }, (_, i) => {
    const dueDate = new Date(approvedAt);
    dueDate.setUTCMonth(dueDate.getUTCMonth() + i + 1);
    return {
      dueDate,
      amount: i === months - 1 ? amount - base * (months - 1) : base,
      isPaid: false,
    };
  });
}
