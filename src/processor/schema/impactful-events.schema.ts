/* eslint-disable prettier/prettier */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export class KeywordFlag {
  @Prop({ required: true })
  keyword: string;

  @Prop({ required: true, enum: ['positive', 'negative', 'macro'] })
  category: 'positive' | 'negative' | 'macro';

  @Prop({ required: true })
  scoreContribution: number; // The points this specific keyword added
}

// Define the EnrichedArticle schema
export class EnrichedArticle {
  @Prop({ required: true })
  headline: string;

  @Prop({ required: true })
  summary: string;

  @Prop({ required: true })
  source: string;

  @Prop({ type: [KeywordFlag], required: true })
  flags: KeywordFlag[];

  @Prop({ required: true })
  initialKeywordScore: number;

  @Prop({ required: true })
  overallImportanceScore: number;
}

// Define the ImpactfulNews schema
export type ImpactfulNewsDocument = ImpactfulNews & Document;

@Schema({ timestamps: true })
export class ImpactfulNews {
  @Prop({
    required: true,
    default: () => new Date().toISOString().split('T')[0],
  })
  date: string; // YYYY-MM-DD format

  @Prop({ type: [EnrichedArticle], required: true })
  positiveImpactNews: EnrichedArticle[];

  @Prop({ type: [EnrichedArticle], required: true })
  negativeImpactNews: EnrichedArticle[];
}

export const ImpactfulNewsSchema = SchemaFactory.createForClass(ImpactfulNews);
