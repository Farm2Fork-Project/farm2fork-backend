import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/decorators/api-error-responses.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ProductTraceResponseDto } from './dto/product-trace-response.dto';
import { TraceabilityService } from './traceability.service';

@ApiTags('Traceability')
@Controller('trace')
export class TraceabilityController {
  constructor(private readonly traceabilityService: TraceabilityService) {}

  @Get('products/:id')
  @Public()
  @ApiOperation({
    summary: 'Public provenance journey for a product (US-08)',
    description:
      'Public - this is what a product QR code resolves to. Returns the listing, the farm, and every supply-chain and payment event with its Hyperledger Fabric ledger state. Never includes amounts, buyer/transporter identity, or street addresses.',
  })
  @ApiParam({ name: 'id', description: 'Product id' })
  @ApiOkResponse({ type: ProductTraceResponseDto })
  @ApiErrorResponses(404)
  traceProduct(@Param('id') id: string): Promise<ProductTraceResponseDto> {
    return this.traceabilityService.traceProduct(id);
  }
}
