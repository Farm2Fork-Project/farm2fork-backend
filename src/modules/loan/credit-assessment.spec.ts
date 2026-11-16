import { CreditInput, assessCredit } from './credit-assessment';

const base: CreditInput = {
  requestedAmount: 120_000,
  durationMonths: 12,
  deliveredOrders: 0,
  recentRevenue: 0,
  repeatBuyers: 0,
  accountAgeDays: 0,
  repaidLoans: 0,
  lateInstalments: 0,
  overdueInstalments: 0,
  reviewCount: 0,
  averageRating: 0,
  hasLandSize: false,
  hasLocation: false,
  hasCrops: false,
  hasBankDetails: false,
  hasCertification: false,
};

const points = (input: CreditInput, key: string) =>
  assessCredit(input).factors.find((f) => f.key === key)?.points;

describe('assessCredit', () => {
  it('gives a brand-new farmer a weak score with low confidence, not zero knowledge dressed as certainty', () => {
    const result = assessCredit(base);
    expect(result.score).toBe(15); // neutral repayment history + neutral feedback
    expect(result.band).toBe('weak');
    expect(result.confidence).toBe('low');
    expect(result.factors).toHaveLength(6);
    expect(result.factors.reduce((s, f) => s + f.maxPoints, 0)).toBe(100);
  });

  it('scores an established farmer as strong with high confidence', () => {
    const result = assessCredit({
      ...base,
      deliveredOrders: 14,
      recentRevenue: 600_000, // 100k a month against a 10k instalment
      repeatBuyers: 3,
      accountAgeDays: 400,
      repaidLoans: 1,
      reviewCount: 8,
      averageRating: 4.6,
      hasLandSize: true,
      hasLocation: true,
      hasCrops: true,
      hasBankDetails: true,
      hasCertification: true,
    });
    expect(result.score).toBe(96);
    expect(result.band).toBe('strong');
    expect(result.confidence).toBe('high');
  });

  it('weighs sales against the instalment actually requested', () => {
    const sales = { ...base, recentRevenue: 60_000 }; // 10k a month
    expect(points(sales, 'repayment_capacity')).toBe(13); // covers 1.0 times
    expect(
      points({ ...sales, requestedAmount: 480_000 }, 'repayment_capacity'),
    ).toBe(0); // 40k instalment, covered 0.25 times
    expect(points({ ...sales, durationMonths: 36 }, 'repayment_capacity')).toBe(
      25,
    ); // 3.3k instalment, covered 3 times
  });

  it('drops repayment history to zero while an instalment is overdue', () => {
    expect(
      points(
        { ...base, repaidLoans: 2, overdueInstalments: 1 },
        'repayment_history',
      ),
    ).toBe(0);
    expect(points({ ...base, repaidLoans: 2 }, 'repayment_history')).toBe(20);
    expect(
      points(
        { ...base, repaidLoans: 1, lateInstalments: 2 },
        'repayment_history',
      ),
    ).toBe(9);
  });

  it('ignores a rating built on fewer than three reviews', () => {
    expect(
      points({ ...base, reviewCount: 2, averageRating: 1 }, 'buyer_feedback'),
    ).toBe(5);
    expect(
      points({ ...base, reviewCount: 3, averageRating: 1 }, 'buyer_feedback'),
    ).toBe(0);
    expect(
      points({ ...base, reviewCount: 3, averageRating: 5 }, 'buyer_feedback'),
    ).toBe(10);
  });

  it('explains every factor in words a reviewer can read', () => {
    const { factors } = assessCredit({ ...base, deliveredOrders: 1 });
    expect(factors[0].summary).toBe('1 order delivered through Farm2Fork');
    expect(factors[5].summary).toContain('land size');
    expect(factors.every((f) => f.summary.length > 0)).toBe(true);
  });
});
