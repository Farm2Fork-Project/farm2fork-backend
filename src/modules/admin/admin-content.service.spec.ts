import { AdminContentService } from './admin-content.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
const id = new Types.ObjectId().toString();
const actor = {
  id: new Types.ObjectId().toString(),
  role: UserRole.Admin,
  email: 'admin@test.com',
};
function fixture(current: Record<string, unknown> | null) {
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<void>) => fn()),
    endSession: jest.fn(),
  };
  const model = {
    findOneAndUpdate: jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(current) }),
    }),
  };
  const audit = { create: jest.fn() };
  const service = new AdminContentService(
    model as never,
    {} as never,
    model as never,
    model as never,
    audit as never,
    { startSession: () => Promise.resolve(session) } as never,
  );
  return { service, model, audit, session };
}
it('rejects invalid ids before touching models', async () => {
  const { service, model } = fixture(null);
  await expect(
    service.visibility(
      'product',
      'invalid',
      { hidden: true, reason: 'Reported inaccurate information' },
      actor,
    ),
  ).rejects.toBeInstanceOf(BadRequestException);
  expect(model.findOneAndUpdate).not.toHaveBeenCalled();
});
it('writes moderation and its reason in one transaction without editing farmer status', async () => {
  const { service, model, audit, session } = fixture({
    _id: id,
    adminHidden: true,
  });
  await service.visibility(
    'product',
    id,
    { hidden: true, reason: 'Reported inaccurate information' },
    actor,
  );
  expect(model.findOneAndUpdate).toHaveBeenCalledWith(
    { _id: new Types.ObjectId(id), adminHidden: { $ne: true } },
    { $set: { adminHidden: true } },
    { new: true, session },
  );
  expect(audit.create).toHaveBeenCalledWith(
    [
      expect.objectContaining({
        action: 'product.hidden',
        metadata: {
          before: { hidden: false },
          after: { hidden: true, reason: 'Reported inaccurate information' },
        },
      }),
    ],
    { session },
  );
  expect(session.endSession).toHaveBeenCalled();
});
it('stale visibility actions conflict without audit writes', async () => {
  const { service, audit } = fixture(null);
  await expect(
    service.visibility(
      'post',
      id,
      { hidden: true, reason: 'Content violates community rules' },
      actor,
    ),
  ).rejects.toBeInstanceOf(ConflictException);
  expect(audit.create).not.toHaveBeenCalled();
});
it('rejects unsupported statuses instead of querying a fabricated review queue', async () => {
  const { service } = fixture(null);
  await expect(
    service.products({ status: 'under_review' }),
  ).rejects.toBeInstanceOf(BadRequestException);
  await expect(service.posts({ status: 'reported' })).rejects.toBeInstanceOf(
    BadRequestException,
  );
});
it('paginated product search escapes user text and uses matching count filters', async () => {
  const chain = {
    select: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([{ _id: id, name: 'Rice (premium)' }]),
  };
  const model = {
    find: jest.fn().mockReturnValue(chain),
    countDocuments: jest.fn().mockResolvedValue(41),
  };
  const service = new AdminContentService(
    model as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const result = await service.products({
    page: 2,
    limit: 20,
    search: '(premium)',
    visibility: 'hidden',
  });
  expect(result).toMatchObject({
    page: 2,
    limit: 20,
    total: 41,
    items: [{ id, name: 'Rice (premium)' }],
  });
  expect(chain.skip).toHaveBeenCalledWith(20);
  expect(chain.limit).toHaveBeenCalledWith(20);
  const filter = model.find.mock.calls[0][0];
  expect(filter.adminHidden).toBe(true);
  expect(filter.$or[0].name.source).toBe('\\(premium\\)');
  expect(model.countDocuments).toHaveBeenCalledWith(filter);
});
it('an audit failure rejects the transaction and releases its session', async () => {
  const { service, audit, session } = fixture({ _id: id, adminHidden: true });
  audit.create.mockRejectedValue(new Error('Audit store unavailable'));
  await expect(
    service.visibility(
      'product',
      id,
      { hidden: true, reason: 'Incorrect crop details' },
      actor,
    ),
  ).rejects.toThrow('Audit store unavailable');
  expect(session.endSession).toHaveBeenCalled();
});
