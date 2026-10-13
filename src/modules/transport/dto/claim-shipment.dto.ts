import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

/** A transporter claims a currently available paid order. */
export class ClaimShipmentDto {
  @ApiProperty({ example: '66a2fe77bb77795516febc500' })
  @IsMongoId()
  orderId!: string;
}
