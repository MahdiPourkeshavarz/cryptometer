/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { MarketMood, MarketMoodDocument } from './schema/market-mood.schema';
import {
  EnrichedArticle,
  ImpactfulNews,
  ImpactfulNewsDocument,
  KeywordFlag,
} from './schema/impactful-events.schema';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BatchSentimentAnalysis,
  MARKET_PROMPT_MOOD,
  SentimentAnalysis,
} from './constants/market-mood.prompt';
import { Article, ArticleDocument } from 'src/scraper/schema/article.schema';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { PromptTemplate } from '@langchain/core/prompts';
import { impactfulEventsPrompt } from './constants/impactful-events.prompt';
import { getKeywordScore } from './utils/keyword-scoring';
import {
  highImpactNegativeKeywords,
  highImpactPositiveKeywords,
  macroKeywords,
} from './constants/keywords';

@Injectable()
export class DailyProcessorService {
  private readonly logger = new Logger(DailyProcessorService.name);
  private readonly gemini: ChatGoogleGenerativeAI;

  constructor(
    @InjectModel(Article.name)
    private readonly articleModel: Model<ArticleDocument>,
    @InjectModel(MarketMood.name)
    private readonly moodModel: Model<MarketMoodDocument>,
    @InjectModel(ImpactfulNews.name)
    private readonly impactfullModel: Model<ImpactfulNewsDocument>,
    private readonly configService: ConfigService,
  ) {
    this.gemini = new ChatGoogleGenerativeAI({
      apiKey: configService.get<string>('GOOGLE_API_KEY'),
      model: 'gemini-2.0-flash',
      temperature: 0.1,
    });
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

  async getLatestDailySentiment() {
    const latestDailySentiment = (await this.moodModel
      .findOne()
      .sort({ createdAt: -1 })
      .exec()) as MarketMoodDocument;

    if (!latestDailySentiment) {
      this.logger.warn('No daily sentiment found in the database.');
      return null;
    }

    return latestDailySentiment;
  }

  async getLatestImpactfulNews() {
    const latestImpactfullNews = (await this.impactfullModel
      .findOne()
      .sort({ createsAt: -1 })
      .exec()) as ImpactfulNewsDocument;

    if (!latestImpactfullNews) {
      this.logger.warn('No daily impactful news found in the database.');
      return null;
    }

    return latestImpactfullNews;
  }
}
