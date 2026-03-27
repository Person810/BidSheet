import type { TradeModule } from './types';
import { undergroundModule } from './underground';

// Maps TradeType values (from seed-data / app_settings.trade_types) to modules.
// Multiple trade types can map to the same module (water_sewer and storm_drain
// both fall under the underground utility module).
const MODULE_MAP: Record<string, TradeModule> = {
  water_sewer: undergroundModule,
  storm_drain: undergroundModule,
  // future: gas, electrical, telecom, steel, roofing, etc.
};

/**
 * Given the comma-separated trade_types string from app_settings,
 * returns the unique list of active trade modules.
 */
export function getActiveModules(tradeTypes: string): TradeModule[] {
  const keys = tradeTypes.split(',').map(s => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const result: TradeModule[] = [];
  for (const key of keys) {
    const mod = MODULE_MAP[key];
    if (mod && !seen.has(mod.id)) {
      seen.add(mod.id);
      result.push(mod);
    }
  }
  return result;
}
