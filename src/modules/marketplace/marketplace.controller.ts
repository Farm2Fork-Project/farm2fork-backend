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
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateProductDto,
  ): ProductResponseDto {
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
  findAll(@Query() query: QueryProductDto): ProductListResponseDto {
    return this.marketplaceService.findAll(query);
  }

  @Get('mine')
  @Roles(UserRole.Farmer)
  @ApiOperation({
    summary: "List the authenticated farmer's own listings",
    description: 'Farmer only.',
  })
  @ApiOkResponse({ type: ProductListResponseDto })
  findMine(
    @CurrentUser() user: RequestUser,
    @Query() query: QueryProductDto,
  ): ProductListResponseDto {
    return this.marketplaceService.findMine(user.id, query);
  }

  @Get(':id')
  @Roles(...VIEWER_ROLES)
  @ApiOperation({ summary: 'Get a single product by id' })
  @ApiParam({ name: 'id', description: 'Product id' })
  @ApiOkResponse({ type: ProductResponseDto })
  findOne(@Param('id') id: string): ProductResponseDto {
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
  getQr(@Param('id') id: string): ProductQrResponseDto {
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
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): ProductResponseDto {
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
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): { id: string; deleted: boolean } {
    return this.marketplaceService.remove(id, user.id);
  }
}
