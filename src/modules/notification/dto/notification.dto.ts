import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { NotificationType } from '../schemas/notification.schema';

export class RegisterDeviceTokenDto {
  @ApiProperty({ description: 'FCM registration token of this device' })
  @IsString()
  @Length(20, 4096)
  token!: string;
}

export class QueryNotificationsDto {
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

  @ApiPropertyOptional({ description: 'Only unread notifications' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;
}

export class NotificationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: NotificationType }) type!: NotificationType;
  @ApiProperty() title!: string;
  @ApiProperty() message!: string;
  @ApiPropertyOptional() relatedEntityId?: string;
  @ApiPropertyOptional({ example: 'Order' }) relatedEntityModel?: string;
  @ApiProperty() isRead!: boolean;
  @ApiProperty() createdAt!: string;
}

export class NotificationPageDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  data!: NotificationResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() unread!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}

export class UnreadCountDto {
  @ApiProperty() unread!: number;
}
