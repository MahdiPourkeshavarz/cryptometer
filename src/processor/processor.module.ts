/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { ProcessorService } from './processor.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Article, ArticleSchema } from 'src/scraper/schema/article.schema';
import { MarketPulse, MarketPulseSchema } from './schema/market-pulse.schema';
import { ConfigModule } from '@nestjs/config';
import { ProcessorController } from './processor.controller';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Article.name, schema: ArticleSchema },
      { name: MarketPulse.name, schema: MarketPulseSchema },
    ]),
  ],
  providers: [ProcessorService],
  controllers: [ProcessorController],
})
export class ProcessorModule {}
