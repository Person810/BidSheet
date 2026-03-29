import type { TradeModule } from '../types';

export const undergroundModule: TradeModule = {
  id: 'underground',
  name: 'Utilities',
  icon: '',
  tools: [
    {
      id: 'trench-profiler',
      name: 'Trench Profiler',
      path: '/tools/trench-profiler',
      icon: '',
    },
    {
      id: 'plan-takeoff',
      name: 'Plan Takeoff',
      path: '/tools/plan-takeoff',
      icon: '',
    },
  ],
};
