import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

class ScoreEntry {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  score: number;

  @Prop({ required: true })
  reasoning: string;
}

export type MarketPulseDocument = MarketPulse & Document;

@Schema({ timestamps: true })
export class MarketPulse {
  @Prop({ required: true, unique: true, index: true })
  date: string; // YYYY-MM-DD format

  @Prop({ type: [ScoreEntry] })
  hype: ScoreEntry[];

  @Prop({ type: [ScoreEntry] })
  fud: ScoreEntry[];
}

export const MarketPulseSchema = SchemaFactory.createForClass(MarketPulse);
