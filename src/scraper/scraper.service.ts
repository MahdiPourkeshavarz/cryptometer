/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as Parser from 'rss-parser';
import { Article } from './entity/article.entity';
import { Repository } from 'typeorm';

export interface Articles {
  headline: string;
  summary: string;
}

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  private readonly rssParser = new Parser();

  constructor(
    @InjectRepository(Article)
    private readonly articleRepository: Repository<Article>,
  ) {}

  @Cron(CronExpression.EVERY_2_HOURS)
  async runAllScrapers() {
    this.logger.log('🚀 Starting scheduled scraping job...');

    const scrapers = [
      { func: this.getMexcNews.bind(this), source: 'Mexc' },
      { func: this.getCryptoNews.bind(this), source: 'CryptoNews' },
      { func: this.getCointelegraphNews.bind(this), source: 'Cointelegraph' },
      { func: this.getKucoinNews.bind(this), source: 'Kucoin' },
      { func: this.getCryptoSlateNews.bind(this), source: 'CryptoSlate' },
      { func: this.getCoinDeskNews.bind(this), source: 'CoinDesk' },
      { func: this.getCryptoPotatoNews.bind(this), source: 'CryptoPotato' },
      { func: this.getDailyCoinNews.bind(this), source: 'DailyCoin' },
      { func: this.getCoinGapeNews.bind(this), source: 'CoinGape' },
      { func: this.getAltcoinBuzzNews.bind(this), source: 'AltcoinBuzz' },
    ];

    const results = await Promise.allSettled(
      scrapers.map(({ func, source }) => func(source)),
    );

    this.logger.log('✅ Scheduled scraping job finished.');

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        this.logger.log(
          `[Source ${scrapers[index].source}] Successfully scraped and processed ${result.value.length} articles.`,
        );
      } else {
        this.logger.error(
          `[Source ${scrapers[index].source}] Failed:`,
          result.reason,
        );
      }
    });
  }

  private async getNewsFromRss(
    feedUrl: string,
    source: string,
  ): Promise<Article[]> {
    this.logger.log(
      `Fetching news from RSS feed: ${feedUrl} (Source: ${source})`,
    );
    try {
      const feed = await this.rssParser.parseURL(feedUrl);

      if (!feed?.items?.length) {
        this.logger.warn(`No items found in RSS feed: ${feedUrl}`);
        return [];
      }

      const articles = feed.items.map((item) =>
        this.articleRepository.create({
          headline: item.title || '',
          summary: this.stripHtml(
            item.contentSnippet ||
              item['content:encoded'] ||
              item.summary ||
              '',
          ),
          source: source,
          url: item.link || undefined,
        }),
      );

      return this.saveArticles(articles);
    } catch (error) {
      this.logger.error(`Failed to parse RSS feed: ${feedUrl}`, error.stack);
      throw new Error(`Failed to get news from RSS feed: ${feedUrl}`);
    }
  }

  private async scrapeCointelegraphHtml(source: string): Promise<Article[]> {
    const url = 'https://cointelegraph.com/tags/altcoin';
    this.logger.log(`Scraping HTML from: ${url} (Source: ${source})`);
    try {
      const { data } = await axios.get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      });
      const $ = cheerio.load(data);
      const articles: Partial<Article>[] = [];

      $('li[data-testid="posts-listing__item"]').each((_, element) => {
        const headline = $(element)
          .find('span.post-card-inline__title')
          .text()
          .trim();
        const summary = $(element)
          .find('p.post-card-inline__text')
          .text()
          .trim();
        const link = $(element).find('a').attr('href');
        if (headline && summary) {
          articles.push({
            headline,
            summary,
            source,
            url: link ? `https://cointelegraph.com${link}` : undefined,
          });
        }
      });

      return this.saveArticles(articles as Article[]);
    } catch (error) {
      this.logger.error(
        `Error during Cointelegraph HTML scraping`,
        error.stack,
      );
      throw new Error('Failed to scrape the website.');
    }
  }

  private async scrapeKucoinHtml(source: string): Promise<Article[]> {
    const url = 'https://www.kucoin.com/news/category/altcoin';
    this.logger.log(`Scraping HTML from: ${url} (Source: ${source})`);
    try {
      const { data } = await axios.get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      });
      const $ = cheerio.load(data);
      const articles: Partial<Article>[] = [];

      $('.styles_ItemTimelineWrapper__Ab5zU').each((_, element) => {
        const headline = $(element).find('h3').text().trim();
        const summary = $(element)
          .find('.styles_BodyContent__3aXXG')
          .text()
          .trim();
        const link = $(element).find('a').attr('href');
        if (headline && summary) {
          articles.push({
            headline,
            summary,
            source,
            url: link ? `https://www.kucoin.com${link}` : undefined,
          });
        }
      });

      return this.saveArticles(articles as Article[]);
    } catch (error) {
      this.logger.error(`Error during KuCoin HTML scraping`, error.stack);
      throw new Error('Failed to scrape the website.');
    }
  }

  private async saveArticles(articles: Article[]): Promise<Article[]> {
    const saved: Article[] = [];
    for (const article of articles) {
      try {
        const existing = await this.articleRepository.findOne({
          where: { headline: article.headline, source: article.source },
        });
        if (!existing) {
          const savedArticle = await this.articleRepository.save(article);
          saved.push(savedArticle);
        } else {
          this.logger.log(
            `Skipping duplicate article: ${article.headline} from ${article.source}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to save article: ${article.headline}`,
          error.stack,
        );
      }
    }
    return saved;
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>?/gm, '');
  }

  public async getMexcNews(source: string = 'Mexc') {
    return this.getNewsFromRss('https://blog.mexc.com/feed/', source);
  }

  public async getCryptoNews(source: string = 'CryptoNews') {
    return this.getNewsFromRss('https://cryptonews.com/feed/', source);
  }

  public async getCointelegraphNews(source: string = 'Cointelegraph') {
    return this.getNewsFromRss(
      'https://cointelegraph.com/tags/altcoin/feed',
      source,
    );
  }

  public async getKucoinNews(source: string = 'Kucoin') {
    return this.getNewsFromRss(
      'https://www.kucoin.com/rss/category/altcoin',
      source,
    );
  }

  public async getCryptoSlateNews(source: string = 'CryptoSlate') {
    return this.getNewsFromRss('https://cryptoslate.com/news/feed/', source);
  }

  public async getCoinDeskNews(source: string = 'CoinDesk') {
    return this.getNewsFromRss('https://www.coindesk.com/feed/', source);
  }

  public async getCryptoPotatoNews(source: string = 'CryptoPotato') {
    return this.getNewsFromRss('https://cryptopotato.com/feed/', source);
  }

  public async getDailyCoinNews(source: string = 'DailyCoin') {
    return this.getNewsFromRss('https://dailycoin.com/altcoins/feed/', source);
  }

  public async getCoinGapeNews(source: string = 'CoinGape') {
    return this.getNewsFromRss(
      'https://coingape.com/category/news/altcoin-news/feed/',
      source,
    );
  }

  public async getAltcoinBuzzNews(source: string = 'AltcoinBuzz') {
    return this.getNewsFromRss(
      'https://www.altcoinbuzz.io/cryptocurrency-news/feed/',
      source,
    );
  }

  public async getCointelegraphNewsViaHtml(source: string = 'Cointelegraph') {
    return this.scrapeCointelegraphHtml(source);
  }

  public async getKucoinNewsViaHtml(source: string = 'Kucoin') {
    return this.scrapeKucoinHtml(source);
  }
}
