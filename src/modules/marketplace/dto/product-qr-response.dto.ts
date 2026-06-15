import { ApiProperty } from '@nestjs/swagger';

export class ProductQrResponseDto {
  @ApiProperty({ example: '6a2fe77bb77795516febc287' })
  productId!: string;

  @ApiProperty({
    example: 'https://farm2fork.com/trace/6a2fe77bb77795516febc287',
    description: 'Traceability URL encoded in the QR code',
  })
  qrCode!: string;

  @ApiProperty({
    example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
    description: 'QR code rendered as a base64 PNG data URI',
  })
  qrImageDataUri!: string;
}
