import type { TradeModule } from '../types';

export const undergroundModule: TradeModule = {
  id: 'underground',
  name: 'Utilities',
  icon: '',
  // Trench Profiler is temporarily disabled while it gets more polish.
  // The component and calc code remain in place -- re-add the tool entry
  // below to bring it back into the sidebar and routing.
  tools: [],
};
