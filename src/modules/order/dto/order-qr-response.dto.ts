import { ApiProperty } from '@nestjs/swagger';
export class OrderQrResponseDto {
  @ApiProperty() orderId!: string;
  @ApiProperty() qrCode!: string;
  @ApiProperty() qrImageDataUri!: string;
}
