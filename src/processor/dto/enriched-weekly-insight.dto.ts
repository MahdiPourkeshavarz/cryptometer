/* eslint-disable prettier/prettier */
import { EnrichedScoreEntryDto } from './enriched-market-pulse.dto';

export class EnrichedWeeklyInsightDto {
  _id: string;
  weekStart: string;
  createdAt: string;
  insights: {
    topTrends: EnrichedScoreEntryDto[];
    emergingCoins: EnrichedScoreEntryDto[];
  };
}
