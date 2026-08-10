import { Global, Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { StockLedgerService } from './stock-ledger.service';

/**
 * Global because `StockLedgerService` is the single choke point for stock
 * changes — transfers, purchase orders, sales orders and bulk jobs all need it,
 * and none of them should be able to bypass it with their own arithmetic.
 */
@Global()
@Module({
  controllers: [StockController],
  providers: [StockService, StockLedgerService],
  exports: [StockService, StockLedgerService],
})
export class StockModule {}
