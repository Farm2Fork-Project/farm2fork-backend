import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '../../order/schemas/order.schema';
import {
  TraceEventDto,
  TraceFarmerDto,
  TraceSummaryDto,
} from './product-trace-response.dto';
export class TraceOrderItemDto {
  @ApiProperty() productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() quantity!: number;
  @ApiPropertyOptional() unit?: string;
}
export class TraceOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty() reference!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty() paidAt!: string;
  @ApiProperty({ type: [TraceOrderItemDto] }) items!: TraceOrderItemDto[];
}
export class OrderTraceResponseDto {
  @ApiProperty({ type: TraceOrderDto }) order!: TraceOrderDto;
  @ApiPropertyOptional({ type: TraceFarmerDto, nullable: true })
  farmer!: TraceFarmerDto | null;
  @ApiProperty({ type: [TraceEventDto] }) events!: TraceEventDto[];
  @ApiProperty({ type: TraceSummaryDto }) summary!: TraceSummaryDto;
}
