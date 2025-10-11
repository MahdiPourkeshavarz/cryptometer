/* eslint-disable prettier/prettier */

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WeeklyInsightDocument = WeeklyInsight & Document;

@Schema({ timestamps: true })
export class WeeklyInsight {
  @Prop({ required: true, unique: true })
  weekStart: string; // e.g., '2025-10-06' (Monday start, adjust as needed)

  @Prop({ type: Object, required: true })
  insights: {
    topTrends: Array<{ name: string; score: number; reasoning: string }>;
    emergingCoins: Array<{ name: string; score: number; reasoning: string }>;
    // Add more fields as per refined criteria/prompt
  };

  _id: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const WeeklyInsightSchema = SchemaFactory.createForClass(WeeklyInsight);
