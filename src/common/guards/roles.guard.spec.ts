import { beforeEach, describe, expect, jest, it } from '@jest/globals';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../enums/user-role.enum';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;

  const guard = new RolesGuard(reflector);

  const createContext = (user?: { role: UserRole }) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows access when no roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(createContext())).toBe(true);
  });

  it('rejects unauthenticated users when roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.Buyer]);

    expect(() => guard.canActivate(createContext())).toThrow(
      'Authentication required',
    );
  });

  it('allows matching roles', () => {
    reflector.getAllAndOverride.mockReturnValue([
      UserRole.Buyer,
      UserRole.Farmer,
    ]);

    expect(guard.canActivate(createContext({ role: UserRole.Farmer }))).toBe(
      true,
    );
  });

  it('rejects non-matching roles', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.Admin]);

    expect(guard.canActivate(createContext({ role: UserRole.Buyer }))).toBe(
      false,
    );
  });
});
