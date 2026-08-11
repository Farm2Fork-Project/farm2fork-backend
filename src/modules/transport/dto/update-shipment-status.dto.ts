import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength } from 'class-validator';
import { ShipmentStatus } from '../schemas/shipment.schema';

/** The assigned transporter supplies only the next status and an audit note. */
export class UpdateShipmentStatusDto {
  @ApiProperty({ enum: ShipmentStatus, example: ShipmentStatus.PickedUp })
  @IsEnum(ShipmentStatus)
  status!: ShipmentStatus;

  @ApiProperty({ example: 'Collected produce from the farm', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  note!: string;
}
