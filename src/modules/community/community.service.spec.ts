import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { BuyerProfile } from '../auth/schemas/buyer-profile.schema';
import { FarmerProfile } from '../auth/schemas/farmer-profile.schema';
import { User } from '../auth/schemas/user.schema';
import { CommunityService } from './community.service';
import { CreatePostDto } from './dto/community.dto';
import { NotificationService } from '../notification/notification.service';
import { Comment, CommentStatus } from './schemas/comment.schema';
import { ContentReport, ReportReason } from './schemas/content-report.schema';
import { PostLike } from './schemas/post-like.schema';
import { Review } from './schemas/review.schema';
import { Post, PostStatus } from './schemas/post.schema';

const chain = (value: unknown) => {
  const q: Record<string, unknown> = {
    exec: jest.fn().mockResolvedValue(value),
  };
  for (const m of ['select', 'lean', 'sort', 'skip', 'limit'])
    q[m] = jest.fn(() => q);
  return q;
};

const authorId = new Types.ObjectId();
const author = {
  id: authorId.toHexString(),
  role: UserRole.Farmer,
  email: 'a@x.pk',
};
const stranger = {
  id: new Types.ObjectId().toHexString(),
  role: UserRole.Buyer,
  email: 'b@x.pk',
};
const admin = {
  id: new Types.ObjectId().toHexString(),
  role: UserRole.Admin,
  email: 'c@x.pk',
};

describe('CreatePostDto', () => {
  it('normalises comma-separated tags and rejects unsafe ones', async () => {
    const dto = plainToInstance(CreatePostDto, {
      title: ' Wheat ',
      content: 'c',
      tags: '#Wheat, sowing,wheat',
    });
    expect(dto.tags).toEqual(['wheat', 'sowing']);
    expect(await validate(dto)).toEqual([]);
    const bad = plainToInstance(CreatePostDto, {
      title: 't',
      content: 'c',
      tags: '<b>x</b>',
    });
    expect((await validate(bad)).map((e) => e.property)).toEqual(['tags']);
  });
});

describe('CommunityService', () => {
  let service: CommunityService;
  let postModel: Record<string, jest.Mock>;
  let commentModel: Record<string, jest.Mock>;
  let storage: Record<string, jest.Mock>;
  let likeModel: Record<string, jest.Mock>;
  let reportModel: Record<string, jest.Mock>;
  const session = {
    withTransaction: jest.fn((fn: () => Promise<unknown>) => fn()),
    endSession: jest.fn(),
  };

  const post = (overrides: Record<string, unknown> = {}) => ({
    _id: new Types.ObjectId(),
    authorId,
    title: 't',
    content: 'c',
    images: [],
    tags: [],
    commentCount: 1,
    status: PostStatus.Published,
    createdAt: new Date(),
    save: jest.fn(),
    ...overrides,
  });

  beforeEach(async () => {
    postModel = {
      findOne: jest.fn(() => chain(post())),
      create: jest.fn((doc: Record<string, unknown>) =>
        Promise.resolve(post(doc)),
      ),
      updateOne: jest.fn(() => chain({ modifiedCount: 1 })),
    };
    commentModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      updateOne: jest.fn(() => chain({ modifiedCount: 1 })),
    };
    likeModel = {
      find: jest.fn(() => chain([])),
      exists: jest.fn(() => ({ session: () => chain(null) })),
      create: jest.fn().mockResolvedValue([{}]),
      deleteOne: jest.fn(() => chain({ deletedCount: 1 })),
    };
    reportModel = { create: jest.fn().mockResolvedValue({}) };
    storage = {
      validate: jest.fn(),
      uploadPublicImage: jest.fn().mockResolvedValue('https://cdn/x.jpg'),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommunityService,
        { provide: getModelToken(Post.name), useValue: postModel },
        { provide: getModelToken(Comment.name), useValue: commentModel },
        {
          provide: getModelToken(User.name),
          useValue: {
            find: jest.fn(() => chain([{ _id: authorId, role: 'farmer' }])),
          },
        },
        {
          provide: getModelToken(FarmerProfile.name),
          useValue: {
            find: jest.fn(() =>
              chain([
                {
                  userId: authorId,
                  farmName: 'Green Valley',
                  farmLocation: { city: 'Multan' },
                },
              ]),
            ),
          },
        },
        {
          provide: getModelToken(BuyerProfile.name),
          useValue: { find: jest.fn(() => chain([])) },
        },
        {
          provide: getConnectionToken(),
          useValue: { startSession: jest.fn().mockResolvedValue(session) },
        },
        { provide: StorageService, useValue: storage },
        { provide: getModelToken(PostLike.name), useValue: likeModel },
        { provide: getModelToken(ContentReport.name), useValue: reportModel },
        {
          provide: getModelToken(Review.name),
          useValue: { aggregate: jest.fn(() => chain([])) },
        },
        {
          provide: NotificationService,
          useValue: { notifyInBackground: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(CommunityService);
  });

  it('publishes a post with uploaded photos under the farm name', async () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff]);
    const result = await service.create(
      author,
      { title: 'Wheat', content: ' hi ', tags: ['wheat'] },
      [{ buffer, size: 3 }],
    );
    expect(storage.validate).toHaveBeenCalledWith(buffer, 'image');
    expect(result).toEqual(
      expect.objectContaining({
        images: ['https://cdn/x.jpg'],
        content: 'hi',
        author: {
          id: author.id,
          name: 'Green Valley',
          role: 'farmer',
          city: 'Multan',
        },
      }),
    );
  });

  it('lets only the author or an admin remove a post', async () => {
    const id = new Types.ObjectId().toHexString();
    await expect(service.remove(id, stranger)).rejects.toThrow(
      'only remove your own',
    );
    const target = post();
    postModel.findOne.mockReturnValue(chain(target));
    await service.remove(id, admin);
    expect(target.status).toBe(PostStatus.Removed);
  });

  it('keeps commentCount in step when a comment is removed, once', async () => {
    const postId = new Types.ObjectId();
    commentModel.findOne.mockReturnValue(
      chain({
        _id: new Types.ObjectId(),
        postId,
        authorId,
        status: CommentStatus.Active,
      }),
    );
    await service.removeComment(
      postId.toHexString(),
      new Types.ObjectId().toHexString(),
      author,
    );
    expect(postModel.updateOne).toHaveBeenCalledWith(
      { _id: postId, commentCount: { $gt: 0 } },
      { $inc: { commentCount: -1 } },
      { session },
    );

    postModel.updateOne.mockClear();
    commentModel.updateOne.mockReturnValue(chain({ modifiedCount: 0 }));
    await service.removeComment(
      postId.toHexString(),
      new Types.ObjectId().toHexString(),
      author,
    );
    expect(postModel.updateOne).not.toHaveBeenCalled();
  });

  it('likes once, counts it, and reports the new state', async () => {
    postModel.findById = jest.fn(() => chain({ likeCount: 1 }));
    const state = await service.like(
      new Types.ObjectId().toHexString(),
      stranger,
    );
    expect(likeModel.create).toHaveBeenCalledTimes(1);
    expect(postModel.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      { $inc: { likeCount: 1 } },
      expect.anything(),
    );
    expect(state).toEqual({ likeCount: 1, likedByMe: true });
  });

  it('does not count a second like from the same member', async () => {
    likeModel.exists = jest.fn(() => ({ session: () => chain({ _id: 1 }) }));
    postModel.findById = jest.fn(() => chain({ likeCount: 1 }));
    await service.like(new Types.ObjectId().toHexString(), stranger);
    expect(likeModel.create).not.toHaveBeenCalled();
    expect(postModel.updateOne).not.toHaveBeenCalled();
  });

  it('files a report once and refuses reports on your own post', async () => {
    const id = new Types.ObjectId().toHexString();
    await service.reportPost(id, stranger, { reason: ReportReason.Spam });
    expect(reportModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: 'post', reason: 'spam' }),
    );
    await expect(
      service.reportPost(id, author, { reason: ReportReason.Spam }),
    ).rejects.toThrow('your own content');
    reportModel.create.mockRejectedValueOnce({ code: 11000 });
    await expect(
      service.reportPost(id, stranger, { reason: ReportReason.Abuse }),
    ).rejects.toThrow('already reported');
  });

  it('lets only the author edit a post', async () => {
    const id = new Types.ObjectId().toHexString();
    await expect(service.update(id, stranger, { title: 'x' })).rejects.toThrow(
      'your own post',
    );
    const mine = post();
    postModel.findOne = jest.fn(() => chain(mine));
    const result = await service.update(id, author, { title: 'New title' });
    expect(mine.save).toHaveBeenCalled();
    expect(result.title).toBe('New title');
    expect(result.editedAt).toBeDefined();
  });
});
