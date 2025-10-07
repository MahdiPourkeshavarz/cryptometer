/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';

@Module({
  providers: [ScraperService],
})
export class ScraperModule {}
