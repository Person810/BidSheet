import { describe, it, expect } from 'vitest';
import {
  parsePits, serializePits, pitVolumeCY, nextPitLabel, summarizePits, type TrenchPit,
} from './trenchPits';

const pit = (id: string, w = 4, l = 6, d = 5, label = id): TrenchPit => ({ id, label, widthFt: w, lengthFt: l, depthFt: d });

describe('pitVolumeCY', () => {
  it('is width × length × depth in cubic yards', () => {
    expect(pitVolumeCY({ widthFt: 3, lengthFt: 9, depthFt: 6 })).toBeCloseTo(6); // 162 CF
  });
  it('treats missing or negative dimensions as zero', () => {
    expect(pitVolumeCY({ widthFt: -3, lengthFt: 9, depthFt: 6 })).toBe(0);
    expect(pitVolumeCY({ widthFt: NaN, lengthFt: 9, depthFt: 6 })).toBe(0);
  });
});

describe('parsePits', () => {
  it('round-trips through serializePits', () => {
    const pits = [pit('a', 4, 8, 6, 'Launch'), pit('b', 3, 6, 4, 'Exit')];
    expect(parsePits(serializePits(pits))).toEqual(pits);
  });

  it('survives junk from a synced seat', () => {
    expect(parsePits(null)).toEqual([]);
    expect(parsePits('not json')).toEqual([]);
    expect(parsePits('{"id":"a"}')).toEqual([]);
    expect(parsePits(JSON.stringify([
      null, 7, { label: 'no id' }, { id: 'a', widthFt: 'x', lengthFt: -2, depthFt: 5 }, { id: 'a', label: 'dup' },
    ]))).toEqual([{ id: 'a', label: '', widthFt: 0, lengthFt: 0, depthFt: 5 }]);
  });
});

describe('nextPitLabel', () => {
  it('continues past the highest P-number', () => {
    expect(nextPitLabel([])).toBe('P1');
    expect(nextPitLabel([pit('a', 1, 1, 1, 'P1'), pit('b', 1, 1, 1, 'Bend'), pit('c', 1, 1, 1, 'P7')])).toBe('P8');
  });
});

describe('summarizePits', () => {
  it('counts a pit shared at a change of direction once', () => {
    // Run 1: P1 -> P2, Run 2: P2 -> P3. P2 is the bend both runs use.
    const pits = [pit('p1'), pit('p2'), pit('p3')];
    const s = summarizePits(pits, [
      { start_pit_id: 'p1', end_pit_id: 'p2' },
      { start_pit_id: 'p2', end_pit_id: 'p3' },
    ]);
    expect(s.count).toBe(3);
    expect(s.used.map((u) => u.pit.id)).toEqual(['p1', 'p2', 'p3']);
    expect(s.used[1].profileIndexes).toEqual([0, 1]);
    expect(s.excavationCY).toBeCloseTo(3 * pitVolumeCY(pit('x')));
  });

  it('leaves unreferenced pits out of the totals and ignores dangling links', () => {
    const pits = [pit('p1'), pit('spare')];
    const s = summarizePits(pits, [{ start_pit_id: 'p1', end_pit_id: 'deleted-pit' }, {}]);
    expect(s.count).toBe(1);
    expect(s.unused.map((p) => p.id)).toEqual(['spare']);
    expect(s.excavationCY).toBeCloseTo(pitVolumeCY(pits[0]));
  });

  it('counts a run that starts and ends at the same pit once', () => {
    const s = summarizePits([pit('p1')], [{ start_pit_id: 'p1', end_pit_id: 'p1' }]);
    expect(s.count).toBe(1);
    expect(s.used[0].profileIndexes).toEqual([0]);
  });
});
