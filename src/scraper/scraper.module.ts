/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Article, ArticleSchema } from './schema/article.schema';
import { ScraperController } from './scraper.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Article.name, schema: ArticleSchema }]),
  ],
  providers: [ScraperService],
  controllers: [ScraperController],
})
export class ScraperModule {}
