import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/decorators/api-error-responses.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PublicTraceRateLimit } from '../../common/rate-limit/rate-limits';
import { FarmProfileResponseDto } from './dto';
import { FarmProfileService } from './farm-profile.service';

@ApiTags('Marketplace')
@Controller('farmers')
export class FarmProfileController {
  constructor(private readonly farmProfileService: FarmProfileService) {}

  @Get(':id/public')
  @Public()
  @PublicTraceRateLimit()
  @ApiOperation({
    summary: "A farm's public profile",
    description:
      'Public, so product pages work for guests. Returns the farm, the farmer, crops, certifications and listing/delivery counts. Never includes CNIC, contact or bank details, street address or the exact map pin.',
  })
  @ApiParam({
    name: 'id',
    description: 'Farmer user id (`farmerId` on a product)',
  })
  @ApiOkResponse({ type: FarmProfileResponseDto })
  @ApiErrorResponses(404, 429)
  getPublicProfile(@Param('id') id: string): Promise<FarmProfileResponseDto> {
    return this.farmProfileService.getPublicProfile(id);
  }
}
