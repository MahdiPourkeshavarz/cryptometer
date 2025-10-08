/* eslint-disable prettier/prettier */
export class Crypto {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  fully_diluted_valuation: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  circulating_supply: number;
  total_supply: number;
  last_updated: string;
}

export interface SearchResult {
  id: string;
  name: string;
  symbol: string;
  api_symbol: string;
  thumb: string;
  large: string;
  market_cap_rank: number;
}
