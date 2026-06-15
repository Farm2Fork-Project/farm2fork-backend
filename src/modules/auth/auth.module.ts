import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import {
  BuyerProfile,
  BuyerProfileSchema,
} from './schemas/buyer-profile.schema';
import {
  FarmerProfile,
  FarmerProfileSchema,
} from './schemas/farmer-profile.schema';
import {
  FinancialPartnerProfile,
  FinancialPartnerProfileSchema,
} from './schemas/financial-partner-profile.schema';
import {
  TransporterProfile,
  TransporterProfileSchema,
} from './schemas/transporter-profile.schema';
import { User, UserSchema } from './schemas/user.schema';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret:
          configService.get<string>('JWT_SECRET') ?? 'dev-insecure-secret',
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRATION') ??
            '24h') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: FarmerProfile.name, schema: FarmerProfileSchema },
      { name: BuyerProfile.name, schema: BuyerProfileSchema },
      { name: TransporterProfile.name, schema: TransporterProfileSchema },
      {
        name: FinancialPartnerProfile.name,
        schema: FinancialPartnerProfileSchema,
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, MongooseModule],
})
export class AuthModule {}
