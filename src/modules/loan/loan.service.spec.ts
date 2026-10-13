import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditLog } from '../admin/schemas/audit-log.schema';
import { SystemConfigService } from '../admin/services/system-config.service';
import { FarmerProfile } from '../auth/schemas/farmer-profile.schema';
import { NotificationService } from '../notification/notification.service';
import { Order } from '../order/schemas/order.schema';
import { LoanDecisionDto } from './dto/loan.dto';
import { LoanService, buildRepaymentSchedule } from './loan.service';
import { LoanApplication, LoanStatus } from './schemas/loan-application.schema';

const chain = (value: unknown) => {
  const q: Record<string, unknown> = {
    exec: jest.fn().mockResolvedValue(value),
  };
  for (const m of ['select', 'lean', 'sort', 'skip', 'limit'])
    q[m] = jest.fn(() => q);
  return q;
};

const farmer = {
  id: new Types.ObjectId().toHexString(),
  role: UserRole.Farmer,
  email: 'f@x.pk',
};
const otherFarmer = {
  id: new Types.ObjectId().toHexString(),
  role: UserRole.Farmer,
  email: 'o@x.pk',
};
const partner = {
  id: new Types.ObjectId().toHexString(),
  role: UserRole.FinancialPartner,
  email: 'p@x.pk',
};
const PDF = Buffer.from('%PDF-1.7');

function makeLoan(overrides: Record<string, unknown> = {}) {
  const loan = {
    _id: new Types.ObjectId(),
    applicantId: new Types.ObjectId(farmer.id),
    amount: 100_000,
    purpose: 'Seeds',
    durationMonths: 3,
    status: LoanStatus.Pending,
    documents: ['local:abc.pdf'],
    repaymentSchedule: [] as Array<Record<string, unknown>>,
    createdAt: new Date(),
    updatedAt: new Date(),
    save: jest.fn(),
    markModified: jest.fn(),
    ...overrides,
  };
  return loan;
}

describe('buildRepaymentSchedule', () => {
  it('splits into whole-rupee monthly instalments that sum to the loan', () => {
    const schedule = buildRepaymentSchedule(
      100_000,
      3,
      new Date('2026-01-31T10:00:00Z'),
    );
    expect(schedule.map((i) => i.amount)).toEqual([33_333, 33_333, 33_334]);
    expect(schedule.reduce((sum, i) => sum + i.amount, 0)).toBe(100_000);
    expect(schedule.every((i) => !i.isPaid)).toBe(true);
    expect(schedule[0].dueDate > new Date('2026-02-01')).toBe(true);
  });
});

describe('LoanDecisionDto', () => {
  it('requires a reason when rejecting, not when approving', async () => {
    const errors = async (body: object) =>
      (await validate(plainToInstance(LoanDecisionDto, body))).map(
        (e) => e.property,
      );
    expect(await errors({ decision: 'rejected' })).toEqual(['note']);
    expect(await errors({ decision: 'approved' })).toEqual([]);
    expect(await errors({ decision: 'repaid' })).toEqual(['decision']);
  });
});

describe('LoanService', () => {
  let service: LoanService;
  let loanModel: Record<string, jest.Mock>;
  let auditLogModel: { create: jest.Mock };
  let storage: Record<string, jest.Mock>;
  let notifications: { notifyInBackground: jest.Mock };

  beforeEach(async () => {
    loanModel = {
      exists: jest.fn(() => chain(null)),
      create: jest.fn((doc: Record<string, unknown>) =>
        Promise.resolve(makeLoan(doc)),
      ),
      findById: jest.fn(),
      findOneAndUpdate: jest.fn(),
      find: jest.fn(),
    };
    auditLogModel = { create: jest.fn() };
    storage = {
      validate: jest.fn(),
      uploadPrivateDocument: jest.fn().mockResolvedValue('local:new.pdf'),
      signedUrl: jest.fn((ref: string) => `/signed/${ref}`),
    };
    notifications = { notifyInBackground: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        LoanService,
        { provide: getModelToken(LoanApplication.name), useValue: loanModel },
        {
          provide: getModelToken(FarmerProfile.name),
          useValue: { find: jest.fn(() => chain([])) },
        },
        {
          provide: getModelToken(Order.name),
          useValue: { aggregate: jest.fn(() => chain([])) },
        },
        { provide: getModelToken(AuditLog.name), useValue: auditLogModel },
        {
          provide: SystemConfigService,
          useValue: {
            getLoanLimits: jest
              .fn()
              .mockResolvedValue({ min: 10_000, max: 500_000 }),
          },
        },
        { provide: StorageService, useValue: storage },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(LoanService);
  });

  describe('apply', () => {
    it('stores documents privately and creates a pending application', async () => {
      const result = await service.apply(
        farmer,
        { amount: 100_000, purpose: ' Seeds ', durationMonths: 6 },
        [{ buffer: PDF, size: PDF.length }],
      );
      expect(storage.uploadPrivateDocument).toHaveBeenCalledWith(
        PDF,
        'loan-documents',
      );
      expect(loanModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'Seeds',
          status: LoanStatus.Pending,
          documents: ['local:new.pdf'],
        }),
      );
      expect(result.documentCount).toBe(1);
      expect(JSON.stringify(result)).not.toContain('local:');
    });

    it.each([
      UserRole.Buyer,
      UserRole.Transporter,
      UserRole.FinancialPartner,
      UserRole.Admin,
    ])('rejects a %s applicant (master context 6.3)', async (role) => {
      await expect(
        service.apply(
          { ...farmer, role },
          { amount: 50_000, purpose: 'x', durationMonths: 3 },
        ),
      ).rejects.toThrow('Only farmers can apply for loans');
    });

    it('enforces the configured amount range', async () => {
      await expect(
        service.apply(farmer, {
          amount: 900_000,
          purpose: 'x',
          durationMonths: 3,
        }),
      ).rejects.toThrow('between Rs 10,000 and Rs 500,000');
    });

    it('allows only one open application', async () => {
      loanModel.exists.mockReturnValue(chain({ _id: new Types.ObjectId() }));
      await expect(
        service.apply(farmer, {
          amount: 50_000,
          purpose: 'x',
          durationMonths: 3,
        }),
      ).rejects.toThrow('already have a loan application');
      expect(storage.uploadPrivateDocument).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('hides another farmer’s application', async () => {
      loanModel.findById.mockReturnValue(chain(makeLoan()));
      await expect(
        service.findOne(new Types.ObjectId().toHexString(), otherFarmer),
      ).rejects.toThrow('Loan application not found');
    });

    it('gives reviewers short-lived document links', async () => {
      loanModel.findById.mockReturnValue(chain(makeLoan()));
      const result = await service.findOne(
        new Types.ObjectId().toHexString(),
        partner,
      );
      expect(result.documents).toEqual([
        { index: 0, url: '/signed/local:abc.pdf' },
      ]);
    });
  });

  describe('review', () => {
    it('approves from review with a schedule, an audit entry and a notification', async () => {
      const id = new Types.ObjectId().toHexString();
      loanModel.findById.mockReturnValue(
        chain(makeLoan({ status: LoanStatus.UnderReview })),
      );
      loanModel.findOneAndUpdate.mockImplementation(
        (_filter: unknown, update: { $set: Record<string, unknown> }) =>
          chain(makeLoan({ ...update.$set })),
      );

      const result = await service.decide(id, partner, {
        decision: LoanStatus.Approved,
      });

      expect(loanModel.findOneAndUpdate.mock.calls[0][0]).toEqual({
        _id: new Types.ObjectId(id),
        status: LoanStatus.UnderReview,
      });
      expect(result.repaymentSchedule).toHaveLength(3);
      expect(auditLogModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'loan.approved',
          targetEntity: 'LoanApplication',
        }),
      );
      expect(
        JSON.stringify(auditLogModel.create.mock.calls[0][0]),
      ).not.toContain('abc.pdf');
      expect(notifications.notifyInBackground).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'loan_update',
          title: 'Loan approved',
        }),
      );
    });

    it('refuses a decision before the review has started', async () => {
      loanModel.findById.mockReturnValue(chain(makeLoan()));
      loanModel.findOneAndUpdate.mockReturnValue(chain(null));
      await expect(
        service.decide(new Types.ObjectId().toHexString(), partner, {
          decision: LoanStatus.Rejected,
          note: 'Insufficient history',
        }),
      ).rejects.toThrow('Start the review before approving or rejecting');
      expect(auditLogModel.create).not.toHaveBeenCalled();
    });

    it('marks the loan repaid when the last instalment is paid', async () => {
      const schedule = buildRepaymentSchedule(90_000, 2, new Date());
      schedule[0].isPaid = true;
      const loan = makeLoan({
        status: LoanStatus.Approved,
        repaymentSchedule: schedule,
      });
      loanModel.findById.mockReturnValue(chain(loan));

      const result = await service.markInstalmentPaid(
        loan._id.toHexString(),
        1,
      );

      expect(result.status).toBe(LoanStatus.Repaid);
      expect(loan.save).toHaveBeenCalled();
    });
  });
});
