/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { PromptTemplate } from '@langchain/core/prompts';
import { JsonOutputToolsParser } from 'langchain/output_parsers';
import { Article, ArticleDocument } from 'src/scraper/schema/article.schema';
import { MarketPulse, MarketPulseDocument } from './schema/market-pulse.schema';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { EnrichedMarketPulseDto } from './dto/enriched-market-pulse.dto';
import { Crypto, SearchResult } from './dto/crypto.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ChatOpenAI } from '@langchain/openai';
import { LLM_OPTIONS } from './constants/daily.analysis.option';
import { DAILY_ANALYSIS_PROMPT } from './constants/daily-analysis.prompt';

@Injectable()
export class ProcessorService {
  private readonly logger = new Logger(ProcessorService.name);
  private readonly openAi: ChatOpenAI;
  private readonly baseUrl = 'https://api.coingecko.com/api/v3';
  private readonly apiKey: string;

  constructor(
    @InjectModel(Article.name)
    private readonly articleModel: Model<ArticleDocument>,
    @InjectModel(MarketPulse.name)
    private readonly pulseModel: Model<MarketPulseDocument>,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    this.openAi = new ChatOpenAI({
      apiKey: configService.get<string>('OPENAI_API_KEY'),
      model: 'gpt-4o-mini',
      temperature: 0,
    });
    this.apiKey = this.configService.get<string>('COINGECKO_API_KEY') as string;
  }

  @Cron(CronExpression.EVERY_2_HOURS)
  async processDailyArticles() {
    this.logger.log('🤖 Starting Hype & FUD processing job...');

    const today = new Date();
    const dateString = today.toISOString().split('T')[0];

    try {
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      const articles = await this.articleModel
        .find({ createdAt: { $gte: twentyFourHoursAgo } })
        .sort({ createdAt: -1 })
        .limit(108)
        .exec();

      if (articles.length < 5) {
        this.logger.log(
          'Not enough articles to process for a meaningful analysis.',
        );
        return;
      }

      this.logger.log(
        `Found ${articles.length} articles to analyze for ${dateString}...`,
      );

      const articlesContext = articles
        .map(
          (a) =>
            `Source: ${a.source}\nHeadline: ${a.headline}\nSummary: ${a.summary}`,
        )
        .join('\n---\n');

      const parser = new JsonOutputToolsParser();

      const prompt = PromptTemplate.fromTemplate(DAILY_ANALYSIS_PROMPT);

      const toolCallingModel = this.openAi.bind(LLM_OPTIONS);

      // 4. Create the chain with the tool-calling model
      const chain = prompt.pipe(toolCallingModel).pipe(parser);

      const pulseResult: any = await chain.invoke({
        articles_context: articlesContext,
      });

      // 5. Update the save logic to handle the tool-calling output format
      await this.pulseModel.findOneAndUpdate(
        { date: dateString },
        {
          $set: {
            // The result is now nested inside the first tool call's arguments
            hype: pulseResult[0].args.hype,
            fud: pulseResult[0].args.fud,
          },
        },
        {
          upsert: true,
          new: true,
        },
      );

      this.logger.log(
        `✅ Successfully processed and saved Hype/FUD analysis for ${dateString}.`,
      );
    } catch (error) {
      this.logger.error('Failed to process Hype & FUD analysis:', error.stack);
    }
  }

  private async getCoinsMarketData(
    ids: string[],
  ): Promise<Map<string, Crypto>> {
    if (ids.length === 0) {
      return new Map();
    }

    const cacheKey = `cryptos-${ids}`;

    const cached = (await this.cacheManager.get(cacheKey)) as Map<
      string,
      Crypto
    >;

    if (cached) return cached;

    const url = `${this.baseUrl}/coins/markets`;
    const params = {
      vs_currency: 'usd',
      ids: ids.join(','), // Join the IDs into a single comma-separated string
      x_cg_demo_api_key: this.apiKey,
    };

    try {
      const { data } = await firstValueFrom(
        this.httpService.get<Crypto[]>(url, { params }),
      );

      // Convert the array of results into a Map for easy lookups (id -> Crypto data)
      const cryptoMap = new Map<string, Crypto>();
      if (data) {
        data.forEach((coin) => cryptoMap.set(coin.id, coin));
      }

      await this.cacheManager.set(cacheKey, cryptoMap, 240 * 1000);

      return cryptoMap;
    } catch (error) {
      this.logger.error(
        `Error fetching market data for IDs (${ids.join(', ')}):`,
        error.message,
      );
      throw new Error('Failed to fetch cryptocurrency market data.');
    }
  }

  async searchCoins(query: string): Promise<SearchResult | null> {
    if (!query || query.trim() === '') {
      return null;
    }

    const url = `${this.baseUrl}/search`;
    const params = {
      query,
      x_cg_demo_api_key: this.apiKey,
    };

    try {
      const { data } = await firstValueFrom(
        this.httpService.get<{ coins: SearchResult[] }>(url, { params }),
      );

      if (!data.coins || data.coins.length === 0) {
        this.logger.warn(`CoinGecko search found no results for: "${query}"`);
        return null; // Return null gracefully
      }

      return data.coins[0];
    } catch (error) {
      console.error(`Error searching for coins (${query}):`, error.message);
      throw new Error('Failed to perform cryptocurrency search.');
    }
  }

  async getLatestEnrichedMarketPulse(): Promise<EnrichedMarketPulseDto | null> {
    // 1. Fetch the single most recent pulse from the database
    const latestPulse = (await this.pulseModel
      .findOne()
      .sort({ createdAt: -1 }) // Use createdAt to get the true latest
      .exec()) as MarketPulseDocument;

    if (!latestPulse) {
      this.logger.warn('No market pulse found in the database.');
      return null;
    }

    // 2. Collect all unique cryptocurrency NAMES
    const allEntries = [...latestPulse.hype, ...latestPulse.fud];
    const uniqueCryptoNames = [
      ...new Set(allEntries.map((entry) => entry.name)),
    ];

    if (uniqueCryptoNames.length === 0) {
      return {
        _id: latestPulse._id.toString(),
        date: latestPulse.date,
        createdAt: latestPulse.createdAt.toISOString(),
        hype: latestPulse.hype,
        fud: latestPulse.fud,
      };
    }

    this.logger.log(`Searching for IDs for: ${uniqueCryptoNames.join(', ')}`);
    const searchPromises = uniqueCryptoNames.map((name) =>
      this.searchCoins(name).then((res) =>
        res ? { ...res, queryName: name } : null,
      ),
    );
    const searchResults = await Promise.all(searchPromises);

    // Build a map from the original query name -> search result (if any)
    const queryToSearchResult = new Map<
      string,
      { id: string; name: string; queryName: string; large: string }
    >();
    searchResults.forEach((sr) => {
      if (sr && sr.queryName) queryToSearchResult.set(sr.queryName, sr);
    });

    // Collect unique CoinGecko IDs we actually found
    const cryptoIds = Array.from(
      new Set(Array.from(queryToSearchResult.values()).map((sr) => sr.id)),
    );

    if (cryptoIds.length === 0) {
      this.logger.warn('Could not find IDs for any of the crypto names.');
      return {
        _id: latestPulse._id.toString(),
        date: latestPulse.date,
        createdAt: latestPulse.createdAt.toISOString(),
        hype: latestPulse.hype,
        fud: latestPulse.fud,
      };
    }

    // 2) Fetch Phase: get market data by ID and build id -> crypto map
    this.logger.log(`Fetching market data for IDs: ${cryptoIds.join(', ')}`);

    const idToCrypto = await this.getCoinsMarketData(cryptoIds);

    // 3) Enrich entries using the original query -> id map, then id -> crypto map
    const enrich = (entry) => {
      const sr = queryToSearchResult.get(entry.name); // entry.name is what was in the pulse (e.g. "DOGE")
      if (!sr) {
        // no search result for this original name
        this.logger.warn(
          `CoinGecko search found no results for: "${entry.name}"`,
        );
        return { ...entry, marketData: null };
      }

      const crypto = idToCrypto.get(sr.id) || null;
      if (!crypto) {
        this.logger.warn(
          `Found ID (${sr.id}) for "${entry.name}" but market fetch returned no data.`,
        );
      }

      const finalMarketData = {
        ...crypto,
        large: sr.large,
      };

      return { ...entry, marketData: finalMarketData };
    };

    const enrichedHype = latestPulse.hype.map((e) => enrich(e));
    const enrichedFud = latestPulse.fud.map((e) => enrich(e));

    // 7. Return the final, combined DTO
    return {
      _id: latestPulse._id.toString(),
      date: latestPulse.date,
      createdAt: latestPulse.createdAt.toISOString(),
      hype: enrichedHype,
      fud: enrichedFud,
    };
  }
}
