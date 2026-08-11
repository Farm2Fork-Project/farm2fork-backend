import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiErrorResponses } from '../../common/decorators/api-error-responses.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { RequestUser } from '../../common/guards/roles.guard';
import { MarketplaceService } from './marketplace.service';
import {
  CreateProductDto,
  ProductListResponseDto,
  ProductQrResponseDto,
  ProductResponseDto,
  QueryProductDto,
  UpdateProductDto,
} from './dto';

const VIEWER_ROLES = [
  UserRole.Farmer,
  UserRole.Buyer,
  UserRole.Transporter,
  UserRole.Admin,
];

@ApiTags('Marketplace')
@ApiBearerAuth('JWT-auth')
@Controller('products')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Post()
  @Roles(UserRole.Farmer)
  @ApiOperation({
    summary: 'Create a product listing (US-04)',
    description: 'Farmer only. Generates a traceability QR code on creation.',
  })
  @ApiCreatedResponse({ type: ProductResponseDto })
  @ApiErrorResponses(400, 401, 403)
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    return this.marketplaceService.create(user.id, dto);
  }

  @Get()
  @Roles(...VIEWER_ROLES)
  @ApiOperation({
    summary: 'Browse / search / filter product listings (US-05)',
    description:
      'Authenticated farmer, buyer, transporter or admin. Supports text search, category/unit/grade/status filters, price range, sorting and pagination.',
  })
  @ApiOkResponse({ type: ProductListResponseDto })
  @ApiErrorResponses(400, 401, 403)
  findAll(@Query() query: QueryProductDto): Promise<ProductListResponseDto> {
    return this.marketplaceService.findAll(query);
  }

  @Get('mine')
  @Roles(UserRole.Farmer)
  @ApiOperation({
    summary: "List the authenticated farmer's own listings",
    description: 'Farmer only.',
  })
  @ApiOkResponse({ type: ProductListResponseDto })
  @ApiErrorResponses(400, 401, 403)
  findMine(
    @CurrentUser() user: RequestUser,
    @Query() query: QueryProductDto,
  ): Promise<ProductListResponseDto> {
    return this.marketplaceService.findMine(user.id, query);
  }

  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @ApiOperation({ summary: 'Get a single product by id' })
  @ApiParam({ name: 'id', description: 'Product id' })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiErrorResponses(401, 403, 404)
  findOne(@Param('id') id: string): Promise<ProductResponseDto> {
    return this.marketplaceService.findOne(id);
  }

  @Get(':id/qr')
  @Roles(...VIEWER_ROLES)
  @ApiOperation({
    summary: "Get a product's traceability QR code",
    description: 'Returns the trace URL and a rendered QR image data URI.',
  })
  @ApiParam({ name: 'id', description: 'Product id' })
  @ApiOkResponse({ type: ProductQrResponseDto })
  @ApiErrorResponses(401, 403, 404)
  getQr(@Param('id') id: string): Promise<ProductQrResponseDto> {
    return this.marketplaceService.getQr(id);
  }

  @Patch(':id')
  @Roles(UserRole.Farmer)
  @ApiOperation({
    summary: 'Update a product listing',
    description: 'Farmer only. The caller must own the listing.',
  })
  @ApiParam({ name: 'id', description: 'Product id' })
  @ApiOkResponse({ type: ProductResponseDto })
  @ApiErrorResponses(400, 401, 403, 404)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return this.marketplaceService.update(id, user.id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.Farmer)
  @ApiOperation({
    summary: 'Delete (or deactivate) a product listing',
    description: 'Farmer only. The caller must own the listing.',
  })
  @ApiParam({ name: 'id', description: 'Product id' })
  @ApiOkResponse({
    schema: {
      example: { id: '6a2fe77bb77795516febc287', deleted: true },
    },
  })
  @ApiErrorResponses(401, 403, 404)
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<{ id: string; deleted: boolean }> {
    return this.marketplaceService.remove(id, user.id);
  }
}
