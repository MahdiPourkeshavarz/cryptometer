/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { Article, ArticleDocument } from 'src/scraper/schema/article.schema';
import { WEEKLY_SOURCE_RANKING_PROMPT } from './constants/weekly-source-prompt';
import { PromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import {
  SourceRanking,
  SourceRankingDocument,
} from './schema/source-ranking.schema';
import {
  WeeklyInsight,
  WeeklyInsightDocument,
} from './schema/weekly-insight.schema';
import { WEEKLY_ANALYSIS_PROMPT } from './constants/weekly-analysis.prompt';
import { EnrichedWeeklyInsightDto } from './dto/enriched-weekly-insight.dto';

@Injectable()
export class WeeklyProcessorService {
  private readonly logger = new Logger(WeeklyProcessorService.name);
  private readonly gemini: ChatGoogleGenerativeAI;

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(Article.name)
    private readonly articleModel: Model<ArticleDocument>,
    @InjectModel(SourceRanking.name)
    private readonly sourceRankingModel: Model<SourceRankingDocument>,
    @InjectModel(WeeklyInsight.name)
    private readonly weeklyInsightModel: Model<WeeklyInsightDocument>,
  ) {
    this.gemini = new ChatGoogleGenerativeAI({
      // error for here
      apiKey: configService.get<string>('GOOGLE_API_KEY'),
      model: 'gemini-2.0-flash',
      temperature: 0.1,
    });
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

  async getLatestWeeklyInsight(): Promise<EnrichedWeeklyInsightDto | null> {
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

  async getLatestSource() {
    const latestSources = (await this.sourceRankingModel
      .findOne()
      .sort({ createdAt: -1 })
      .exec()) as SourceRankingDocument;

    if (!latestSources) {
      this.logger.warn('No sources found in the database.');
      return;
    }
    return latestSources;
  }
}
