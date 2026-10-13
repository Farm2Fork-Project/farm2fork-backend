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
import { Comment, CommentStatus } from './schemas/comment.schema';
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
});
