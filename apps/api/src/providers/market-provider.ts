import type { HistoryRange } from '@marketpulse/contracts';
import type {
  CatalogAsset,
  Mode,
  NormalizedQuote,
  Point,
  Source,
} from '../modules/markets/types.js';
export interface MarketProvider {
  readonly source: Source;
  readonly mode: Mode;
  quotes(assets: CatalogAsset[], now: number): Promise<NormalizedQuote[]>;
  history(
    asset: CatalogAsset,
    range: HistoryRange,
    now: number,
  ): Promise<Point[]>;
}
