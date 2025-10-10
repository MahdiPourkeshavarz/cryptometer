/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
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
import { ChatGroq } from '@langchain/groq';

@Injectable()
export class ProcessorService {
  private readonly logger = new Logger(ProcessorService.name);
  private readonly llm: ChatGroq;
  private readonly baseUrl = 'https://api.coingecko.com/api/v3';
  private readonly apiKey: string;

  constructor(
    @InjectModel(Article.name)
    private readonly articleModel: Model<ArticleDocument>,
    @InjectModel(MarketPulse.name)
    private readonly pulseModel: Model<MarketPulseDocument>,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.llm = new ChatGroq({
      apiKey: configService.get<string>('GROQ_API_KEY'),
      model: 'llama-3.3-70b-versatile',
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
        `You are a meticulous crypto analyst bot. Your task is to calculate "Hype" and "FUD" scores for cryptocurrencies based on a strict set of rules applied to the provided articles.

        **Instructions:**
        1. First, identify all unique cryptocurrency names mentioned across all articles.
        2. For each unique cryptocurrency, calculate its Hype and FUD scores by meticulously applying the following rules to every article.

        **Hype Scoring Rules:**
        - **+3 points:** if the crypto name appears in an article's **title**.
        - **+2 points:** if the crypto name appears in an article's **summary**.
        - **+1 point bonus:** for each crypto mentioned in an article if that article's overall sentiment is over 80% positive.

        **FUD Scoring Rules:**
        - **+3 points:** for a crypto if it is in a **title** with negative sentiment.
        - **+2 points:** for a crypto if it is in a **summary** with negative sentiment.
        - **+1 point bonus:** for each crypto mentioned in an article if that article's overall sentiment is over 80% negative.

        **Final Bonus Point Rules (Apply After Scoring All Articles):**
        - **+7 Hype bonus:** if a crypto was a candidate for hype of the day and it was'nt in top ten in market rank.
        - **+5 Hype bonus:** if a crypto appears in more than 4 articles in total.
        - **+5 FUD bonus:** if a crypto appears in more than 3 articles that have an overall negative sentiment.

        3. After calculating the final scores for ALL cryptocurrencies, identify the top 2 for Hype and the top 2 for FUD.
        4. Return ONLY the final top 2 lists in the required JSON format.

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
                    description: 'The top 2 hyped cryptocurrencies.',
                    items: {
                      type: 'object',
                      properties: {
                        name: {
                          type: 'string',
                          description: 'Name of the cryptocurrency.',
                        },
                        score: {
                          type: 'number',
                          description: 'Hype score from 1-100.',
                        },
                        reasoning: {
                          type: 'string',
                          description: 'Brief reason for the score.',
                        },
                      },
                      required: ['name', 'score', 'reasoning'],
                    },
                  },
                  fud: {
                    type: 'array',
                    description:
                      'The top 2 cryptocurrencies with the most FUD.',
                    items: {
                      type: 'object',
                      properties: {
                        name: {
                          type: 'string',
                          description: 'Name of the cryptocurrency.',
                        },
                        score: {
                          type: 'number',
                          description: 'FUD score from 1-100.',
                        },
                        reasoning: {
                          type: 'string',
                          description: 'Brief reason for the score.',
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
        // This forces the model to call the specified tool, similar to function_call
        tool_choice: {
          type: 'function',
          function: { name: 'hype_fud_output' },
        },
      });

      const chain = prompt.pipe(toolCallingModel).pipe(parser);

      const pulseResult: any = await chain.invoke({
        date: dateString,
        articles_context: articlesContext,
      });

      await this.pulseModel.findOneAndUpdate(
        { date: dateString },
        {
          $set: {
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
