import type { TradeModule } from '../types';

export const concreteModule: TradeModule = {
  id: 'concrete',
  name: 'Concrete',
  icon: '',
  tools: [
    {
      id: 'concrete-calculator',
      name: 'Concrete Calculator',
      path: '/tools/concrete-calculator',
      icon: '',
    },
  ],
};
