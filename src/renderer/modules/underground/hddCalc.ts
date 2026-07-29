import type { CalcBreakdown } from '../../../shared/calcExplain';

export interface HDDInput {
  location: 'metro' | 'regional';
  dn: number; // pipe size in mm for AU, inches for US
  /**
   * ALWAYS canonical feet, in every locale — not meters for AU. Lengths are
   * stored imperial throughout the app and converted for display, so a 100 m
   * run reaches here as 328.084. calculateHDD does the metric conversion
   * itself; passing meters prices that run as a 328 m bore.
   *
   * The `dn` comment above is genuinely locale-dependent. This one is not,
   * and used to claim it was.
   */
  length: number;
  includeSlurry?: boolean;
  includePits?: boolean;
  marginPct?: number;
  locale?: string;
  customRates?: any;
  boresPerPit?: number;
  isBundle?: boolean;
  additionalPipes?: Array<{ pipeSizeIn: number; pipeMaterialId: number | string | null }>;
}

export interface HDDOutput {
  summary: {
    ratePerUnit: number;
    totalEstimate: number;
    durationDays: number;
    crewSize: number;
  };
  breakdown: {
    establishment: number;
    crewAndRigSpread: number;
    drillingFluids: number;
    slurryDisposal: number;
    excavatorAllowance: number;
    margin: number;
  };
}

export const DEFAULT_RATES = {
  'en-AU': {
    sizes: [63, 90, 110, 160, 200, 250, 300, 355, 400, 450, 500, 560, 630, 710],
    establishment: {
      metro: [[90, 7000], [160, 9000], [250, 12000], [355, 15000], [450, 20000], [560, 28000], [710, 40000]] as Array<[number, number]>,
      regional: [[90, 13000], [160, 17000], [250, 28000], [355, 35000], [450, 48000], [560, 65000], [710, 90000]] as Array<[number, number]>
    },
    typicalShot: [
      [63, 80], [90, 100], [110, 120], [160, 150], [200, 180], [250, 220],
      [300, 250], [355, 300], [400, 350], [450, 400], [500, 450], [560, 500], [630, 550], [710, 600]
    ] as Array<[number, number]>,
    productionRate: {
      regional: [[63, 80], [90, 80], [110, 70], [160, 65], [200, 55], [250, 50], [300, 42], [355, 38], [400, 32], [450, 28], [500, 25], [560, 22], [630, 18], [710, 15]] as Array<[number, number]>,
      metro: [[63, 55], [90, 55], [110, 48], [160, 45], [200, 38], [250, 34], [300, 28], [355, 25], [400, 21], [450, 18], [500, 16], [560, 14], [630, 11], [710, 9]] as Array<[number, number]>
    },
    crewSize: [[90, 3], [160, 4], [355, 5], [450, 6], [560, 7], [710, 8]] as Array<[number, number]>,
    rigHirePerDay: [[63, 3000], [90, 3500], [110, 3500], [200, 5000], [250, 7500], [300, 8500], [355, 10000], [450, 12000], [560, 14000], [710, 20000]] as Array<[number, number]>,
    totalFluidsPerM: [[63, 11], [110, 20], [200, 33], [300, 52], [400, 85], [500, 125], [630, 185], [710, 290]] as Array<[number, number]>,
    excavatorDailyRate: [[160, 400], [355, 750], [710, 1250]] as Array<[number, number]>,
    excavatorDaysPerPitPair: [[160, 1.0], [355, 1.5], [710, 2.0]] as Array<[number, number]>,
    travelAllowancePerDay: 250
  },
  'en-US': {
    sizes: [2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28],
    establishment: {
      metro: [[3, 5000], [6, 6500], [10, 8500], [14, 11000], [18, 14000], [22, 20000], [28, 30500]] as Array<[number, number]>,
      regional: [[3, 9000], [6, 12000], [10, 20000], [14, 25000], [18, 35000], [22, 48000], [28, 68000]] as Array<[number, number]>
    },
    typicalShot: [
      [2, 260], [3, 330], [4, 390], [6, 490], [8, 590], [10, 720],
      [12, 820], [14, 980], [16, 1150], [18, 1300], [20, 1480], [22, 1640], [24, 1800], [28, 1970]
    ] as Array<[number, number]>,
    productionRate: {
      regional: [[2, 260], [3, 260], [4, 230], [6, 210], [8, 180], [10, 165], [12, 140], [14, 125], [16, 105], [18, 90], [20, 80], [22, 70], [24, 60], [28, 50]] as Array<[number, number]>,
      metro: [[2, 180], [3, 180], [4, 160], [6, 150], [8, 125], [10, 110], [12, 90], [14, 80], [16, 70], [18, 60], [20, 50], [22, 45], [24, 35], [28, 30]] as Array<[number, number]>
    },
    crewSize: [[3, 3], [6, 4], [14, 5], [18, 6], [22, 7], [28, 8]] as Array<[number, number]>,
    rigHirePerDay: [[2, 2200], [3, 2600], [4, 2600], [8, 3700], [10, 5500], [12, 6200], [14, 7300], [18, 8800], [22, 10300], [28, 14700]] as Array<[number, number]>,
    totalFluidsPerM: [[2, 2.50], [4, 4.50], [8, 7.50], [12, 12.00], [16, 19.50], [20, 28.50], [24, 42.00], [28, 66.00]] as Array<[number, number]>,
    excavatorDailyRate: [[6, 300], [14, 550], [28, 950]] as Array<[number, number]>,
    excavatorDaysPerPitPair: [[6, 1.0], [14, 1.5], [28, 2.0]] as Array<[number, number]>,
    travelAllowancePerDay: 200
  }
};

function lookup(val: number, table: Array<[number, number]>): number {
  if (!table || table.length === 0) return 0;
  for (let i = 0; i < table.length; i++) {
    if (val <= table[i][0]) return table[i][1];
  }
  return table[table.length - 1][1];
}

export function calculateHDD(input: HDDInput): HDDOutput {
  if (input.isBundle) {
    return {
      summary: {
        ratePerUnit: 0,
        totalEstimate: 0,
        durationDays: 0,
        crewSize: 0,
      },
      breakdown: {
        establishment: 0,
        crewAndRigSpread: 0,
        drillingFluids: 0,
        slurryDisposal: 0,
        excavatorAllowance: 0,
        margin: 0,
      }
    };
  }
  const isMetric = input.locale === 'en-AU';
  const activeLocale = isMetric ? 'en-AU' : 'en-US';
  const tableSet = input.customRates?.[activeLocale] || DEFAULT_RATES[activeLocale];

  const dn = input.dn;
  const rawLengthFt = input.length;
  const length = isMetric ? rawLengthFt * 0.3048 : rawLengthFt;
  const location = input.location;
  const includeSlurry = input.includeSlurry ?? true;
  const includePits = input.includePits ?? true;
  const marginPct = input.marginPct ?? 15;

  // Boundary validations
  if (isMetric) {
    if (dn < 20 || dn > 710 || length < 10) {
      throw new Error('Invalid parameters: Pipe size must be 20–710mm and length >= 10m.');
    }
  } else {
    if (dn < 0.75 || dn > 28 || length < 30) {
      throw new Error('Invalid parameters: Pipe size must be 0.75–28" and length >= 30 ft.');
    }
  }

  const boresPerPit = Math.max(input.boresPerPit ?? 1, 1);

  const sizes = tableSet.sizes;

  const calcForDN = (targetDN: number, isSubsequent: boolean) => {
    const baseProdRate = lookup(targetDN, tableSet.productionRate[location]);
    // Duration penalty for very long runs
    const limit = isMetric ? 300 : 1000;
    const limit2 = isMetric ? 500 : 1600;
    const prodFactor = length <= limit ? 1.0 : length <= limit2 ? 1.3 : 1.6;
    const effectiveRate = baseProdRate / prodFactor;
    const days = Math.ceil(length / effectiveRate);

    const crew = lookup(targetDN, tableSet.crewSize);
    const estab = isSubsequent ? 0 : lookup(targetDN, tableSet.establishment[location]);

    // Labor rate is $80/hr, 10 hrs per day
    const labourCost = 80 * crew * 10 * days;
    const travelAllowance = location === 'regional' ? tableSet.travelAllowancePerDay * crew * days : 0;
    const rigSpreadCost = days * lookup(targetDN, tableSet.rigHirePerDay);
    const crewRigTotal = labourCost + travelAllowance + rigSpreadCost;

    // Fluids rate
    const fullFluidRate = lookup(targetDN, tableSet.totalFluidsPerM);
    const rawFluidsCost = (fullFluidRate * 0.40) * length;
    const slurryDisposalCost = includeSlurry ? ((fullFluidRate * 0.60) * length) : 0;
    const totalFluidsCost = rawFluidsCost + slurryDisposalCost;

    // Pit Excavator allowance
    const limitPit = isMetric ? 300 : 1000;
    const pitPairs = Math.ceil(length / limitPit);
    const excRate = lookup(targetDN, tableSet.excavatorDailyRate);
    const excDays = lookup(targetDN, tableSet.excavatorDaysPerPitPair) * pitPairs;
    const pitExcavatorCost = (!isSubsequent && includePits) ? ((excRate * excDays) / boresPerPit) : 0;

    const directCost = estab + crewRigTotal + totalFluidsCost + pitExcavatorCost;
    const sellPrice = directCost * (1 + marginPct / 100);

    return { days, crew, estab, crewRigTotal, rawFluidsCost, slurryDisposalCost, pitExcavatorCost, directCost, sellPrice };
  };

  const getInterpolatedCalc = (targetDN: number, isSubsequent: boolean) => {
    let lowDN = sizes[0];
    let highDN = sizes[0];
    let k = 0;

    if (targetDN > sizes[0]) {
      for (let i = 1; i < sizes.length; i++) {
        if (targetDN <= sizes[i]) {
          lowDN = sizes[i - 1];
          highDN = sizes[i];
          k = (targetDN - lowDN) / (highDN - lowDN);
          break;
        }
      }
      if (targetDN > sizes[sizes.length - 1]) {
        lowDN = sizes[sizes.length - 1];
        highDN = sizes[sizes.length - 1];
        k = 0;
      }
    }

    const lowCalc = calcForDN(lowDN, isSubsequent);
    const highCalc = k === 0 ? lowLow(lowCalc) : calcForDN(highDN, isSubsequent);

    function lowLow(val: any) {
      return val;
    }

    const interpolate = (lowVal: number, highVal: number) => {
      return lowVal + (highVal - lowVal) * k;
    };

    return {
      days: interpolate(lowCalc.days, highCalc.days),
      estab: interpolate(lowCalc.estab, highCalc.estab),
      crewRigTotal: interpolate(lowCalc.crewRigTotal, highCalc.crewRigTotal),
      rawFluidsCost: interpolate(lowCalc.rawFluidsCost, highCalc.rawFluidsCost),
      slurryDisposalCost: interpolate(lowCalc.slurryDisposalCost, highCalc.slurryDisposalCost),
      pitExcavatorCost: interpolate(lowCalc.pitExcavatorCost, highCalc.pitExcavatorCost),
      directCost: interpolate(lowCalc.directCost, highCalc.directCost),
      sellPrice: interpolate(lowCalc.sellPrice, highCalc.sellPrice),
    };
  };

  const mainLowCalc = getInterpolatedCalc(dn, false);

  let accumulatedTotalPrice = mainLowCalc.sellPrice;
  let accumulatedDays = mainLowCalc.days;
  let accumulatedEstab = mainLowCalc.estab;
  let accumulatedCrewRigTotal = mainLowCalc.crewRigTotal;
  let accumulatedRawFluids = mainLowCalc.rawFluidsCost;
  let accumulatedSlurry = mainLowCalc.slurryDisposalCost;
  let accumulatedPit = mainLowCalc.pitExcavatorCost;
  let accumulatedDirectCost = mainLowCalc.directCost;

  if (input.additionalPipes && input.additionalPipes.length > 0) {
    for (const addPipe of input.additionalPipes) {
      const addLowCalc = getInterpolatedCalc(addPipe.pipeSizeIn, true);
      accumulatedTotalPrice += addLowCalc.sellPrice;
      accumulatedDays += addLowCalc.days;
      accumulatedCrewRigTotal += addLowCalc.crewRigTotal;
      accumulatedRawFluids += addLowCalc.rawFluidsCost;
      accumulatedSlurry += addLowCalc.slurryDisposalCost;
      accumulatedDirectCost += addLowCalc.directCost;
    }
  }

  const ratePerUnit = accumulatedTotalPrice / length;
  const roundedRate = Math.round(ratePerUnit / 5) * 5;
  const roundedTotal = accumulatedTotalPrice >= 100000 
    ? Math.round(accumulatedTotalPrice / 1000) * 1000 
    : Math.round(accumulatedTotalPrice / 500) * 500;

  return {
    summary: {
      ratePerUnit: roundedRate,
      totalEstimate: roundedTotal,
      durationDays: Math.ceil(accumulatedDays),
      crewSize: lookup(dn, tableSet.crewSize)
    },
    breakdown: {
      establishment: Math.round(accumulatedEstab * (1 + marginPct / 100)),
      crewAndRigSpread: Math.round(accumulatedCrewRigTotal * (1 + marginPct / 100)),
      drillingFluids: Math.round(accumulatedRawFluids * (1 + marginPct / 100)),
      slurryDisposal: Math.round(accumulatedSlurry * (1 + marginPct / 100)),
      excavatorAllowance: Math.round(accumulatedPit * (1 + marginPct / 100)),
      margin: Math.round(accumulatedTotalPrice - accumulatedDirectCost)
    }
  };
}

export interface ValidationError {
  field: string;
  message: string;
}

export function validateHDDInput(input: { pipeSizeIn: number; runLengthLF: number; hddMarginPct?: number }): ValidationError[] {
  const errors: ValidationError[] = [];
  if (input.pipeSizeIn <= 0) {
    errors.push({ field: 'pipeSizeIn', message: 'Pipe size must be > 0' });
  }
  if (input.runLengthLF <= 0) {
    errors.push({ field: 'runLengthLF', message: 'Length must be > 0' });
  }
  const margin = input.hddMarginPct ?? 15;
  if (margin < 0 || margin > 100) {
    errors.push({ field: 'hddMarginPct', message: 'Margin must be between 0 and 100%' });
  }
  return errors;
}

