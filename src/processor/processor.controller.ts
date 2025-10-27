/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/require-await */
import { Controller, Get } from '@nestjs/common';
import { ProcessorService } from './processor.service';

@Controller('processor')
export class ProcessorController {
  constructor(private readonly processorService: ProcessorService) {}

  @Get('pulse')
  async getLatestMarketPulse() {
    return this.processorService.getLatestEnrichedMarketPulse();
  }

  @Get('insight')
  async getWeeklyInsight() {
    return this.processorService.getLatestEnrichedWeeklyInsight();
  }

  @Get('article')
  async getArticleProcessed() {
    this.processorService.processDailyArticles();
    return {
      message:
        'processing job triggered. Check the server logs and your database for results.',
    };
  }

  @Get('week')
  async getInsightProcess() {
    this.processorService.processWeeklyInsights();
    return {
      message:
        'processing insight job triggered. Check the server logs and your database for results.',
    };
  }

  @Get('mood')
  async getDailyMood() {
    return this.processorService.getLatestDailySentiment();
  }

  @Get('impactful')
  async getImpactfulNews() {
    return this.processorService.getLatestImpactfulNews();
  }

  @Get('sources')
  async getTopSources() {
    return this.processorService.getLatestSource();
  }
}
