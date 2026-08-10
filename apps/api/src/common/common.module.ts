import { Global, Module } from '@nestjs/common';
import { AuditService } from './services/audit.service';
import { DocumentCounterService } from './services/document-counter.service';

/** Cross-cutting services every feature module may need. */
@Global()
@Module({
  providers: [AuditService, DocumentCounterService],
  exports: [AuditService, DocumentCounterService],
})
export class CommonModule {}
