/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { ProcessorService } from './processor.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Article, ArticleSchema } from 'src/scraper/schema/article.schema';
import { MarketPulse, MarketPulseSchema } from './schema/market-pulse.schema';
import { ConfigModule } from '@nestjs/config';
import { ProcessorController } from './processor.controller';
import { HttpModule } from '@nestjs/axios';
import {
  WeeklyInsight,
  WeeklyInsightSchema,
} from './schema/weekly-insight.schema';
import { MarketMood, MarketMoodSchema } from './schema/market-mood.schema';
import {
  ImpactfulNews,
  ImpactfulNewsSchema,
} from './schema/impactful-events.schema';
import {
  SourceRanking,
  SourceRankingSchema,
} from './schema/source-ranking.schema';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    MongooseModule.forFeature([
      { name: Article.name, schema: ArticleSchema },
      { name: MarketPulse.name, schema: MarketPulseSchema },
      { name: WeeklyInsight.name, schema: WeeklyInsightSchema },
      { name: MarketMood.name, schema: MarketMoodSchema },
      { name: ImpactfulNews.name, schema: ImpactfulNewsSchema },
      { name: SourceRanking.name, schema: SourceRankingSchema },
    ]),
  ],
  providers: [ProcessorService],
  controllers: [ProcessorController],
})
export class ProcessorModule {}
