import type { TradeModule, TradeModuleTool } from './types';
import { undergroundModule } from './underground';
import { concreteModule } from './concrete';

// Maps TradeType values (from seed-data / app_settings.trade_types) to modules.
// Multiple trade types can map to the same module (water_sewer and storm_drain
// both fall under the underground utility module).
const MODULE_MAP: Record<string, TradeModule> = {
  water_sewer: undergroundModule,
  storm_drain: undergroundModule,
  concrete: concreteModule,
  // future: gas, electrical, telecom, steel, roofing, etc.
};

/** Every module that can contribute tools, in registration order. */
const ALL_MODULES: TradeModule[] = [undergroundModule, concreteModule];

/** One labelled block of tools in the sidebar. */
export interface ToolGroup {
  id: string;
  name: string;
  tools: TradeModuleTool[];
}

/** A tool plus the module it came from, for the settings picker. */
export interface RegisteredTool {
  moduleId: string;
  moduleName: string;
  tool: TradeModuleTool;
}

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

/** Every tool the app knows about, whatever the user's trades are. */
export function getAllTools(): RegisteredTool[] {
  return ALL_MODULES
    .flatMap((mod) =>
      mod.tools.map((tool) => ({ moduleId: mod.id, moduleName: mod.name, tool }))
    )
    .sort((a, b) => a.tool.name.localeCompare(b.tool.name));
}

function parseIds(list: string): string[] {
  return list.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * What the sidebar shows.
 *
 * `enabledTools` is null for everyone who hasn't picked tools by hand: the
 * groups come from their trades, exactly as before. Once they have picked,
 * that list wins outright and lands in a single "Tools" group — the point of
 * choosing is that the sidebar stops being a side effect of which catalogs
 * you seeded (see migration v46).
 *
 * Unknown ids are dropped rather than shown as dead links, so a saved
 * selection survives a tool being renamed or retired.
 */
export function resolveToolGroups(
  tradeTypes: string | null | undefined,
  enabledTools: string | null | undefined
): ToolGroup[] {
  if (enabledTools == null) {
    return getActiveModules(tradeTypes || '')
      .filter((mod) => mod.tools.length > 0)
      .map((mod) => ({ id: mod.id, name: mod.name, tools: mod.tools }));
  }

  const wanted = new Set(parseIds(enabledTools));
  const tools = getAllTools()
    .filter((entry) => wanted.has(entry.tool.id))
    .map((entry) => entry.tool);
  return tools.length > 0 ? [{ id: 'tools', name: 'Tools', tools }] : [];
}

/**
 * The ids to tick in the tool picker. A hand-picked selection speaks for
 * itself; otherwise it mirrors what the trades are currently showing, so the
 * picker opens on what's already on screen rather than on nothing.
 */
export function currentToolSelection(
  tradeTypes: string | null | undefined,
  enabledTools: string | null | undefined
): string[] {
  if (enabledTools != null) {
    const known = new Set(getAllTools().map((entry) => entry.tool.id));
    return parseIds(enabledTools).filter((id) => known.has(id));
  }
  return getActiveModules(tradeTypes || '').flatMap((mod) =>
    mod.tools.map((tool) => tool.id)
  );
}

/**
 * What to store for a picked set.
 *
 * Both pickers open pre-ticked with the trade-derived tools, so a selection
 * that still matches the trades is not a choice at all — it's the default
 * left alone. That case stores null ("follow my trades"), which keeps a trade
 * added later free to bring its tools along. Anything else is stored in
 * registry order with stale ids dropped, so the saved string is stable.
 */
export function normalizeToolSelection(
  tradeTypes: string | null | undefined,
  enabledTools: string | null | undefined
): string | null {
  if (enabledTools == null) return null;

  const wanted = new Set(parseIds(enabledTools));
  const ordered = getAllTools()
    .map((entry) => entry.tool.id)
    .filter((id) => wanted.has(id));

  const fromTrades = currentToolSelection(tradeTypes, null);
  const matchesTrades =
    ordered.length === fromTrades.length && fromTrades.every((id) => wanted.has(id));

  return matchesTrades ? null : ordered.join(',');
}
