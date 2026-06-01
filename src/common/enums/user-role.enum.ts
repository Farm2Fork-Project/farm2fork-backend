export enum UserRole {
  Farmer = 'farmer',
  Buyer = 'buyer',
  Transporter = 'transporter',
  FinancialPartner = 'financial_partner',
  Admin = 'admin',
}

export const AUTHENTICATED_USER_ROLES = [
  UserRole.Farmer,
  UserRole.Buyer,
  UserRole.Transporter,
  UserRole.FinancialPartner,
  UserRole.Admin,
] as const;
