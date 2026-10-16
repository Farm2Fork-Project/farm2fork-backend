import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { AdminReasonDto } from '../admin/dto/admin.dto';
export class CompleteDeliveryDto {
  @IsString() @Matches(/^\d{6}$/) code!: string;
  @IsOptional() @IsString() @MaxLength(500) note = '';
}
export class DeliveryIssueDto {
  @IsEnum({
    pickup_unavailable: 'pickup_unavailable',
    recipient_unavailable: 'recipient_unavailable',
    vehicle_issue: 'vehicle_issue',
    other: 'other',
  })
  reason!: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  note!: string;
}
export class ReassignDeliveryDto extends AdminReasonDto {
  @IsMongoId() transporterId!: string;
}
export class ResolveDeliveryDto extends AdminReasonDto {
  @IsEnum({
    retry_delivery: 'retry_delivery',
    return_to_farmer: 'return_to_farmer',
  })
  resolution!: 'retry_delivery' | 'return_to_farmer';
}
export class ManualTransferDto extends AdminReasonDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) amount!: number;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/\S/)
  @MaxLength(200)
  reference!: string;
  @IsDateString() paidAt!: string;
  @IsUUID() requestId!: string;
}
export class RecordPayoutDto extends ManualTransferDto {
  @IsMongoId() transporterId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsMongoId({ each: true })
  earningIds!: string[];
}
export class EarningsQueryDto {
  @IsOptional() @IsMongoId() transporterId?: string;
}

export class PayoutCorrectionDto extends AdminReasonDto {
  @IsUUID() requestId!: string;
}
