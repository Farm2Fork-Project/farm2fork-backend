import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import {
  SystemConfig,
  SystemConfigSchema,
} from './schemas/system-config.schema';

/**
 * AdminModule (EP-08). Registers the audit_logs and system_config data layers.
 * User management, audit-log viewing and ConfigService arrive in Sprint 7.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: SystemConfig.name, schema: SystemConfigSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class AdminModule {}
