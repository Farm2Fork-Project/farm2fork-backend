import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from '../../../common/validators/password.validator';

/** POST /auth/password-reset/request - US-03. */
export class RequestPasswordResetDto {
  @ApiProperty({ example: 'farmer@example.com' })
  @IsEmail()
  email!: string;
}

/** POST /auth/password-reset/confirm - US-03. */
export class ConfirmPasswordResetDto {
  @ApiProperty({ description: 'Reset token delivered to the user' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'NewStrongP@ss1' })
  @IsStrongPassword()
  newPassword!: string;
}
