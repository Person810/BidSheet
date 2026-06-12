import { describe, it, expect } from 'vitest';
import { validateSnapshot } from './validate-snapshot';

const valid = () => ({
  format: 2 as const,
  job: { name: 'Elm Street Sewer', notes: null, overhead_percent: 10 },
  sections: [{ id: 1, name: 'Base Bid', sort_order: 0 }],
  line_items: [{ id: 1, section_id: 1, description: '8" PVC', material_uuid: 'abc' }],
  trench_profiles: [],
  quotes: [],
  takeoff: {
    settings: null,
    page_scales: [],
    page_rotations: [],
    nodes: [],
    runs: [],
    points: [],
    items: [],
    areas: [],
    area_points: [],
    annotations: [],
  },
  plan: {
    filename: 'site-plan.pdf',
    sha256: 'a'.repeat(64),
    size_bytes: 12345,
  },
});

describe('validateSnapshot', () => {
  it('accepts a well-formed snapshot (formats 1 and 2)', () => {
    expect(() => validateSnapshot(valid())).not.toThrow();
    expect(() => validateSnapshot({ ...valid(), format: 1 })).not.toThrow();
  });

  it('rejects non-objects and unknown formats', () => {
    for (const garbage of [null, 42, 'snapshot', [], { ...valid(), format: 3 }]) {
      expect(() => validateSnapshot(garbage)).toThrow(/validation|rejected/i);
    }
  });

  it('rejects unknown top-level keys (strict document skeleton)', () => {
    expect(() => validateSnapshot({ ...valid(), extra_payload: {} })).toThrow();
    const s: any = valid();
    s.takeoff.injected = [];
    expect(() => validateSnapshot(s)).toThrow();
  });

  it('rejects prototype-pollution key names in rows', () => {
    // Literal {__proto__: …} would not create an own property — JSON.parse does,
    // which is exactly how a hostile payload arrives off the wire.
    const polluted: any = valid();
    polluted.job = JSON.parse('{"name": "x", "__proto__": 1}');
    expect(() => validateSnapshot(polluted)).toThrow();

    for (const key of ['constructor', 'prototype']) {
      const s: any = valid();
      s.sections = [JSON.parse(`{"name": "x", "${key}": 1}`)];
      expect(() => validateSnapshot(s)).toThrow();
    }
  });

  it('rejects non-scalar row values (nested objects, arrays)', () => {
    const s: any = valid();
    s.line_items = [{ description: { nested: true } }];
    expect(() => validateSnapshot(s)).toThrow();
    s.line_items = [{ description: ['a', 'b'] }];
    expect(() => validateSnapshot(s)).toThrow();
  });

  it('rejects non-finite numbers', () => {
    const s: any = valid();
    s.job = { name: 'x', quantity: Infinity };
    expect(() => validateSnapshot(s)).toThrow();
    s.job = { name: 'x', quantity: NaN };
    expect(() => validateSnapshot(s)).toThrow();
  });

  it('rejects path traversal in plan.filename', () => {
    for (const bad of ['../../evil.pdf', 'a/b.pdf', 'a\\b.pdf', '..', '.', 'x\0.pdf', '']) {
      const s: any = valid();
      s.plan = { filename: bad, sha256: 'a'.repeat(64), size_bytes: 1 };
      expect(() => validateSnapshot(s)).toThrow();
    }
  });

  it('rejects malformed plan hashes and sizes', () => {
    const s: any = valid();
    s.plan = { filename: 'x.pdf', sha256: 'Z'.repeat(64), size_bytes: 1 };
    expect(() => validateSnapshot(s)).toThrow();
    s.plan = { filename: 'x.pdf', sha256: 'a'.repeat(64), size_bytes: -1 };
    expect(() => validateSnapshot(s)).toThrow();
  });

  it('names the offending path in the error', () => {
    const s: any = valid();
    s.line_items = [{ description: { nested: true } }];
    expect(() => validateSnapshot(s)).toThrow(/line_items/);
  });
});
