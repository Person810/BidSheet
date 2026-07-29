/**
 * Utility functions for lookups and updates in HDD custom rates tables.
 */

export function lookupTableValue(
  table: Array<[number, number]>,
  size: number,
  defaultVal: number = 0
): number {
  if (!table || table.length === 0) return defaultVal;
  
  // Find exact match first
  const exact = table.find((row) => row[0] === size);
  if (exact) return exact[1];
  
  // Otherwise fallback to upper bound lookup (same as hddCalc engine)
  for (let i = 0; i < table.length; i++) {
    if (size <= table[i][0]) return table[i][1];
  }
  return table[table.length - 1][1];
}

export function updateTableValues(
  table: Array<[number, number]>,
  sizes: number[],
  targetSize: number,
  newValue: number
): Array<[number, number]> {
  const newTable: Array<[number, number]> = [];
  for (const s of sizes) {
    let val = lookupTableValue(table, s);
    if (s === targetSize) {
      val = newValue;
    }
    newTable.push([s, val]);
  }
  return newTable;
}
