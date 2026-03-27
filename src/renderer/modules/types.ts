// Trade module type definitions
// Each trade module exports a manifest matching this shape.

export interface TradeModuleTool {
  id: string;
  name: string;
  path: string;       // route path, e.g. '/tools/trench-profiler'
  icon?: string;
}

export interface TradeModule {
  id: string;
  name: string;
  icon: string;
  tools: TradeModuleTool[];
}
