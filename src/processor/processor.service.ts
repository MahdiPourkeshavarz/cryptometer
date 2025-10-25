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
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import {
  WeeklyInsight,
  WeeklyInsightDocument,
} from './schema/weekly-insight.schema';
import { EnrichedWeeklyInsightDto } from './dto/enriched-weekly-insight.dto';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { LLM_OPTIONS } from './constants/daily.analysis.option';
import { DAILY_ANALYSIS_PROMPT } from './constants/daily-analysis.prompt';
import { WEEKLY_ANALYSIS_PROMPT } from './constants/weekly-analysis.prompt';
import {
  BatchSentimentAnalysis,
  MARKET_PROMPT_MOOD,
  SentimentAnalysis,
} from './constants/market-mood.prompt';
import { MarketMood, MarketMoodDocument } from './schema/market-mood.schema';
import {
  EnrichedArticle,
  highImpactNegativeKeywords,
  highImpactPositiveKeywords,
  KeywordFlag,
  macroKeywords,
} from './constants/keywords';
import { getKeywordScore } from './utils/keyword-scoring';
import { impactfulEventsPrompt } from './constants/impactful-events.prompt';
import {
  ImpactfulNews,
  ImpactfulNewsDocument,
} from './schema/impactful-events.schema';
import {
  SourceRanking,
  SourceRankingDocument,
} from './schema/source-ranking.schema';
import { WEEKLY_SOURCE_RANKING_PROMPT } from './constants/weekly-source-prompt';

@Injectable()
export class ProcessorService {
  private readonly logger = new Logger(ProcessorService.name);
  private readonly openAi: ChatOpenAI;
  private readonly gemini: ChatGoogleGenerativeAI;
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
    @InjectModel(MarketMood.name)
    private readonly moodModel: Model<MarketMoodDocument>,
    @InjectModel(ImpactfulNews.name)
    private readonly impactfullModel: Model<ImpactfulNewsDocument>,
    @InjectModel(SourceRanking.name)
    private readonly sourceRankingModel: Model<SourceRankingDocument>,
  ) {
    this.openAi = new ChatOpenAI({
      apiKey: configService.get<string>('OPENAI_API_KEY'),
      model: 'gpt-4o-mini',
      temperature: 0,
    });
    this.gemini = new ChatGoogleGenerativeAI({
      apiKey: configService.get<string>('GOOGLE_API_KEY'),
      model: 'gemini-2.0-flash',
      temperature: 0.1,
    });
    this.apiKey = this.configService.get<string>('COINGECKO_API_KEY') as string;
  }

  @Cron('0 0 * * 0') // Every Sunday at 1 AM
  async processWeeklySourceRanking() {
    this.logger.log(
      '🏆 Starting Weekly Source Ranking job (Single AI Call)...',
    );

    const sixDaysAgo = new Date();
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
    const weekStartString = sixDaysAgo.toISOString().split('T')[0];

    try {
      const articles = await this.articleModel
        .find({ createdAt: { $gte: sixDaysAgo } })
        .select('headline summary source') // Select necessary fields
        .exec();

      // Set a reasonable minimum threshold for analysis
      if (articles.length < 50) {
        this.logger.warn(
          `Not enough articles (${articles.length}) in the last week for a meaningful source ranking. Minimum required: 50.`,
        );
        return;
      }

      this.logger.log(
        `Analyzing all ${articles.length} articles from the past week for source ranking...`,
      );

      // Format all articles for the single prompt context
      const articlesContext = articles
        .map(
          (a) =>
            `Source: ${a.source}\nHeadline: ${a.headline}\nSummary: ${a.summary}`,
        )
        .join('\n---\n');

      // Use the engineered prompt below (WEEKLY_SOURCE_RANKING_PROMPT)
      const prompt = PromptTemplate.fromTemplate(WEEKLY_SOURCE_RANKING_PROMPT);
      const parser = new JsonOutputParser(); // Use JsonOutputParser for Gemini
      const chain = prompt.pipe(this.gemini).pipe(parser);

      this.logger.log(
        'Sending articles to Gemini for scoring and aggregation...',
      );

      // Single AI Call to perform all steps
      const rankingResult = (await chain.invoke({
        articles_context: articlesContext,
      })) as {
        bestSource: { name: string; finalScore: number };
        worstSource: { name: string; finalScore: number };
      };

      // Validate the result structure (basic check)
      if (
        !rankingResult ||
        !rankingResult.bestSource ||
        !rankingResult.worstSource
      ) {
        throw new Error(
          'AI response did not contain the expected bestSource and worstSource fields.',
        );
      }

      // Save the result from the AI directly
      await this.sourceRankingModel.findOneAndUpdate(
        { weekStart: weekStartString },
        {
          $set: {
            bestSource: rankingResult.bestSource,
            worstSource: rankingResult.worstSource,
          },
        },
        {
          upsert: true,
          new: true,
        },
      );

      this.logger.log(
        `✅ Successfully processed and saved Weekly Source Rankings for week starting ${weekStartString}. Best: ${rankingResult.bestSource.name} (${rankingResult.bestSource.finalScore}), Worst: ${rankingResult.worstSource.name} (${rankingResult.worstSource.finalScore})`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to process Weekly Source Rankings:',
        error.stack,
      );
    }
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

      const prompt = PromptTemplate.fromTemplate(WEEKLY_ANALYSIS_PROMPT);

      const parser = new JsonOutputParser();

      const chain = prompt.pipe(this.gemini).pipe(parser);

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

  @Cron(CronExpression.EVERY_4_HOURS)
  async analyzeAndStoreDailySentiment() {
    this.logger.log(
      '🚀 Starting daily crypto market sentiment analysis (BATCH MODE)...',
    );

    try {
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setDate(twentyFourHoursAgo.getDate() - 1);
      const dateString = new Date().toISOString().split('T')[0];

      // 1. FETCH
      const articles = await this.articleModel
        .find({ createdAt: { $gte: twentyFourHoursAgo } })
        .exec();

      if (articles.length === 0) {
        this.logger.warn('No articles found in the last 24 hours to analyze.');
        return;
      }

      this.logger.log(
        `Analyzing ${articles.length} articles in a single batch...`,
      );

      // 2. MAP (Consolidate into one string)
      const articlesContext = articles
        .map((a) => `Headline: ${a.headline}\nSummary: ${a.summary}`)
        .join('\n---\n'); // Separate articles with a clear delimiter

      // 3. SINGLE LLM CALL
      const parser = new JsonOutputParser<BatchSentimentAnalysis>();
      const prompt = PromptTemplate.fromTemplate(MARKET_PROMPT_MOOD);
      const chain = prompt.pipe(this.gemini).pipe(parser);

      const batchResult = await chain.invoke({
        articles_context: articlesContext,
      });

      const sentimentResults: SentimentAnalysis[] = batchResult.analyses;

      this.logger.log(
        `Received sentiment analyses for ${sentimentResults.length} articles.`,
      );

      const finalScore = this.calculateDailyMoodIndex(sentimentResults);

      // 5. STORE
      await this.moodModel.updateOne(
        { date: dateString },
        { $set: { score: finalScore } },
        { upsert: true },
      );

      this.logger.log(
        `✅ Successfully calculated and stored Daily Mood Index for ${dateString}: ${finalScore}`,
      );
    } catch (error) {
      this.logger.error(
        'An error occurred during the daily sentiment analysis job:',
        error.stack,
      );
    }
  }

  private calculateDailyMoodIndex(results: SentimentAnalysis[]): number {
    // --- Tunable Parameters ---
    const DEAD_ZONE_THRESHOLD = 30;
    const EXPONENT = 2;
    // New Parameter: The percentage of scores to trim from each end. 0.1 = 10%
    const TRIM_PERCENTAGE = 0.1;

    const impactfulScores: number[] = [];

    for (const result of results) {
      if (
        result.sentiment === 'neutral' ||
        result.confidence < DEAD_ZONE_THRESHOLD
      ) {
        continue;
      }
      const direction = result.sentiment === 'positive' ? 1 : -1;
      const normalizedConfidence =
        (result.confidence - DEAD_ZONE_THRESHOLD) / (100 - DEAD_ZONE_THRESHOLD);
      const magnitude = Math.pow(normalizedConfidence, EXPONENT);
      impactfulScores.push(direction * magnitude);
    }

    if (impactfulScores.length === 0) {
      return 50; // Neutral
    }

    // --- NEW: TRIMMED MEAN LOGIC ---

    // 1. Sort the scores from lowest to highest
    impactfulScores.sort((a, b) => a - b);

    // 2. Determine how many items to trim from each end
    const trimCount = Math.floor(impactfulScores.length * TRIM_PERCENTAGE);

    // 3. Create a new array with the trimmed values
    const trimmedScores = impactfulScores.slice(
      trimCount,
      impactfulScores.length - trimCount,
    );

    if (trimmedScores.length === 0) {
      // This can happen if we trim everything, so fall back to a neutral score
      return 50;
    }

    // 4. Calculate the mean of ONLY the trimmed array
    const totalScore = trimmedScores.reduce((sum, score) => sum + score, 0);
    const averageImpact = totalScore / trimmedScores.length;
    // --- END OF NEW LOGIC ---

    const moodIndex = (averageImpact + 1) * 50;
    return Math.round(moodIndex);
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
    const latestInsight = (await this.weeklyInsightModel
      .findOne()
      .sort({ createdAt: -1 }) // Use createdAt to get the true latest
      .exec()) as WeeklyInsightDocument;

    if (!latestInsight) {
      this.logger.warn('No weekly insight found in the database.');
      return null;
    }

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

  async getLatestDailySentiment() {
    const latestMood = (await this.moodModel
      .findOne()
      .sort({ createdAt: -1 })
      .exec()) as MarketMoodDocument;

    if (!latestMood) {
      this.logger.warn('No market mood found in the database.');
      return null;
    }
    return latestMood;
  }

  @Cron(CronExpression.EVERY_4_HOURS)
  async identifyImpactfulNews() {
    this.logger.log(
      '🤖 Starting impactful news identification (JS Pre-processing + AI Synthesis)...',
    );

    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setDate(twentyFourHoursAgo.getDate() - 1);
    const dateString = new Date().toISOString().split('T')[0];

    // 1. FETCH
    const articles = await this.articleModel
      .find({ createdAt: { $gte: twentyFourHoursAgo } })
      .exec();

    // --- STAGE 1: JAVASCRIPT PRE-PROCESSING ---
    this.logger.log(
      `Pre-processing ${articles.length} articles with keyword scoring...`,
    );
    const enrichedArticles: EnrichedArticle[] = articles.map((article) => {
      const { flags, initialKeywordScore } = this.calculateInitialScoreAndFlags(
        {
          headline: article.headline,
          summary: article.summary,
        },
      );
      const overallImportanceScore = this.calculateOverallImportanceScore(
        initialKeywordScore,
        flags,
      );

      return {
        headline: article.headline,
        summary: article.summary,
        source: article.source,
        flags: flags, // The detailed flags array
        initialKeywordScore: initialKeywordScore, // Score just from keywords
        overallImportanceScore: overallImportanceScore, // Final JS calculated score
      };
    });

    enrichedArticles.sort(
      (a, b) => b.overallImportanceScore - a.overallImportanceScore,
    );

    // 4. Format Input for AI (including the new scores/flags)
    const articlesContext = enrichedArticles
      .map(
        (a) =>
          `---\nHeadline: ${a.headline}\nSummary: ${a.summary}\nSource: ${a.source}\nImportanceScore: ${a.overallImportanceScore}\nFlags: ${a.flags.map((f) => f.keyword).join(', ')}\n---`,
      )
      .join('\n'); // Pass the calculated score and keywords

    this.logger.log('Sending enriched data to AI for synthesis...');

    try {
      const parser = new JsonOutputParser();
      const prompt = PromptTemplate.fromTemplate(impactfulEventsPrompt);
      const chain = prompt.pipe(this.gemini).pipe(parser); // Use Gemini

      const result: any = await chain.invoke({
        articles_context: articlesContext,
      });

      const negativeImpactNews = result.negativeImpactNews;
      const positiveImpactNews = result.positiveImpactNews;

      await this.impactfullModel.updateOne(
        { date: dateString },
        { $set: { positiveImpactNews, negativeImpactNews } },
        { upsert: true },
      );
      this.logger.log('✅ Successfully identified and saved impactful news.');
    } catch (error) {
      this.logger.error('Failed during AI synthesis stage:', error.stack);
    }
  }

  private calculateOverallImportanceScore(
    initialScore: number,
    flags: KeywordFlag[],
  ): number {
    let score = initialScore;

    // Define weights for different flag categories
    const weights = { positive: 1.0, negative: 1.3, macro: 1.7 };
    let maxWeight = 1.0;
    let hasMacro = false;

    flags.forEach((flag) => {
      maxWeight = Math.max(maxWeight, weights[flag.category]);
      if (flag.category === 'macro') hasMacro = true;
    });

    // Apply the highest weight found
    score *= maxWeight;

    // Bonus for multiple distinct flags
    const uniqueKeywordsCount = flags.length;
    if (uniqueKeywordsCount >= 3) score *= 1.2;
    else if (uniqueKeywordsCount === 2) score *= 1.1;

    // Specific bonus if a macro keyword was present
    if (hasMacro) score *= 1.3;

    return Math.round(score);
  }

  private calculateInitialScoreAndFlags(article: {
    headline: string;
    summary: string;
  }): { flags: KeywordFlag[]; initialKeywordScore: number } {
    const text = `${article.headline} ${article.summary}`;
    const foundKeywords = new Set<string>();
    const flags: KeywordFlag[] = [];
    let initialKeywordScore = 0;

    const checkAndAdd = (
      keyword: string,
      category: 'positive' | 'negative' | 'macro',
      list: string[],
    ) => {
      if (text.includes(keyword) && !foundKeywords.has(keyword)) {
        let scoreContribution = getKeywordScore(keyword, list);
        // Title Bonus
        if (article.headline.includes(keyword)) {
          scoreContribution *= 1.5;
        }
        scoreContribution = Math.round(scoreContribution); // Keep scores clean

        flags.push({ keyword, category, scoreContribution });
        initialKeywordScore += scoreContribution;
        foundKeywords.add(keyword);
      }
    };

    highImpactPositiveKeywords.forEach((kw) =>
      checkAndAdd(kw, 'positive', highImpactPositiveKeywords),
    );
    highImpactNegativeKeywords.forEach((kw) =>
      checkAndAdd(kw, 'negative', highImpactNegativeKeywords),
    );
    macroKeywords.forEach((kw) => checkAndAdd(kw, 'macro', macroKeywords));

    return { flags, initialKeywordScore };
  }

  async getLatestImpactfulNews() {
    const latestImpactful = (await this.impactfullModel
      .findOne()
      .sort({ createdAt: -1 })
      .exec()) as ImpactfulNewsDocument;

    if (!latestImpactful) {
      this.logger.warn('No market mood found in the database.');
      return null;
    }
    return latestImpactful;
  }
}
