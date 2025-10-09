/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as Parser from 'rss-parser';
import { Article, ArticleDocument } from './schema/article.schema';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  private readonly rssParser = new Parser();

  constructor(
    @InjectModel(Article.name)
    private readonly articleModel: Model<ArticleDocument>,
  ) {}

  @Cron(CronExpression.EVERY_2_HOURS)
  async runAllScrapers() {
    this.logger.log('🚀 Starting scheduled scraping job...');

    const scrapers = [
      { func: this.getMexcNews.bind(this), source: 'Mexc' },
      { func: this.getCryptoNews.bind(this), source: 'CryptoNews' },
      { func: this.getCointelegraphNews.bind(this), source: 'Cointelegraph' },
      { func: this.getKucoinNewsViaHtml.bind(this), source: 'Kucoin' },
      { func: this.getCryptoSlateNews.bind(this), source: 'CryptoSlate' },
      { func: this.getCoinDeskNews.bind(this), source: 'CoinDesk' },
      { func: this.getCryptoPotatoNews.bind(this), source: 'CryptoPotato' },
      { func: this.getDailyCoinNews.bind(this), source: 'DailyCoin' },
      { func: this.getCoinGapeNews.bind(this), source: 'CoinGape' },
      { func: this.getECryptoNews.bind(this), source: 'ECrypto' },
      { func: this.getCoinSpeakerNews.bind(this), source: 'CoinSpeaker' },
      { func: this.getAltcoinBuzzNews.bind(this), source: 'AltcoinBuzz' },
      {
        func: this.getBlockchainReporterNews.bind(this),
        source: 'BlockchainReporter',
      },
      { func: this.getCryptoCoinNews.bind(this), source: 'CryptoCoin' },
      { func: this.getAMBCryptoNews.bind(this), source: 'AMB' },
      {
        func: this.getAltcoinInvestorsNews.bind(this),
        source: 'AltcoinInvestors',
      },
    ];

    const results = await Promise.allSettled(
      scrapers.map(({ func, source }) => func(source)),
    );

    this.logger.log('✅ Scheduled scraping job finished.');

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        this.logger.log(
          `[Source ${scrapers[index].source}] Successfully scraped and saved ${result.value} new articles.`,
        );
      } else {
        this.logger.error(
          `[Source ${scrapers[index].source}] Failed:`,
          result.reason.message,
        );
      }
    });
  }

  private async saveArticles(articles: Partial<Article>[]): Promise<number> {
    if (articles.length === 0) {
      return 0;
    }

    const bulkOps = articles.map((article) => ({
      updateOne: {
        filter: {
          $or: [
            { url: article.url },
            { headline: article.headline, source: article.source },
          ],
        },
        update: { $setOnInsert: article },
        upsert: true,
      },
    }));

    try {
      const result = await this.articleModel.bulkWrite(bulkOps);
      const newArticlesCount = result.upsertedCount;

      if (newArticlesCount > 0) {
        this.logger.log(
          `Saved ${newArticlesCount} new articles to the database.`,
        );
      }

      return newArticlesCount;
    } catch (error) {
      if (error.code === 11000) {
        this.logger.warn(
          `Bulk write failed due to duplicate key, which is expected. No new articles were saved.`,
        );
        return 0;
      }
      this.logger.error('Error during bulk save operation:', error.stack);
      throw error;
    }
  }

  private async getNewsFromRss(
    feedUrl: string,
    source: string,
  ): Promise<number> {
    try {
      const { data: xmlData } = await axios.get(feedUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
        },
        timeout: 10000,
      });

      const feed = await this.rssParser.parseString(xmlData);

      if (!feed?.items?.length) {
        this.logger.warn(`No items found in RSS feed: ${feedUrl}`);
        return 0;
      }

      const articles: Partial<Article>[] = feed.items.map((item) => ({
        headline: item.title || '',
        summary: this.stripHtml(
          item.contentSnippet || item['content:encoded'] || item.summary || '',
        ),
        source: source,
        url: item.link || undefined,
      }));

      return this.saveArticles(articles);
    } catch (error) {
      this.logger.error(
        `Failed to get or parse RSS feed: ${feedUrl}`,
        error.message,
      );
      throw new Error(`Failed to get news from RSS feed: ${feedUrl}`);
    }
  }

  private async scrapeCointelegraphHtml(source: string): Promise<number> {
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

      return this.saveArticles(articles);
    } catch (error) {
      this.logger.error(
        `Error during Cointelegraph HTML scraping`,
        error.stack,
      );
      throw new Error('Failed to scrape the website.');
    }
  }

  private async scrapeKucoinHtml(source: string): Promise<number> {
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

      return this.saveArticles(articles);
    } catch (error) {
      this.logger.error(`Error during KuCoin HTML scraping`, error.stack);
      throw new Error('Failed to scrape the website.');
    }
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>?/gm, '');
  }

  public getMexcNews(source: string = 'Mexc') {
    return this.getNewsFromRss('https://blog.mexc.com/feed/', source);
  }

  public getCryptoNews(source: string = 'CryptoNews') {
    return this.getNewsFromRss('https://cryptonews.com/feed/', source);
  }

  public getAltcoinBuzzNews(source: string = 'AltcoinBuzz') {
    return this.getNewsFromRss('https://www.altcoinbuzz.io/feed/', source);
  }

  public getCointelegraphNews(source: string = 'Cointelegraph') {
    return this.getNewsFromRss(
      'https://cointelegraph.com/rss/tag/altcoin',
      source,
    );
  }

  public getKucoinNews(source: string = 'Kucoin') {
    return this.getNewsFromRss(
      'https://www.kucoin.com/rss/category/altcoin',
      source,
    );
  }

  public getCryptoSlateNews(source: string = 'CryptoSlate') {
    return this.getNewsFromRss('https://cryptoslate.com/news/feed/', source);
  }

  public getCoinDeskNews(source: string = 'CoinDesk') {
    return this.getNewsFromRss(
      'https://www.coindesk.com/arc/outboundfeeds/rss/',
      source,
    );
  }

  public getCryptoPotatoNews(source: string = 'CryptoPotato') {
    return this.getNewsFromRss('https://cryptopotato.com/feed/', source);
  }

  public getCoinSpeakerNews(source: string = 'CoinSpeaker') {
    return this.getNewsFromRss(
      'https://www.coinspeaker.com/news/crypto/altcoins-news/feed/',
      source,
    );
  }

  public getDailyCoinNews(source: string = 'DailyCoin') {
    return this.getNewsFromRss('https://dailycoin.com/altcoins/feed/', source);
  }

  public getCryptoCoinNews(source: string = 'CryptoCoin') {
    return this.getNewsFromRss(
      'https://cryptocoin.news/category/news/altcoin/feed/',
      source,
    );
  }

  public getBlockchainReporterNews(source: string = 'BlockchainReporter') {
    return this.getNewsFromRss(
      'https://blockchainreporter.net/altcoins/feed/',
      source,
    );
  }

  public getCoinGapeNews(source: string = 'CoinGape') {
    return this.getNewsFromRss(
      'https://coingape.com/category/news/altcoin-news/feed/',
      source,
    );
  }

  public getAltcoinInvestorsNews(source: string = 'AltcoinInvestors') {
    return this.getNewsFromRss(
      'https://altcoininvestor.com/latest/rss/',
      source,
    );
  }

  public getECryptoNews(source: string = 'ECrypto') {
    return this.getNewsFromRss(
      'https://e-cryptonews.com/category/altcoin-news/feed/',
      source,
    );
  }

  public getAMBCryptoNews(source: string = 'AMB') {
    return this.getNewsFromRss(
      'https://ambcrypto.com/category/altcoins-news/feed/',
      source,
    );
  }

  public getCointelegraphNewsViaHtml(source: string = 'Cointelegraph') {
    return this.scrapeCointelegraphHtml(source);
  }

  public getKucoinNewsViaHtml(source: string = 'Kucoin') {
    return this.scrapeKucoinHtml(source);
  }

  public async testRunAllScrapers() {
    this.logger.log('🚀 Manually triggering scraping job for testing...');
    await this.runAllScrapers();
  }
}
