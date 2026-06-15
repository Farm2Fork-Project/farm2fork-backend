import { UserRole } from '../../../common/enums/user-role.enum';

export interface JwtPayload {
  /** Subject - the user's _id. */
  sub: string;
  email: string;
  role: UserRole;
}
