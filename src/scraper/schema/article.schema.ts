/* eslint-disable prettier/prettier */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ArticleDocument = Article & Document;

@Schema({ timestamps: true })
export class Article {
  @Prop({ required: true, trim: true })
  headline: string;

  @Prop({ required: true, trim: true })
  summary: string;

  @Prop({ required: true, index: true })
  source: string;

  @Prop({ trim: true, unique: true, sparse: true })
  url: string;
}

export const ArticleSchema = SchemaFactory.createForClass(Article);

ArticleSchema.index({ headline: 1, source: 1 }, { unique: true });
