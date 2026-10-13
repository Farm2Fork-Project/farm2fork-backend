import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../common/enums/user-role.enum';

/** Public-safe view of a user - never includes FCM token data. */
export class AuthUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty({ required: false })
  phone?: string;

  @ApiProperty({ required: false, description: "The person's own name." })
  fullName?: string;

  @ApiProperty({
    required: false,
    description:
      '256px square avatar served by the Cloudinary CDN (root-relative in local development). Absent when the user has none.',
  })
  avatarUrl?: string;

  @ApiProperty()
  isVerified!: boolean;

  @ApiProperty()
  isActive!: boolean;
}

export class AuthResultDto {
  @ApiProperty({ description: 'JWT bearer token' })
  accessToken!: string;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}
