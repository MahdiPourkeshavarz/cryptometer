/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/require-await */
import { Controller, Get } from '@nestjs/common';
import { ScraperService } from './scraper.service';

@Controller('scraper')
export class ScraperController {
  constructor(private readonly scraperService: ScraperService) {}

  @Get('run')
  async triggerScraper() {
    this.scraperService.testRunAllScrapers();
    return {
      message:
        'Scraping job triggered. Check the server logs and your database for results.',
    };
  }
}
