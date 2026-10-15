import { AdminContentController } from './admin-content.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
it('requires admin role for every content list, detail, and moderation action', () => {
  expect(Reflect.getMetadata(ROLES_KEY, AdminContentController)).toEqual([
    UserRole.Admin,
  ]);
  for (const name of [
    'products',
    'product',
    'productVisibility',
    'orders',
    'order',
    'posts',
    'post',
    'postVisibility',
    'commentVisibility',
  ]) {
    expect(
      typeof AdminContentController.prototype[
        name as keyof AdminContentController
      ],
    ).toBe('function');
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminContentController.prototype[name as keyof AdminContentController],
      ),
    ).toBeUndefined();
  }
});
