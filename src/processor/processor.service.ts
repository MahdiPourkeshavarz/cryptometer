/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { JsonOutputFunctionsParser } from 'langchain/output_parsers';
import { Article, ArticleDocument } from 'src/scraper/schema/article.schema';
import { MarketPulse, MarketPulseDocument } from './schema/market-pulse.schema';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ProcessorService {
  private readonly logger = new Logger(ProcessorService.name);
  private readonly llm: ChatOpenAI;

  constructor(
    @InjectModel(Article.name)
    private readonly articleModel: Model<ArticleDocument>,
    @InjectModel(MarketPulse.name)
    private readonly pulseModel: Model<MarketPulseDocument>,
    private readonly configService: ConfigService,
  ) {
    this.llm = new ChatOpenAI({
      apiKey: configService.get<string>('OPENAI_API_KEY'),
      model: 'gpt-4o-mini',
      temperature: 0,
    });
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

      const parser = new JsonOutputFunctionsParser();

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

      const functionCallingModel = this.llm.bind({
        functions: [
          {
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
                  description: 'The top 2 cryptocurrencies with the most FUD.',
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
        ],
        function_call: { name: 'hype_fud_output' },
      });

      const chain = prompt.pipe(functionCallingModel).pipe(parser);

      const pulseResult: any = await chain.invoke({
        date: dateString,
        articles_context: articlesContext,
      });

      await this.pulseModel.create({
        date: dateString,
        hype: pulseResult.hype,
        fud: pulseResult.fud,
      });

      this.logger.log(
        `✅ Successfully processed and saved Hype/FUD analysis for ${dateString}.`,
      );
    } catch (error) {
      this.logger.error('Failed to process Hype & FUD analysis:', error.stack);
    }
  }

  async getLatestMarketPulse(): Promise<MarketPulse[] | null> {
    return this.pulseModel.find().sort({ date: -1 }).limit(7).exec();
  }
}
