import {
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Patch,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Model, Types } from 'mongoose';
import { ApiErrorResponses } from '../../common/decorators/api-error-responses.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { RequestUser } from '../../common/guards/roles.guard';
import { hasCoordinates } from '../../common/geo/geo';
import { FarmLocationDto } from './dto/register.dto';
import {
  FarmerProfile,
  FarmerProfileDocument,
} from './schemas/farmer-profile.schema';

export class FarmLocationResponseDto {
  @ApiPropertyOptional()
  address?: string;

  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional()
  province?: string;

  @ApiPropertyOptional()
  lat?: number;

  @ApiPropertyOptional()
  lng?: number;

  @ApiProperty({
    description:
      'False when address, city, province or the map pin is missing - buyers cannot check out and transporters cannot be matched until it is completed.',
  })
  complete!: boolean;
}

@Injectable()
export class FarmerProfileService {
  constructor(
    @InjectModel(FarmerProfile.name)
    private readonly farmerProfileModel: Model<FarmerProfileDocument>,
  ) {}

  async getLocation(farmerId: string): Promise<FarmLocationResponseDto> {
    const profile = await this.farmerProfileModel
      .findOne({ userId: new Types.ObjectId(farmerId) })
      .select('farmLocation')
      .lean()
      .exec();
    if (!profile) throw new NotFoundException('Farmer profile not found');
    return toResponse(profile.farmLocation);
  }

  async updateLocation(
    farmerId: string,
    location: FarmLocationDto,
  ): Promise<FarmLocationResponseDto> {
    const farmLocation = {
      address: location.address.trim(),
      city: location.city.trim(),
      province: location.province,
      lat: location.lat,
      lng: location.lng,
    };
    const updated = await this.farmerProfileModel
      .findOneAndUpdate(
        { userId: new Types.ObjectId(farmerId) },
        { $set: { farmLocation } },
        { new: true },
      )
      .select('farmLocation')
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('Farmer profile not found');
    return toResponse(updated.farmLocation);
  }
}

function toResponse(
  location: FarmerProfile['farmLocation'] | undefined,
): FarmLocationResponseDto {
  const address = location?.address?.trim() || undefined;
  const city = location?.city?.trim() || undefined;
  const province = location?.province?.trim() || undefined;
  const pinned = hasCoordinates(location);
  return {
    address,
    city,
    province,
    ...(pinned ? { lat: location.lat, lng: location.lng } : {}),
    complete: Boolean(address && city && province && pinned),
  };
}

@ApiTags('Auth')
@ApiBearerAuth('JWT-auth')
@Controller('farmers/me')
export class FarmerProfileController {
  constructor(private readonly farmerProfileService: FarmerProfileService) {}

  @Get('farm-location')
  @Roles(UserRole.Farmer)
  @ApiOperation({
    summary: "The signed-in farmer's pickup location",
    description:
      'Farmer only. `complete: false` means orders cannot be picked up yet.',
  })
  @ApiOkResponse({ type: FarmLocationResponseDto })
  @ApiErrorResponses(401, 403, 404)
  getLocation(
    @CurrentUser() user: RequestUser,
  ): Promise<FarmLocationResponseDto> {
    return this.farmerProfileService.getLocation(user.id);
  }

  @Patch('farm-location')
  @Roles(UserRole.Farmer)
  @ApiOperation({
    summary: "Set the signed-in farmer's pickup location",
    description:
      'Farmer only. Street/village, city, province and the map pin are required: delivery fees are priced from the pin and transporters are matched to it.',
  })
  @ApiOkResponse({ type: FarmLocationResponseDto })
  @ApiErrorResponses(400, 401, 403, 404)
  updateLocation(
    @CurrentUser() user: RequestUser,
    @Body() body: FarmLocationDto,
  ): Promise<FarmLocationResponseDto> {
    return this.farmerProfileService.updateLocation(user.id, body);
  }
}
