import { ApiProperty } from '@nestjs/swagger';

export class ProductImagesResponseDto {
  @ApiProperty({
    type: [String],
    description: 'Public photo URLs to pass as `images` when saving a product',
  })
  urls!: string[];
}
