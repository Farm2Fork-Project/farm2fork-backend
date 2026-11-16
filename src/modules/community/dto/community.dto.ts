import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { ReportReason } from '../schemas/content-report.schema';
import { PostKind } from '../schemas/post.schema';

export const MAX_POST_IMAGES = 4;
export const MAX_POST_TAGS = 5;

/** Normalises tags from a JSON array, CSV string or repeated form fields. */
function toTags(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return [
    ...new Set(
      raw
        .map((tag) => String(tag).trim().toLowerCase().replace(/^#/, ''))
        .filter(Boolean),
    ),
  ];
}

/** Multipart form fields; images arrive as files. */
export class CreatePostDto {
  @ApiProperty({ example: 'Best time to sow wheat in South Punjab?' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(140)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  title!: string;

  @ApiProperty({ example: 'Planning to sow after cotton picking. Advice?' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['wheat', 'sowing'],
    description: 'Up to 5 tags (letters, digits, dashes)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toTags(value))
  @IsArray()
  @ArrayMaxSize(MAX_POST_TAGS)
  @Matches(/^[\p{L}\p{N}-]{1,30}$/u, {
    each: true,
    message: 'Tags may only contain letters, digits and dashes',
  })
  tags?: string[];

  @ApiPropertyOptional({ enum: PostKind, default: PostKind.Discussion })
  @IsOptional()
  @IsEnum(PostKind)
  kind?: PostKind;
}

/** Author edits: only the fields sent are changed. Photos are not editable. */
export class UpdatePostDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(140)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toTags(value))
  @IsArray()
  @ArrayMaxSize(MAX_POST_TAGS)
  @Matches(/^[\p{L}\p{N}-]{1,30}$/u, {
    each: true,
    message: 'Tags may only contain letters, digits and dashes',
  })
  tags?: string[];

  @ApiPropertyOptional({ enum: PostKind })
  @IsOptional()
  @IsEnum(PostKind)
  kind?: PostKind;
}

export class ReportContentDto {
  @ApiProperty({ enum: ReportReason })
  @IsEnum(ReportReason)
  reason!: ReportReason;

  @ApiPropertyOptional({ description: "What is wrong, in the member's words" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateCommentDto {
  @ApiProperty({ example: 'Early November worked well for us in Multan.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;

  @ApiPropertyOptional({
    description: 'Reply to this comment on the same post',
  })
  @IsOptional()
  @IsMongoId()
  parentCommentId?: string;
}

export class QueryPostsDto {
  @ApiPropertyOptional({ example: 'wheat' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toTags(value)[0])
  @IsString()
  tag?: string;

  @ApiPropertyOptional({ enum: PostKind })
  @IsOptional()
  @IsEnum(PostKind)
  kind?: PostKind;

  @ApiPropertyOptional({ description: 'Words to find in the title or text' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ enum: ['new', 'top'], default: 'new' })
  @IsOptional()
  @IsIn(['new', 'top'])
  sort?: 'new' | 'top';

  @ApiPropertyOptional({ description: 'Only posts by this user' })
  @IsOptional()
  @IsMongoId()
  authorId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class CommunityAuthorDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'Farm or business name' }) name!: string;
  @ApiProperty({ enum: ['farmer', 'buyer', 'transporter', 'admin'] })
  role!: string;
  @ApiPropertyOptional() city?: string;
}

export class PostResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: CommunityAuthorDto }) author!: CommunityAuthorDto;
  @ApiProperty() title!: string;
  @ApiProperty() content!: string;
  @ApiProperty({ type: [String] }) images!: string[];
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty({ enum: PostKind }) kind!: PostKind;
  @ApiProperty() commentCount!: number;
  @ApiProperty() likeCount!: number;
  @ApiProperty({ description: 'Whether the signed-in member liked it' })
  likedByMe!: boolean;
  @ApiPropertyOptional() editedAt?: string;
  @ApiProperty() createdAt!: string;
}

export class LikeStateDto {
  @ApiProperty() likeCount!: number;
  @ApiProperty() likedByMe!: boolean;
}

export class TagCountDto {
  @ApiProperty() tag!: string;
  @ApiProperty() count!: number;
}

export class MemberProfileDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() role!: string;
  @ApiPropertyOptional() city?: string;
  @ApiProperty() joinedAt!: string;
  @ApiProperty() postCount!: number;
  @ApiPropertyOptional({ description: 'Farmers only: mean buyer rating' })
  averageRating?: number;
  @ApiPropertyOptional({ description: 'Farmers only' })
  reviewCount?: number;
}

export class PostPageDto {
  @ApiProperty({ type: [PostResponseDto] }) data!: PostResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}

export class CommentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() postId!: string;
  @ApiProperty({ type: CommunityAuthorDto }) author!: CommunityAuthorDto;
  @ApiProperty() content!: string;
  @ApiPropertyOptional() parentCommentId?: string;
  @ApiProperty() createdAt!: string;
}
