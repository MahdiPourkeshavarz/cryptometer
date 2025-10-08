/* eslint-disable prettier/prettier */
import { Controller, Get } from '@nestjs/common';
import { ProcessorService } from './processor.service';

@Controller('processor')
export class ProcessorController {
  constructor(private readonly processorService: ProcessorService) {}

  @Get('pulse')
  async getLatestMarketPulse() {
    return this.processorService.getLatestMarketPulse();
  }
}
