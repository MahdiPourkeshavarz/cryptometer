/* eslint-disable prettier/prettier */
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
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import {
  WeeklyInsight,
  WeeklyInsightDocument,
} from './schema/weekly-insight.schema';
import { EnrichedWeeklyInsightDto } from './dto/enriched-weekly-insight.dto';
import { JsonOutputParser } from '@langchain/core/output_parsers';

@Injectable()
export class ProcessorService {
  private readonly logger = new Logger(ProcessorService.name);
  private readonly llm: ChatOpenAI;
  private readonly weeklyInsightLlm: ChatGoogleGenerativeAI;
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
    @InjectModel(WeeklyInsight.name)
    private readonly weeklyInsightModel: Model<WeeklyInsightDocument>,
  ) {
    this.llm = new ChatOpenAI({
      apiKey: configService.get<string>('OPENAI_API_KEY'),
      model: 'gpt-4o-mini',
      temperature: 0,
    });
    this.weeklyInsightLlm = new ChatGoogleGenerativeAI({
      apiKey: configService.get<string>('GOOGLE_API_KEY'),
      model: 'gemini-2.0-flash',
      temperature: 0.1,
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
        .limit(124)
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

      const prompt = PromptTemplate.fromTemplate(
        `**Persona:** You are an expert crypto market analyst.

        **Primary Goal:** Analyze the provided news articles to identify the top 2 "Hype" and top 2 "FUD" cryptocurrencies. You must calculate scores based on the strict rules below and provide a concise, insightful reason for each score.

        **Scoring Algorithm (Apply meticulously):**

        **Hype Points:**
        - **+3:** For each mention in a **title**.
        - **+2:** For each mention in a **summary**.
        - **+1:** If the article has an overall sentiment score > 80% positive.

        **FUD Points:**
        - **+3:** If mentioned in a **title** with negative sentiment.
        - **+2:** If mentioned in a **summary** with negative sentiment.
        - **+1:** If the article has an overall sentiment score > 80% negative.

        **Global Bonuses (Apply once per crypto after analyzing all articles):**
        - **+5 Hype Bonus:** If mentioned in more than 4 articles total.
        - **+5 FUD Bonus:** If mentioned in more than 3 articles with negative sentiment.
        - **+7 Hype Bonus:** If it is a low market-cap coin (i.e., not Bitcoin or Ethereum) receiving significant attention.

        **Output Instructions:**
        1.  After calculating all scores, determine the top 2 for Hype and top 2 for FUD.
        2.  Always use the short name for each crypto for the sake of consistency.
        3.  For each of the top coins, provide an insightful, one-sentence **reasoning** that summarizes *why* it scored high, referencing key themes from the news (e.g., "High score driven by recurring positive mentions of its mainnet upgrade.").
        4.  Return your final analysis ONLY in the required JSON format.

        **ARTICLES FOR ANALYSIS:**
        ---
        {articles_context}
        ---
        `,
      );

      const toolCallingModel = this.llm.bind({
        tools: [
          {
            type: 'function',
            function: {
              name: 'hype_fud_output',
              description: 'Formats the Hype and FUD analysis.',
              parameters: {
                type: 'object',
                properties: {
                  hype: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        score: { type: 'number' },
                        reasoning: {
                          type: 'string',
                          description:
                            'Insightful one-sentence reason for the score.',
                        },
                      },
                      required: ['name', 'score', 'reasoning'],
                    },
                  },
                  fud: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        score: { type: 'number' },
                        reasoning: {
                          type: 'string',
                          description:
                            'Insightful one-sentence reason for the score.',
                        },
                      },
                      required: ['name', 'score', 'reasoning'],
                    },
                  },
                },
                required: ['hype', 'fud'],
              },
            },
          },
        ],
        // This forces the model to use our defined tool
        tool_choice: {
          type: 'function',
          function: { name: 'hype_fud_output' },
        },
      });

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

  @Cron('0 0 * * 0') // Every Sunday at midnight
  async processWeeklyInsights() {
    this.logger.log('🤖 Starting Weekly Insights processing job...');

    const today = new Date();
    const weekEndString = today.toISOString().split('T')[0];
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekStartString = sevenDaysAgo.toISOString().split('T')[0];

    try {
      const articles = await this.articleModel
        .find({ createdAt: { $gte: sevenDaysAgo } })
        .sort({ createdAt: -1 })
        .exec();

      if (articles.length < 20) {
        this.logger.log(
          'Not enough articles to process for a meaningful weekly analysis.',
        );
        return;
      }

      this.logger.log(
        `Found ${articles.length} articles to analyze for week ${weekStartString} to ${weekEndString}...`,
      );

      const articlesContext = articles
        .map(
          (a) =>
            `Source: ${a.source}\nHeadline: ${a.headline}\nSummary: ${a.summary}`,
        )
        .join('\n---\n');

      const prompt = PromptTemplate.fromTemplate(
        `**Persona:** You are an expert crypto market analyst specializing in weekly overviews.

        **Primary Goal:** Analyze the provided news articles from the past week to generate insightful weekly summaries. Identify top trends, emerging coins, and other key insights based on aggregated data. Refine scoring criteria as needed for depth.

        **Scoring Algorithm (Apply meticulously, edit/improve as criteria evolve):**

        **Trend/Emerging Points (Example - Refine):**
        - **+4:** For recurring themes across multiple sources.
        - **+3:** For mentions in titles/summaries with high impact.
        - **+2:** For positive/negative sentiment clusters.
        - **+1:** For article volume on the topic.

        **Global Bonuses (Apply once per item after analyzing all articles):**
        - **+10 Bonus:** For sudden spikes in mentions (e.g., >10 articles).
        - **+7 Bonus:** For low-cap or new coins gaining traction.
        - **+5 Bonus:** For cross-source validation.

        **Output Instructions:**
        1.  After analysis, determine top 2 trends and top 2 emerging coins (expand as criteria refine).
        2.  Always use the short name for each crypto for the sake of consistency.
        3.  For each, provide an insightful, one-sentence **reasoning** summarizing key weekly developments.
        4.  Return your final analysis ONLY as valid JSON in this exact format (no code blocks, no extra text):
        {{"topTrends": [{{"name": "Trend Name", "score": 50, "reasoning": "One-sentence reason."}}, ...], "emergingCoins": [{{"name": "Coin Name", "score": 50, "reasoning": "One-sentence reason."}}, ...]}}

        **ARTICLES FOR ANALYSIS (Past Week):**
        ---
        {articles_context}
        ---
        `,
      );

      const parser = new JsonOutputParser();

      const chain = prompt.pipe(this.weeklyInsightLlm).pipe(parser);

      const insightResult = await chain.invoke({
        articles_context: articlesContext,
      });

      await this.weeklyInsightModel.findOneAndUpdate(
        { weekStart: weekStartString },
        {
          $set: {
            insights: insightResult,
          },
        },
        {
          upsert: true,
          new: true,
        },
      );

      this.logger.log(
        `✅ Successfully processed and saved Weekly Insights for ${weekStartString} to ${weekEndString}.`,
      );
    } catch (error) {
      this.logger.error('Failed to process Weekly Insights:', error.stack);
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

  async getLatestEnrichedWeeklyInsight(): Promise<EnrichedWeeklyInsightDto | null> {
    // 1. Fetch the single most recent insight from the database
    const latestInsight = (await this.weeklyInsightModel
      .findOne()
      .sort({ createdAt: -1 }) // Use createdAt to get the true latest
      .exec()) as WeeklyInsightDocument;

    if (!latestInsight) {
      this.logger.warn('No weekly insight found in the database.');
      return null;
    }

    // 2. Collect all unique cryptocurrency NAMES from insights
    const allEntries = [
      ...latestInsight.insights.topTrends,
      ...latestInsight.insights.emergingCoins,
    ];
    const uniqueCryptoNames = [
      ...new Set(allEntries.map((entry) => entry.name)),
    ];

    if (uniqueCryptoNames.length === 0) {
      return {
        _id: latestInsight._id.toString(),
        weekStart: latestInsight.weekStart,
        createdAt: latestInsight.createdAt.toISOString(),
        insights: {
          topTrends: latestInsight.insights.topTrends,
          emergingCoins: latestInsight.insights.emergingCoins,
        },
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
        _id: latestInsight._id.toString(),
        weekStart: latestInsight.weekStart,
        createdAt: latestInsight.createdAt.toISOString(),
        insights: {
          topTrends: latestInsight.insights.topTrends,
          emergingCoins: latestInsight.insights.emergingCoins,
        },
      };
    }

    // 3. Fetch Phase: get market data by ID and build id -> crypto map
    this.logger.log(`Fetching market data for IDs: ${cryptoIds.join(', ')}`);

    const idToCrypto = await this.getCoinsMarketData(cryptoIds);

    // 4. Enrich entries using the original query -> id map, then id -> crypto map
    const enrich = (entry) => {
      const sr = queryToSearchResult.get(entry.name); // entry.name is what was in the insight (e.g. "DOGE")
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

    const enrichedEmergingCoins = latestInsight.insights.emergingCoins.map(
      (e) => enrich(e),
    );

    // 5. Return the final, combined DTO
    return {
      _id: latestInsight._id.toString(),
      weekStart: latestInsight.weekStart,
      createdAt: latestInsight.createdAt.toISOString(),
      insights: {
        topTrends: latestInsight.insights.topTrends,
        emergingCoins: enrichedEmergingCoins,
      },
    };
  }
}
