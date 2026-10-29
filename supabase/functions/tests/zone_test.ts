import { deepStrictEqual as assertEquals } from 'node:assert/strict';
import { daysBetween, isIsoDate, todayInZone } from '../_shared/zone.ts';

Deno.test('a las 8 p. m. en Bogotá sigue siendo el mismo día aunque en UTC ya sea mañana', () => {
  // 2026-11-01 01:00 UTC = 2026-10-31 20:00 en Bogotá (UTC-5).
  assertEquals(todayInZone(new Date('2026-11-01T01:00:00Z')), '2026-10-31');
});

Deno.test('daysBetween cuenta días calendario, también entre meses y años', () => {
  assertEquals(daysBetween('2026-10-30', '2026-11-02'), 3);
  assertEquals(daysBetween('2026-12-31', '2027-01-01'), 1);
  assertEquals(daysBetween('2026-11-08', '2026-11-05'), -3);
});

Deno.test('isIsoDate rechaza fechas imposibles', () => {
  assertEquals(isIsoDate('2026-02-28'), true);
  assertEquals(isIsoDate('2026-02-30'), false);
  assertEquals(isIsoDate('15/11/2026'), false);
});
