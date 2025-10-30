/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/require-await */
import { Controller, Get } from '@nestjs/common';
import { ProcessorService } from './processor.service';
import { DailyProcessorService } from './daily-processor.service';
import { WeeklyProcessorService } from './weekly-processor.service';

@Controller('processor')
export class ProcessorController {
  constructor(
    private readonly processorService: ProcessorService,
    private readonly dailyProcessorService: DailyProcessorService,
    private readonly weeklyProcessor: WeeklyProcessorService,
  ) {}

  @Get('pulse')
  async getLatestMarketPulse() {
    return this.processorService.getLatestEnrichedMarketPulse();
  }

  @Get('insight')
  async getWeeklyInsight() {
    return this.weeklyProcessor.getLatestWeeklyInsight();
  }

  @Get('mood')
  async getDailyMood() {
    return this.dailyProcessorService.getLatestDailySentiment();
  }

  @Get('impactful')
  async getImpactfulNews() {
    return this.dailyProcessorService.getLatestImpactfulNews();
  }

  @Get('sources')
  async getTopSources() {
    return this.weeklyProcessor.getLatestSource();
  }

  @Get('/cron/pulse')
  async triggerDailyAnalysisCron() {
    await this.processorService.processDailyArticles();
    return { message: 'Daily analysis cron job triggered.' };
  }

  @Get('/cron/weekly-sources')
  async triggerWeeklySourceRankingCron() {
    await this.weeklyProcessor.processWeeklySourceRanking();
    return { message: 'Weekly source ranking cron job triggered.' };
  }

  @Get('/cron/weekly-insight')
  async triggerWeeklyInsightCron() {
    await this.weeklyProcessor.processWeeklyInsights();
    return { message: 'Weekly insight cron job triggered.' };
  }

  @Get('/cron/daily-sentiment')
  async triggerDailySentimentCron() {
    await this.dailyProcessorService.analyzeAndStoreDailySentiment();
    return { message: 'Daily sentiment analysis cron job triggered.' };
  }

  @Get('/cron/impactful-news')
  async triggerImpactfulNewsCron() {
    await this.dailyProcessorService.identifyImpactfulNews();
    return { message: 'Impactful news identification cron job triggered.' };
  }
}
