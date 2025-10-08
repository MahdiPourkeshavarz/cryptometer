import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

class ScoreEntry {
  toObject(): any {
    throw new Error('Method not implemented.');
  }
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  score: number;

  @Prop({ required: true })
  reasoning: string;
}

export type MarketPulseDocument = MarketPulse &
  Document & {
    toObject: () => MarketPulse;
  };

@Schema({ timestamps: true })
export class MarketPulse {
  @Prop({ required: true, unique: true, index: true })
  date: string; // YYYY-MM-DD format

  @Prop({ type: [ScoreEntry] })
  hype: ScoreEntry[];

  @Prop({ type: [ScoreEntry] })
  fud: ScoreEntry[];

  _id: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const MarketPulseSchema = SchemaFactory.createForClass(MarketPulse);
