import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/decorators/api-error-responses.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { RequestUser } from '../../common/guards/roles.guard';
import { MAX_IMAGE_BYTES } from '../../infrastructure/storage/file-kind';
import { CommunityService, UploadedImage } from './community.service';
import {
  CommentResponseDto,
  CreateCommentDto,
  CreatePostDto,
  MAX_POST_IMAGES,
  PostPageDto,
  PostResponseDto,
  QueryPostsDto,
} from './dto/community.dto';

/** Posts are written by farmers and buyers (master context 5.13). */
const AUTHORS = [UserRole.Farmer, UserRole.Buyer];
const READERS = [...AUTHORS, UserRole.Transporter, UserRole.Admin];

@ApiTags('Community')
@ApiBearerAuth('JWT-auth')
@Controller('community/posts')
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  @Get()
  @Roles(...READERS)
  @ApiOperation({ summary: 'Community feed, newest first (US-13)' })
  @ApiOkResponse({ type: PostPageDto })
  @ApiErrorResponses(400, 401, 403)
  list(@Query() query: QueryPostsDto): Promise<PostPageDto> {
    return this.community.list(query);
  }

  @Post()
  @Roles(...AUTHORS)
  @UseInterceptors(
    FilesInterceptor('images', MAX_POST_IMAGES, {
      limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_POST_IMAGES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: { type: 'string', maxLength: 140 },
        content: { type: 'string', maxLength: 5000 },
        tags: { type: 'string', description: 'Comma-separated, up to 5' },
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Up to 4 JPEG/PNG/WebP photos, 5 MB each',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Share a post (farmers and buyers)' })
  @ApiCreatedResponse({ type: PostResponseDto })
  @ApiErrorResponses(400, 401, 403, 413)
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePostDto,
    @UploadedFiles() images?: UploadedImage[],
  ): Promise<PostResponseDto> {
    return this.community.create(user, dto, images);
  }

  @Get(':id')
  @Roles(...READERS)
  @ApiOperation({ summary: 'One post' })
  @ApiOkResponse({ type: PostResponseDto })
  @ApiErrorResponses(401, 403, 404)
  findOne(@Param('id') id: string): Promise<PostResponseDto> {
    return this.community.findOne(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(...AUTHORS, UserRole.Admin)
  @ApiOperation({ summary: 'Remove a post (its author or an admin)' })
  @ApiNoContentResponse()
  @ApiErrorResponses(401, 403, 404)
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.community.remove(id, user);
  }

  @Get(':id/comments')
  @Roles(...READERS)
  @ApiOperation({ summary: 'Comments on a post, oldest first (US-14)' })
  @ApiOkResponse({ type: [CommentResponseDto] })
  @ApiErrorResponses(401, 403, 404)
  comments(@Param('id') id: string): Promise<CommentResponseDto[]> {
    return this.community.listComments(id);
  }

  @Post(':id/comments')
  @Roles(...AUTHORS)
  @ApiOperation({ summary: 'Comment on a post (farmers and buyers)' })
  @ApiCreatedResponse({ type: CommentResponseDto })
  @ApiErrorResponses(400, 401, 403, 404)
  addComment(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    return this.community.addComment(id, user, dto);
  }

  @Delete(':id/comments/:commentId')
  @HttpCode(204)
  @Roles(...AUTHORS, UserRole.Admin)
  @ApiOperation({ summary: 'Remove a comment (its author or an admin)' })
  @ApiNoContentResponse()
  @ApiErrorResponses(401, 403, 404)
  async removeComment(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
  ): Promise<void> {
    await this.community.removeComment(id, commentId, user);
  }
}
