import { ordinaryLossCostPer100 } from '../../src/utils/ordinaryLoss';
import { tScale } from '../../src/utils/shockLosses';
(globalThis as any).__FOLD = () => 1;
console.log('ordinary WC y1 with fold 1:', ordinaryLossCostPer100('WC', 1), 'tScale unchanged?', tScale('WC', 100, 1));
(globalThis as any).__FOLD = undefined;
console.log('ordinary WC y1 no fold:', ordinaryLossCostPer100('WC', 1), 'tScale', tScale('WC', 100, 1));
