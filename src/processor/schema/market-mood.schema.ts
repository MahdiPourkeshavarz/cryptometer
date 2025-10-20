/* eslint-disable prettier/prettier */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MarketMoodDocument = MarketMood & Document;

@Schema({ timestamps: true })
export class MarketMood {
  @Prop({ required: true, unique: true, index: true })
  date: string; // YYYY-MM-DD format

  @Prop({ required: true })
  score: number; // The final 0-100 Mood Index
}

export const MarketMoodSchema = SchemaFactory.createForClass(MarketMood);
