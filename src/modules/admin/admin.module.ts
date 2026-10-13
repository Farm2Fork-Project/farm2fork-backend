import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import {
  SystemConfig,
  SystemConfigSchema,
} from './schemas/system-config.schema';
import { SystemConfigService } from './services/system-config.service';

/**
 * AdminModule (EP-08). Registers the audit_logs and system_config data layers
 * and exposes the typed SystemConfigService (the only sanctioned way to read
 * system_config). User management and audit-log viewing arrive in Sprint 7.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: SystemConfig.name, schema: SystemConfigSchema },
    ]),
  ],
  providers: [SystemConfigService],
  exports: [MongooseModule, SystemConfigService],
})
export class AdminModule {}
