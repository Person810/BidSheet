import { describe, it, expect } from 'vitest';
import path from 'path';
import { assertCloudId } from './cloud-id';

/**
 * Cloud job ids arrive from GET /jobs — from the Worker, which this codebase
 * models as untrusted, and from any org member running a patched client.
 * `pullJob` builds a filesystem directory out of one, so the id is the
 * difference between writing into the plan store and writing into the
 * victim's home directory.
 */
describe('assertCloudId', () => {
  it('accepts a canonical UUID in either case', () => {
    expect(assertCloudId('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    );
    expect(assertCloudId('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBeTruthy();
  });

  it.each([
    ['..'],
    ['../../..'],
    ['../../../evil'],
    ['..%2F..%2F..%2Fevil'],
    ['3f2504e0-4f89-41d3-9a0c-0305e82c3301/../..'],
    ['/etc'],
    ['C:\\Users\\bob'],
    ['not-a-uuid'],
    [''],
  ])('rejects %j', (bad) => {
    expect(() => assertCloudId(bad)).toThrow(/Invalid cloud job id/);
  });

  it.each([[null], [undefined], [42], [{}], [['a']]])('rejects the non-string %j', (bad) => {
    expect(() => assertCloudId(bad)).toThrow(/Invalid cloud job id/);
  });

  it('every accepted id stays inside the plan store when joined', () => {
    // The property that actually matters: nothing that survives the assertion
    // can walk out of cloud-plans/.
    const root = path.resolve('/home/bob/.config/BidSheet/cloud-plans');
    for (const id of [
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      '00000000-0000-4000-8000-000000000000',
      'FFFFFFFF-FFFF-4FFF-BFFF-FFFFFFFFFFFF',
    ]) {
      const dir = path.resolve(root, assertCloudId(id));
      expect(dir.startsWith(root + path.sep)).toBe(true);
    }
  });
});
