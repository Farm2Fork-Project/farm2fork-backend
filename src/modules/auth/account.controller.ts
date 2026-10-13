import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Patch,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/decorators/api-error-responses.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/guards/roles.guard';
import { AvatarRateLimit } from '../../common/rate-limit/rate-limits';
import { MAX_IMAGE_BYTES } from '../../infrastructure/storage/file-kind';
import { AccountService } from './account.service';
import { ProfileResponseDto, UpdateProfileDto } from './dto/profile.dto';

/** Self-service profile for every signed-in role. */
@ApiTags('Auth')
@ApiBearerAuth('JWT-auth')
@Controller('auth/me')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('profile')
  @ApiOperation({
    summary: 'The signed-in user with their role profile',
    description:
      'Includes the best display name, the avatar URL and the role-specific details. CNIC is returned masked and is read-only.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiErrorResponses(401)
  profile(@CurrentUser() user: RequestUser): Promise<ProfileResponseDto> {
    return this.accountService.getProfile(user.id);
  }

  @Patch('profile')
  @ApiOperation({
    summary: 'Edit the signed-in user profile',
    description:
      'Send only the fields that changed. Role-specific fields are rejected for other roles. Email and CNIC cannot be changed. The farm pickup location has its own endpoint (PATCH /farmers/me/farm-location).',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiErrorResponses(400, 401)
  updateProfile(
    @CurrentUser() user: RequestUser,
    @Body() body: UpdateProfileDto,
    @Ip() ip: string,
  ): Promise<ProfileResponseDto> {
    return this.accountService.updateProfile(user, body, ip);
  }

  @Put('avatar')
  @AvatarRateLimit()
  @UseInterceptors(
    FileInterceptor('file', {
      // Hard cap before the body is buffered; the service re-checks the type.
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Set the profile photo',
    description:
      'Upload a JPEG, PNG or WebP up to 5 MB, ideally already cropped square by the client. Stored in Cloudinary; only its delivery path is kept in the database. Replaces any previous photo.',
  })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiErrorResponses(400, 401, 413, 429)
  setAvatar(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Ip() ip: string,
  ): Promise<ProfileResponseDto> {
    if (!file) throw new BadRequestException('A file is required');
    return this.accountService.setAvatar(user, file.buffer, ip);
  }

  @Delete('avatar')
  @AvatarRateLimit()
  @ApiOperation({ summary: 'Remove the profile photo' })
  @ApiOkResponse({ type: ProfileResponseDto })
  @ApiErrorResponses(401, 429)
  removeAvatar(
    @CurrentUser() user: RequestUser,
    @Ip() ip: string,
  ): Promise<ProfileResponseDto> {
    return this.accountService.removeAvatar(user, ip);
  }
}
