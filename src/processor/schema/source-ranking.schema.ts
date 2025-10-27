import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ _id: false })
class SourceScore {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  finalScore: number;
}
const SourceScoreSchema = SchemaFactory.createForClass(SourceScore);

export type SourceRankingDocument = SourceRanking & Document;

@Schema({ timestamps: true })
export class SourceRanking {
  @Prop({ required: true, unique: true, index: true })
  weekStart: string; // YYYY-MM-DD format

  @Prop({ type: SourceScoreSchema })
  bestSource: SourceScore;

  @Prop({ type: SourceScoreSchema })
  worstSource: SourceScore;
}

export const SourceRankingSchema = SchemaFactory.createForClass(SourceRanking);
