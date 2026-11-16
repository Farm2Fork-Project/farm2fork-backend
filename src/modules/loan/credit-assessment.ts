/**
 * Farm2Fork credit assessment (EP-06).
 *
 * A transparent, rule-based score built only from what the platform itself
 * has observed about a farmer: completed sales, earnings against the
 * requested instalment, earlier loans, buyer reviews, account standing and
 * profile completeness. It is advisory. The lending decision stays with the
 * reviewing institution, and every point is explained by a factor so a
 * reviewer can see why the number is what it is.
 *
 * Pure function on purpose: no I/O, so it is cheap to test and to audit.
 */

export const CREDIT_MODEL_VERSION = 'f2f-credit-v1';

export type CreditBand = 'strong' | 'fair' | 'limited' | 'weak';
export type CreditConfidence = 'high' | 'medium' | 'low';
export type CreditFactorKey =
  | 'sales_history'
  | 'repayment_capacity'
  | 'repayment_history'
  | 'buyer_feedback'
  | 'account_standing'
  | 'profile_completeness';

export interface CreditInput {
  requestedAmount: number;
  durationMonths: number;
  /** Orders delivered through the platform, all time. */
  deliveredOrders: number;
  /** Item revenue (PKR) from orders delivered in the last 180 days. */
  recentRevenue: number;
  /** Buyers who ordered more than once. */
  repeatBuyers: number;
  accountAgeDays: number;
  /** Earlier loans fully repaid. */
  repaidLoans: number;
  /** Instalments on any loan that were paid after their due date. */
  lateInstalments: number;
  /** Instalments past due and still unpaid today. */
  overdueInstalments: number;
  reviewCount: number;
  /** Mean buyer rating from 1 to 5; ignored when reviewCount is 0. */
  averageRating: number;
  hasLandSize: boolean;
  hasLocation: boolean;
  hasCrops: boolean;
  hasBankDetails: boolean;
  hasCertification: boolean;
}

export interface CreditFactor {
  key: CreditFactorKey;
  points: number;
  maxPoints: number;
  /** Plain-English reason for the points, safe to show a reviewer. */
  summary: string;
}

export interface CreditAssessment {
  score: number;
  band: CreditBand;
  /** How much platform history stands behind the score. */
  confidence: CreditConfidence;
  factors: CreditFactor[];
  modelVersion: string;
}

const RECENT_MONTHS = 6;
const MIN_REVIEWS_FOR_RATING = 3;

const pkr = (value: number) =>
  `Rs ${Math.round(value).toLocaleString('en-PK')}`;
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

function salesHistory(input: CreditInput): CreditFactor {
  const n = input.deliveredOrders;
  const points = n > 10 ? 25 : n >= 6 ? 20 : n >= 3 ? 14 : n >= 1 ? 8 : 0;
  return {
    key: 'sales_history',
    points,
    maxPoints: 25,
    summary:
      n === 0
        ? 'No delivered orders on Farm2Fork yet'
        : `${plural(n, 'order')} delivered through Farm2Fork`,
  };
}

function repaymentCapacity(input: CreditInput): CreditFactor {
  const instalment = input.requestedAmount / Math.max(1, input.durationMonths);
  const monthlyRevenue = input.recentRevenue / RECENT_MONTHS;
  const cover = instalment > 0 ? monthlyRevenue / instalment : 0;
  const points =
    cover >= 3 ? 25 : cover >= 2 ? 20 : cover >= 1 ? 13 : cover >= 0.5 ? 6 : 0;
  return {
    key: 'repayment_capacity',
    points,
    maxPoints: 25,
    summary:
      monthlyRevenue === 0
        ? `No platform sales in the last ${RECENT_MONTHS} months to set against a ${pkr(instalment)} monthly instalment`
        : `Average monthly sales of ${pkr(monthlyRevenue)} cover the ${pkr(instalment)} instalment ${cover.toFixed(1)} times`,
  };
}

function repaymentHistory(input: CreditInput): CreditFactor {
  const maxPoints = 20;
  if (input.overdueInstalments > 0) {
    return {
      key: 'repayment_history',
      points: 0,
      maxPoints,
      summary: `${plural(input.overdueInstalments, 'instalment')} currently overdue`,
    };
  }
  if (input.repaidLoans === 0 && input.lateInstalments === 0) {
    return {
      key: 'repayment_history',
      points: 10,
      maxPoints,
      summary: 'No earlier Farm2Fork loan, so neither a good nor a bad record',
    };
  }
  const earned = Math.min(maxPoints, 14 + input.repaidLoans * 3);
  const points = Math.max(0, earned - input.lateInstalments * 4);
  const late =
    input.lateInstalments === 0
      ? 'every instalment on time'
      : `${plural(input.lateInstalments, 'instalment')} paid late`;
  return {
    key: 'repayment_history',
    points,
    maxPoints,
    summary: `${plural(input.repaidLoans, 'earlier loan')} repaid, ${late}`,
  };
}

function buyerFeedback(input: CreditInput): CreditFactor {
  const maxPoints = 10;
  if (input.reviewCount < MIN_REVIEWS_FOR_RATING) {
    return {
      key: 'buyer_feedback',
      points: 5,
      maxPoints,
      summary:
        input.reviewCount === 0
          ? 'No buyer reviews yet'
          : `Only ${plural(input.reviewCount, 'buyer review')}, too few to weigh`,
    };
  }
  const rating = Math.min(5, Math.max(1, input.averageRating));
  return {
    key: 'buyer_feedback',
    points: Math.round(((rating - 1) / 4) * maxPoints),
    maxPoints,
    summary: `Rated ${rating.toFixed(1)} out of 5 across ${input.reviewCount} buyer reviews`,
  };
}

function accountStanding(input: CreditInput): CreditFactor {
  const days = input.accountAgeDays;
  const tenure = days >= 180 ? 6 : days >= 90 ? 4 : days >= 30 ? 2 : 0;
  const loyalty = Math.min(4, input.repeatBuyers * 2);
  const months = Math.floor(days / 30);
  return {
    key: 'account_standing',
    points: tenure + loyalty,
    maxPoints: 10,
    summary: `Member for ${months < 1 ? 'under a month' : plural(months, 'month')}, ${plural(input.repeatBuyers, 'repeat buyer')}`,
  };
}

function profileCompleteness(input: CreditInput): CreditFactor {
  const parts: [boolean, number, string][] = [
    [input.hasLandSize, 3, 'land size'],
    [input.hasLocation, 2, 'farm location'],
    [input.hasCrops, 2, 'crops'],
    [input.hasBankDetails, 2, 'bank account'],
    [input.hasCertification, 1, 'certification'],
  ];
  const missing = parts.filter(([present]) => !present).map(([, , n]) => n);
  return {
    key: 'profile_completeness',
    points: parts.reduce((sum, [present, pts]) => sum + (present ? pts : 0), 0),
    maxPoints: 10,
    summary:
      missing.length === 0
        ? 'Farm profile is complete'
        : `Missing from the farm profile: ${missing.join(', ')}`,
  };
}

export function assessCredit(input: CreditInput): CreditAssessment {
  const factors = [
    salesHistory(input),
    repaymentCapacity(input),
    repaymentHistory(input),
    buyerFeedback(input),
    accountStanding(input),
    profileCompleteness(input),
  ];
  const score = factors.reduce((sum, factor) => sum + factor.points, 0);
  const band: CreditBand =
    score >= 75
      ? 'strong'
      : score >= 55
        ? 'fair'
        : score >= 35
          ? 'limited'
          : 'weak';
  const confidence: CreditConfidence =
    input.deliveredOrders >= 6 && input.accountAgeDays >= 90
      ? 'high'
      : input.deliveredOrders >= 2
        ? 'medium'
        : 'low';
  return {
    score,
    band,
    confidence,
    factors,
    modelVersion: CREDIT_MODEL_VERSION,
  };
}
