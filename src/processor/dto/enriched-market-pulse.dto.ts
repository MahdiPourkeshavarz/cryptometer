/* eslint-disable prettier/prettier */
class ScoreEntryDto {
  name: string;
  score: number;
  reasoning: string;
}

export class EnrichedScoreEntryDto extends ScoreEntryDto {
  marketData?: Crypto;
}

export class EnrichedMarketPulseDto {
  _id: string;
  date: string;
  createdAt: string;
  hype: EnrichedScoreEntryDto[];
  fud: EnrichedScoreEntryDto[];
}
