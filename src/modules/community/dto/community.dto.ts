import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
}

export class CreateCommentDto {
  @ApiProperty({ example: 'Early November worked well for us in Multan.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;
}

export class QueryPostsDto {
  @ApiPropertyOptional({ example: 'wheat' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => toTags(value)[0])
  @IsString()
  tag?: string;

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
  @ApiProperty({ enum: ['farmer', 'buyer', 'admin'] }) role!: string;
  @ApiPropertyOptional() city?: string;
}

export class PostResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: CommunityAuthorDto }) author!: CommunityAuthorDto;
  @ApiProperty() title!: string;
  @ApiProperty() content!: string;
  @ApiProperty({ type: [String] }) images!: string[];
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty() commentCount!: number;
  @ApiProperty() createdAt!: string;
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
  @ApiProperty() createdAt!: string;
}
