// ============================================================
// Trade-specific seed data for first-launch setup
// ============================================================

export type TradeType = 'water_sewer' | 'storm_drain' | 'gas' | 'electrical' | 'telecom';

export interface SeedMaterial {
  category: string;
  name: string;
  unit: string;
  ballparkPrice: number; // rough estimate, user can choose to include or not
  description?: string;
}

export interface TradeSeedData {
  label: string;
  description: string;
  categories: { name: string; description: string }[];
  materials: SeedMaterial[];
  laborRoles: { name: string; rate: number; burden: number; notes: string }[];
  equipment: { name: string; category: string; hourlyRate: number; mobilization: number; isOwned: boolean; notes: string }[];
}

export const TRADE_SEED_DATA: Record<TradeType, TradeSeedData> = {
  water_sewer: {
    label: 'Water & Sewer',
    description: 'Municipal water main and sanitary sewer installation, service connections, and rehabilitation',
    categories: [
      { name: 'PVC Pipe', description: 'PVC pressure and gravity sewer pipe' },
      { name: 'Ductile Iron Pipe', description: 'DI pipe and restrained joint' },
      { name: 'HDPE Pipe', description: 'High density polyethylene pipe' },
      { name: 'Fittings', description: 'Pipe fittings -- bends, tees, reducers, couplings' },
      { name: 'Valves', description: 'Gate valves, butterfly valves, check valves, ARVs' },
      { name: 'Manholes', description: 'Precast manholes, grade rings, frames and covers' },
      { name: 'Fire Hydrants', description: 'Hydrants and hydrant assemblies' },
      { name: 'Service Materials', description: 'Corp stops, curb stops, saddles, service pipe' },
      { name: 'Bedding & Backfill', description: 'Aggregate, stone, sand, flowable fill' },
      { name: 'Concrete', description: 'Ready mix, thrust blocks, encasement' },
      { name: 'Erosion Control', description: 'Silt fence, inlet protection, stabilization' },
      { name: 'Testing & Misc', description: 'Test plugs, tracer wire, warning tape, locator balls' },
    ],
    materials: [
      // PVC Pipe - Gravity Sewer (SDR-35)
      { category: 'PVC Pipe', name: '4" PVC SDR-35', unit: 'LF', ballparkPrice: 2.50 },
      { category: 'PVC Pipe', name: '6" PVC SDR-35', unit: 'LF', ballparkPrice: 4.75 },
      { category: 'PVC Pipe', name: '8" PVC SDR-35', unit: 'LF', ballparkPrice: 7.50 },
      { category: 'PVC Pipe', name: '10" PVC SDR-35', unit: 'LF', ballparkPrice: 12.00 },
      { category: 'PVC Pipe', name: '12" PVC SDR-35', unit: 'LF', ballparkPrice: 16.50 },
      { category: 'PVC Pipe', name: '15" PVC SDR-35', unit: 'LF', ballparkPrice: 24.00 },
      // PVC Pipe - Pressure (C900 DR-18)
      { category: 'PVC Pipe', name: '4" PVC C900 DR-18', unit: 'LF', ballparkPrice: 4.00 },
      { category: 'PVC Pipe', name: '6" PVC C900 DR-18', unit: 'LF', ballparkPrice: 7.50 },
      { category: 'PVC Pipe', name: '8" PVC C900 DR-18', unit: 'LF', ballparkPrice: 12.00 },
      { category: 'PVC Pipe', name: '10" PVC C900 DR-18', unit: 'LF', ballparkPrice: 18.00 },
      { category: 'PVC Pipe', name: '12" PVC C900 DR-18', unit: 'LF', ballparkPrice: 25.00 },
      // PVC Pipe - Service
      { category: 'PVC Pipe', name: '3/4" CTS PE Service Pipe', unit: 'LF', ballparkPrice: 0.85 },
      { category: 'PVC Pipe', name: '1" CTS PE Service Pipe', unit: 'LF', ballparkPrice: 1.10 },
      { category: 'PVC Pipe', name: '2" CTS PE Service Pipe', unit: 'LF', ballparkPrice: 2.25 },

      // Ductile Iron Pipe
      { category: 'Ductile Iron Pipe', name: '6" DI Pipe CL 350', unit: 'LF', ballparkPrice: 18.00 },
      { category: 'Ductile Iron Pipe', name: '8" DI Pipe CL 350', unit: 'LF', ballparkPrice: 24.00 },
      { category: 'Ductile Iron Pipe', name: '10" DI Pipe CL 350', unit: 'LF', ballparkPrice: 32.00 },
      { category: 'Ductile Iron Pipe', name: '12" DI Pipe CL 350', unit: 'LF', ballparkPrice: 42.00 },
      { category: 'Ductile Iron Pipe', name: '16" DI Pipe CL 350', unit: 'LF', ballparkPrice: 65.00 },

      // HDPE Pipe
      { category: 'HDPE Pipe', name: '6" HDPE DR-11', unit: 'LF', ballparkPrice: 8.00 },
      { category: 'HDPE Pipe', name: '8" HDPE DR-11', unit: 'LF', ballparkPrice: 13.00 },
      { category: 'HDPE Pipe', name: '12" HDPE DR-11', unit: 'LF', ballparkPrice: 28.00 },

      // Fittings
      { category: 'Fittings', name: '4" PVC 90° Bend', unit: 'EA', ballparkPrice: 12.00 },
      { category: 'Fittings', name: '4" PVC 45° Bend', unit: 'EA', ballparkPrice: 10.00 },
      { category: 'Fittings', name: '4" PVC Tee', unit: 'EA', ballparkPrice: 18.00 },
      { category: 'Fittings', name: '4" PVC Wye', unit: 'EA', ballparkPrice: 22.00 },
      { category: 'Fittings', name: '6" PVC 90° Bend', unit: 'EA', ballparkPrice: 28.00 },
      { category: 'Fittings', name: '6" PVC 45° Bend', unit: 'EA', ballparkPrice: 22.00 },
      { category: 'Fittings', name: '6" PVC Tee', unit: 'EA', ballparkPrice: 35.00 },
      { category: 'Fittings', name: '8" PVC 90° Bend', unit: 'EA', ballparkPrice: 55.00 },
      { category: 'Fittings', name: '8" PVC 45° Bend', unit: 'EA', ballparkPrice: 42.00 },
      { category: 'Fittings', name: '8" PVC Tee', unit: 'EA', ballparkPrice: 65.00 },
      { category: 'Fittings', name: '8" x 6" PVC Reducer', unit: 'EA', ballparkPrice: 35.00 },
      { category: 'Fittings', name: '6" PVC Coupling', unit: 'EA', ballparkPrice: 12.00 },
      { category: 'Fittings', name: '8" PVC Coupling', unit: 'EA', ballparkPrice: 18.00 },
      { category: 'Fittings', name: '6" MJ Bend 90°', unit: 'EA', ballparkPrice: 85.00 },
      { category: 'Fittings', name: '6" MJ Bend 45°', unit: 'EA', ballparkPrice: 75.00 },
      { category: 'Fittings', name: '8" MJ Bend 90°', unit: 'EA', ballparkPrice: 120.00 },
      { category: 'Fittings', name: '8" MJ Bend 45°', unit: 'EA', ballparkPrice: 100.00 },
      { category: 'Fittings', name: '6" MJ Tee', unit: 'EA', ballparkPrice: 140.00 },
      { category: 'Fittings', name: '8" MJ Tee', unit: 'EA', ballparkPrice: 185.00 },
      { category: 'Fittings', name: '8" x 6" MJ Reducer', unit: 'EA', ballparkPrice: 110.00 },

      // Valves
      { category: 'Valves', name: '4" Gate Valve', unit: 'EA', ballparkPrice: 350.00 },
      { category: 'Valves', name: '6" Gate Valve', unit: 'EA', ballparkPrice: 525.00 },
      { category: 'Valves', name: '8" Gate Valve', unit: 'EA', ballparkPrice: 850.00 },
      { category: 'Valves', name: '10" Gate Valve', unit: 'EA', ballparkPrice: 1250.00 },
      { category: 'Valves', name: '12" Gate Valve', unit: 'EA', ballparkPrice: 1800.00 },
      { category: 'Valves', name: '12" Butterfly Valve', unit: 'EA', ballparkPrice: 1400.00 },
      { category: 'Valves', name: '16" Butterfly Valve', unit: 'EA', ballparkPrice: 2200.00 },
      { category: 'Valves', name: '6" Check Valve', unit: 'EA', ballparkPrice: 650.00 },
      { category: 'Valves', name: '8" Check Valve', unit: 'EA', ballparkPrice: 950.00 },
      { category: 'Valves', name: '2" Air Release Valve', unit: 'EA', ballparkPrice: 1200.00 },
      { category: 'Valves', name: 'Valve Box & Cover', unit: 'EA', ballparkPrice: 55.00 },

      // Manholes
      { category: 'Manholes', name: '48" Precast MH Base (4\' depth)', unit: 'EA', ballparkPrice: 1200.00 },
      { category: 'Manholes', name: '48" Precast MH Base (6\' depth)', unit: 'EA', ballparkPrice: 1600.00 },
      { category: 'Manholes', name: '48" Precast MH Base (8\' depth)', unit: 'EA', ballparkPrice: 2000.00 },
      { category: 'Manholes', name: '60" Precast MH Base (6\' depth)', unit: 'EA', ballparkPrice: 2400.00 },
      { category: 'Manholes', name: '48" MH Riser (per VF)', unit: 'VF', ballparkPrice: 120.00 },
      { category: 'Manholes', name: '60" MH Riser (per VF)', unit: 'VF', ballparkPrice: 165.00 },
      { category: 'Manholes', name: 'Grade Ring (flat)', unit: 'EA', ballparkPrice: 25.00 },
      { category: 'Manholes', name: 'Grade Ring (eccentric)', unit: 'EA', ballparkPrice: 65.00 },
      { category: 'Manholes', name: 'MH Frame & Cover (standard)', unit: 'EA', ballparkPrice: 325.00 },
      { category: 'Manholes', name: 'MH Frame & Cover (watertight)', unit: 'EA', ballparkPrice: 525.00 },
      { category: 'Manholes', name: 'MH Steps', unit: 'EA', ballparkPrice: 18.00 },
      { category: 'Manholes', name: 'Inside Drop Assembly', unit: 'EA', ballparkPrice: 450.00 },
      { category: 'Manholes', name: 'Boot Seal (flexible connector)', unit: 'EA', ballparkPrice: 45.00 },

      // Fire Hydrants
      { category: 'Fire Hydrants', name: 'Fire Hydrant Assembly (complete)', unit: 'EA', ballparkPrice: 3500.00, description: 'Hydrant, shoe, valve, and riser' },
      { category: 'Fire Hydrants', name: '6" Hydrant Valve (gate)', unit: 'EA', ballparkPrice: 525.00 },
      { category: 'Fire Hydrants', name: '6" MJ x FL Bend for Hydrant', unit: 'EA', ballparkPrice: 95.00 },
      { category: 'Fire Hydrants', name: 'Hydrant Extension Kit', unit: 'EA', ballparkPrice: 180.00 },

      // Service Materials
      { category: 'Service Materials', name: '3/4" Corp Stop (CC x CTS)', unit: 'EA', ballparkPrice: 28.00 },
      { category: 'Service Materials', name: '1" Corp Stop (CC x CTS)', unit: 'EA', ballparkPrice: 38.00 },
      { category: 'Service Materials', name: '3/4" Curb Stop', unit: 'EA', ballparkPrice: 32.00 },
      { category: 'Service Materials', name: '1" Curb Stop', unit: 'EA', ballparkPrice: 42.00 },
      { category: 'Service Materials', name: 'Curb Box & Cover', unit: 'EA', ballparkPrice: 45.00 },
      { category: 'Service Materials', name: '6" Service Saddle (for 3/4" tap)', unit: 'EA', ballparkPrice: 35.00 },
      { category: 'Service Materials', name: '8" Service Saddle (for 3/4" tap)', unit: 'EA', ballparkPrice: 42.00 },
      { category: 'Service Materials', name: '6" Service Saddle (for 1" tap)', unit: 'EA', ballparkPrice: 40.00 },
      { category: 'Service Materials', name: '8" Service Saddle (for 1" tap)', unit: 'EA', ballparkPrice: 48.00 },
      { category: 'Service Materials', name: '4" PVC Sewer Saddle (wye)', unit: 'EA', ballparkPrice: 25.00 },
      { category: 'Service Materials', name: '4" PVC Sewer Cleanout Assembly', unit: 'EA', ballparkPrice: 55.00 },
      { category: 'Service Materials', name: 'Meter Box & Cover', unit: 'EA', ballparkPrice: 65.00 },
      { category: 'Service Materials', name: 'Meter Setter (3/4")', unit: 'EA', ballparkPrice: 85.00 },

      // Bedding & Backfill
      { category: 'Bedding & Backfill', name: '#57 Stone (pipe bedding)', unit: 'TON', ballparkPrice: 28.00 },
      { category: 'Bedding & Backfill', name: 'Pea Gravel', unit: 'TON', ballparkPrice: 32.00 },
      { category: 'Bedding & Backfill', name: 'Sand (bedding/haunching)', unit: 'TON', ballparkPrice: 18.00 },
      { category: 'Bedding & Backfill', name: 'Select Fill', unit: 'TON', ballparkPrice: 12.00 },
      { category: 'Bedding & Backfill', name: 'Flowable Fill', unit: 'CY', ballparkPrice: 145.00 },
      { category: 'Bedding & Backfill', name: 'Crushed Limestone Base', unit: 'TON', ballparkPrice: 22.00 },
      { category: 'Bedding & Backfill', name: 'Geotextile Fabric', unit: 'SY', ballparkPrice: 1.75 },

      // Concrete
      { category: 'Concrete', name: 'Ready Mix Concrete (3000 psi)', unit: 'CY', ballparkPrice: 165.00 },
      { category: 'Concrete', name: 'Ready Mix Concrete (4000 psi)', unit: 'CY', ballparkPrice: 180.00 },
      { category: 'Concrete', name: 'Thrust Block (formed)', unit: 'EA', ballparkPrice: 85.00, description: 'Labor + material per block' },
      { category: 'Concrete', name: 'Concrete Cradle/Encasement (per LF)', unit: 'LF', ballparkPrice: 25.00 },
      { category: 'Concrete', name: '#4 Rebar', unit: 'LF', ballparkPrice: 0.75 },

      // Erosion Control
      { category: 'Erosion Control', name: 'Silt Fence', unit: 'LF', ballparkPrice: 2.50 },
      { category: 'Erosion Control', name: 'Inlet Protection', unit: 'EA', ballparkPrice: 85.00 },
      { category: 'Erosion Control', name: 'Stabilized Construction Entrance', unit: 'EA', ballparkPrice: 1200.00 },
      { category: 'Erosion Control', name: 'Erosion Control Blanket', unit: 'SY', ballparkPrice: 2.00 },
      { category: 'Erosion Control', name: 'Hydroseed', unit: 'SY', ballparkPrice: 0.75 },
      { category: 'Erosion Control', name: 'Rip Rap (Class II)', unit: 'TON', ballparkPrice: 45.00 },

      // Testing & Misc
      { category: 'Testing & Misc', name: 'Test Plug (pneumatic)', unit: 'EA', ballparkPrice: 45.00 },
      { category: 'Testing & Misc', name: 'Tracer Wire (12 AWG)', unit: 'LF', ballparkPrice: 0.15 },
      { category: 'Testing & Misc', name: 'Warning Tape', unit: 'LF', ballparkPrice: 0.08 },
      { category: 'Testing & Misc', name: 'Locator Ball', unit: 'EA', ballparkPrice: 8.00 },
      { category: 'Testing & Misc', name: 'Chlorination (per 100 LF)', unit: 'EA', ballparkPrice: 75.00 },
      { category: 'Testing & Misc', name: 'Pressure Test (per section)', unit: 'EA', ballparkPrice: 150.00 },
      { category: 'Testing & Misc', name: 'Mandrel Test', unit: 'EA', ballparkPrice: 50.00 },
      { category: 'Testing & Misc', name: 'CCTV Inspection (per LF)', unit: 'LF', ballparkPrice: 2.50 },
    ],
    laborRoles: [
      { name: 'Foreman', rate: 38.00, burden: 1.40, notes: 'Crew foreman / working foreman' },
      { name: 'Operator', rate: 35.00, burden: 1.40, notes: 'Heavy equipment operator' },
      { name: 'Pipe Layer', rate: 30.00, burden: 1.35, notes: 'Experienced pipe layer' },
      { name: 'Laborer', rate: 22.00, burden: 1.35, notes: 'General laborer' },
      { name: 'Teamster', rate: 28.00, burden: 1.35, notes: 'CDL truck driver' },
    ],
    equipment: [
      { name: 'Excavator - Mid (CAT 320 class)', category: 'Excavator', hourlyRate: 85.00, mobilization: 500.00, isOwned: true, notes: '20-ton class excavator' },
      { name: 'Excavator - Small (CAT 308 class)', category: 'Excavator', hourlyRate: 55.00, mobilization: 350.00, isOwned: true, notes: '8-ton class mini excavator' },
      { name: 'Backhoe (Case 580 class)', category: 'Backhoe', hourlyRate: 45.00, mobilization: 250.00, isOwned: true, notes: 'Standard backhoe loader' },
      { name: 'Skid Steer (Bobcat S650 class)', category: 'Loader', hourlyRate: 35.00, mobilization: 200.00, isOwned: true, notes: 'Standard skid steer' },
      { name: 'Compactor - Trench (Wacker plate)', category: 'Compactor', hourlyRate: 8.00, mobilization: 0, isOwned: true, notes: 'Walk-behind plate compactor' },
      { name: 'Compactor - Roller (Bomag/Dynapac)', category: 'Compactor', hourlyRate: 30.00, mobilization: 200.00, isOwned: true, notes: 'Ride-on roller compactor' },
      { name: 'Dump Truck - Single Axle', category: 'Truck', hourlyRate: 40.00, mobilization: 100.00, isOwned: true, notes: 'Single axle dump' },
      { name: 'Dump Truck - Tandem', category: 'Truck', hourlyRate: 55.00, mobilization: 100.00, isOwned: true, notes: 'Tandem axle dump' },
      { name: 'Dewatering Pump - 4"', category: 'Pump', hourlyRate: 12.00, mobilization: 50.00, isOwned: true, notes: '4" trash pump' },
      { name: 'Dewatering Pump - 6"', category: 'Pump', hourlyRate: 18.00, mobilization: 75.00, isOwned: true, notes: '6" wellpoint/trash pump' },
      { name: 'Laser (pipe laser)', category: 'Survey', hourlyRate: 5.00, mobilization: 0, isOwned: true, notes: 'Pipe laser for grade' },
      { name: 'Generator', category: 'Power', hourlyRate: 10.00, mobilization: 0, isOwned: true, notes: 'Portable generator' },
      { name: 'Lowboy Trailer', category: 'Transport', hourlyRate: 65.00, mobilization: 0, isOwned: true, notes: 'Equipment transport' },
    ],
  },

  storm_drain: {
    label: 'Storm Drain',
    description: 'Storm sewer, drainage structures, and stormwater management',
    categories: [
      { name: 'RCP Pipe', description: 'Reinforced concrete pipe' },
      { name: 'HDPE Pipe', description: 'Corrugated and smooth wall HDPE' },
      { name: 'PVC Pipe', description: 'PVC storm sewer pipe' },
      { name: 'Structures', description: 'Inlets, junction boxes, headwalls' },
      { name: 'Fittings', description: 'Pipe fittings and connectors' },
      { name: 'Bedding & Backfill', description: 'Aggregate, stone, sand' },
      { name: 'Concrete', description: 'Ready mix, formed structures' },
      { name: 'Erosion Control', description: 'Silt fence, inlet protection, stabilization' },
      { name: 'Testing & Misc', description: 'Tracer wire, warning tape, misc materials' },
    ],
    materials: [
      { category: 'RCP Pipe', name: '12" RCP Class III', unit: 'LF', ballparkPrice: 18.00 },
      { category: 'RCP Pipe', name: '15" RCP Class III', unit: 'LF', ballparkPrice: 22.00 },
      { category: 'RCP Pipe', name: '18" RCP Class III', unit: 'LF', ballparkPrice: 28.00 },
      { category: 'RCP Pipe', name: '24" RCP Class III', unit: 'LF', ballparkPrice: 38.00 },
      { category: 'RCP Pipe', name: '30" RCP Class III', unit: 'LF', ballparkPrice: 52.00 },
      { category: 'RCP Pipe', name: '36" RCP Class III', unit: 'LF', ballparkPrice: 68.00 },
      { category: 'RCP Pipe', name: '48" RCP Class III', unit: 'LF', ballparkPrice: 110.00 },
      { category: 'HDPE Pipe', name: '12" Corrugated HDPE', unit: 'LF', ballparkPrice: 8.00 },
      { category: 'HDPE Pipe', name: '15" Corrugated HDPE', unit: 'LF', ballparkPrice: 11.00 },
      { category: 'HDPE Pipe', name: '18" Corrugated HDPE', unit: 'LF', ballparkPrice: 15.00 },
      { category: 'HDPE Pipe', name: '24" Corrugated HDPE', unit: 'LF', ballparkPrice: 22.00 },
      { category: 'Structures', name: 'Curb Inlet (standard)', unit: 'EA', ballparkPrice: 1800.00 },
      { category: 'Structures', name: 'Area Inlet (2x2)', unit: 'EA', ballparkPrice: 1200.00 },
      { category: 'Structures', name: 'Junction Box (4x4)', unit: 'EA', ballparkPrice: 2800.00 },
      { category: 'Structures', name: 'Headwall (formed in place)', unit: 'EA', ballparkPrice: 1500.00 },
      { category: 'Structures', name: 'Flared End Section 18"', unit: 'EA', ballparkPrice: 280.00 },
      { category: 'Structures', name: 'Flared End Section 24"', unit: 'EA', ballparkPrice: 380.00 },
      { category: 'Structures', name: 'Grate & Frame (standard)', unit: 'EA', ballparkPrice: 350.00 },
    ],
    laborRoles: [
      { name: 'Foreman', rate: 38.00, burden: 1.40, notes: 'Crew foreman' },
      { name: 'Operator', rate: 35.00, burden: 1.40, notes: 'Heavy equipment operator' },
      { name: 'Pipe Layer', rate: 30.00, burden: 1.35, notes: 'Experienced pipe layer' },
      { name: 'Laborer', rate: 22.00, burden: 1.35, notes: 'General laborer' },
      { name: 'Teamster', rate: 28.00, burden: 1.35, notes: 'CDL truck driver' },
    ],
    equipment: [
      { name: 'Excavator - Mid (CAT 320 class)', category: 'Excavator', hourlyRate: 85.00, mobilization: 500.00, isOwned: true, notes: '20-ton class' },
      { name: 'Excavator - Large (CAT 330 class)', category: 'Excavator', hourlyRate: 120.00, mobilization: 750.00, isOwned: true, notes: '30-ton class for large RCP' },
      { name: 'Backhoe (Case 580 class)', category: 'Backhoe', hourlyRate: 45.00, mobilization: 250.00, isOwned: true, notes: 'Standard backhoe' },
      { name: 'Skid Steer', category: 'Loader', hourlyRate: 35.00, mobilization: 200.00, isOwned: true, notes: 'Standard skid steer' },
      { name: 'Compactor - Trench', category: 'Compactor', hourlyRate: 8.00, mobilization: 0, isOwned: true, notes: 'Plate compactor' },
      { name: 'Dump Truck - Tandem', category: 'Truck', hourlyRate: 55.00, mobilization: 100.00, isOwned: true, notes: 'Tandem axle dump' },
      { name: 'Crane (for large RCP)', category: 'Crane', hourlyRate: 200.00, mobilization: 1500.00, isOwned: false, notes: 'Rented for large pipe' },
      { name: 'Lowboy Trailer', category: 'Transport', hourlyRate: 65.00, mobilization: 0, isOwned: true, notes: 'Equipment transport' },
    ],
  },

  gas: {
    label: 'Gas',
    description: 'Natural gas main and service installation',
    categories: [
      { name: 'PE Pipe', description: 'Polyethylene gas pipe' },
      { name: 'Steel Pipe', description: 'Steel gas pipe and coated pipe' },
      { name: 'Fittings', description: 'Butt fusion, electrofusion, mechanical fittings' },
      { name: 'Valves', description: 'Gas valves and operators' },
      { name: 'Service Materials', description: 'Service tees, risers, meters, regulators' },
      { name: 'Bedding & Backfill', description: 'Sand, select fill' },
      { name: 'Testing & Misc', description: 'Warning tape, tracer wire, markers' },
    ],
    materials: [
      { category: 'PE Pipe', name: '2" PE SDR-11', unit: 'LF', ballparkPrice: 1.50 },
      { category: 'PE Pipe', name: '4" PE SDR-11', unit: 'LF', ballparkPrice: 4.00 },
      { category: 'PE Pipe', name: '6" PE SDR-11', unit: 'LF', ballparkPrice: 8.50 },
      { category: 'PE Pipe', name: '8" PE SDR-11', unit: 'LF', ballparkPrice: 14.00 },
      { category: 'PE Pipe', name: '3/4" PE Service Tubing', unit: 'LF', ballparkPrice: 0.45 },
      { category: 'PE Pipe', name: '1-1/4" PE Service Tubing', unit: 'LF', ballparkPrice: 0.85 },
      { category: 'Fittings', name: '2" PE Butt Fusion Tee', unit: 'EA', ballparkPrice: 12.00 },
      { category: 'Fittings', name: '4" PE Butt Fusion Tee', unit: 'EA', ballparkPrice: 28.00 },
      { category: 'Fittings', name: '2" PE Butt Fusion 90°', unit: 'EA', ballparkPrice: 8.00 },
      { category: 'Fittings', name: '4" PE Butt Fusion 90°', unit: 'EA', ballparkPrice: 22.00 },
      { category: 'Service Materials', name: '3/4" Service Tee', unit: 'EA', ballparkPrice: 18.00 },
      { category: 'Service Materials', name: '1-1/4" Service Tee', unit: 'EA', ballparkPrice: 25.00 },
      { category: 'Service Materials', name: 'Gas Riser Assembly', unit: 'EA', ballparkPrice: 65.00 },
      { category: 'Valves', name: '2" PE Ball Valve', unit: 'EA', ballparkPrice: 85.00 },
      { category: 'Valves', name: '4" PE Ball Valve', unit: 'EA', ballparkPrice: 180.00 },
      { category: 'Valves', name: '6" Gate Valve', unit: 'EA', ballparkPrice: 450.00 },
      { category: 'Valves', name: 'Valve Box & Cover', unit: 'EA', ballparkPrice: 55.00 },
    ],
    laborRoles: [
      { name: 'Foreman', rate: 40.00, burden: 1.40, notes: 'Gas crew foreman' },
      { name: 'Operator', rate: 36.00, burden: 1.40, notes: 'Equipment operator' },
      { name: 'Fusion Tech', rate: 34.00, burden: 1.40, notes: 'Qualified PE fusion technician' },
      { name: 'Laborer', rate: 22.00, burden: 1.35, notes: 'General laborer' },
    ],
    equipment: [
      { name: 'Backhoe (Case 580 class)', category: 'Backhoe', hourlyRate: 45.00, mobilization: 250.00, isOwned: true, notes: 'Standard backhoe' },
      { name: 'Mini Excavator', category: 'Excavator', hourlyRate: 45.00, mobilization: 250.00, isOwned: true, notes: '3-5 ton mini ex' },
      { name: 'Butt Fusion Machine', category: 'Fusion', hourlyRate: 25.00, mobilization: 100.00, isOwned: true, notes: 'McElroy or equivalent' },
      { name: 'Compactor - Trench', category: 'Compactor', hourlyRate: 8.00, mobilization: 0, isOwned: true, notes: 'Plate compactor' },
      { name: 'Dump Truck - Single Axle', category: 'Truck', hourlyRate: 40.00, mobilization: 100.00, isOwned: true, notes: 'Single axle dump' },
    ],
  },

  electrical: {
    label: 'Electrical / Conduit',
    description: 'Underground electrical conduit, duct bank, and pull box installation',
    categories: [
      { name: 'PVC Conduit', description: 'Schedule 40 and 80 PVC conduit' },
      { name: 'HDPE Conduit', description: 'HDPE conduit and innerduct' },
      { name: 'Structures', description: 'Pull boxes, handholes, transformer pads' },
      { name: 'Fittings', description: 'Elbows, couplings, adapters, bushings' },
      { name: 'Bedding & Backfill', description: 'Sand, thermal sand, concrete' },
      { name: 'Misc', description: 'Duct spacers, mule tape, warning tape, markers' },
    ],
    materials: [
      { category: 'PVC Conduit', name: '2" PVC Schedule 40', unit: 'LF', ballparkPrice: 1.20 },
      { category: 'PVC Conduit', name: '3" PVC Schedule 40', unit: 'LF', ballparkPrice: 2.00 },
      { category: 'PVC Conduit', name: '4" PVC Schedule 40', unit: 'LF', ballparkPrice: 3.25 },
      { category: 'PVC Conduit', name: '6" PVC Schedule 40', unit: 'LF', ballparkPrice: 7.50 },
      { category: 'PVC Conduit', name: '2" PVC Schedule 80', unit: 'LF', ballparkPrice: 2.00 },
      { category: 'PVC Conduit', name: '4" PVC Schedule 80', unit: 'LF', ballparkPrice: 5.50 },
      { category: 'HDPE Conduit', name: '2" HDPE Conduit', unit: 'LF', ballparkPrice: 0.85 },
      { category: 'HDPE Conduit', name: '1-1/4" HDPE Innerduct', unit: 'LF', ballparkPrice: 0.35 },
      { category: 'Structures', name: 'Pull Box 24x36x24', unit: 'EA', ballparkPrice: 450.00 },
      { category: 'Structures', name: 'Pull Box 36x48x36', unit: 'EA', ballparkPrice: 850.00 },
      { category: 'Structures', name: 'Handhole (polymer, small)', unit: 'EA', ballparkPrice: 250.00 },
      { category: 'Structures', name: 'Transformer Pad', unit: 'EA', ballparkPrice: 350.00 },
      { category: 'Fittings', name: '2" PVC 90° Sweep', unit: 'EA', ballparkPrice: 4.00 },
      { category: 'Fittings', name: '4" PVC 90° Sweep', unit: 'EA', ballparkPrice: 12.00 },
      { category: 'Fittings', name: 'Duct Spacer (per tier)', unit: 'EA', ballparkPrice: 3.50 },
      { category: 'Misc', name: 'Mule Tape (1800 lb)', unit: 'LF', ballparkPrice: 0.04 },
      { category: 'Misc', name: 'Warning Tape (electric)', unit: 'LF', ballparkPrice: 0.08 },
    ],
    laborRoles: [
      { name: 'Foreman', rate: 38.00, burden: 1.40, notes: 'Crew foreman' },
      { name: 'Operator', rate: 35.00, burden: 1.40, notes: 'Equipment operator' },
      { name: 'Laborer', rate: 22.00, burden: 1.35, notes: 'General laborer' },
    ],
    equipment: [
      { name: 'Backhoe (Case 580 class)', category: 'Backhoe', hourlyRate: 45.00, mobilization: 250.00, isOwned: true, notes: 'Standard backhoe' },
      { name: 'Mini Excavator', category: 'Excavator', hourlyRate: 45.00, mobilization: 250.00, isOwned: true, notes: 'For tight spaces' },
      { name: 'Trencher (walk-behind)', category: 'Trencher', hourlyRate: 20.00, mobilization: 100.00, isOwned: true, notes: 'For shallow conduit runs' },
      { name: 'Compactor - Trench', category: 'Compactor', hourlyRate: 8.00, mobilization: 0, isOwned: true, notes: 'Plate compactor' },
      { name: 'Dump Truck - Single Axle', category: 'Truck', hourlyRate: 40.00, mobilization: 100.00, isOwned: true, notes: 'Single axle dump' },
    ],
  },

  telecom: {
    label: 'Telecommunications / Fiber',
    description: 'Fiber optic, copper, and telecommunications underground plant installation',
    categories: [
      { name: 'HDPE Conduit', description: 'HDPE conduit and microduct' },
      { name: 'PVC Conduit', description: 'PVC conduit for telecom' },
      { name: 'Innerduct', description: 'Fiber innerduct and microduct' },
      { name: 'Structures', description: 'Handholes, vaults, pedestals' },
      { name: 'Fittings', description: 'Couplings, elbows, connectors' },
      { name: 'Bedding & Backfill', description: 'Sand, select fill' },
      { name: 'Misc', description: 'Warning tape, pull tape, markers, tracer wire' },
    ],
    materials: [
      { category: 'HDPE Conduit', name: '1-1/4" HDPE SDR-13.5', unit: 'LF', ballparkPrice: 0.35 },
      { category: 'HDPE Conduit', name: '2" HDPE SDR-13.5', unit: 'LF', ballparkPrice: 0.65 },
      { category: 'HDPE Conduit', name: '3" HDPE SDR-13.5', unit: 'LF', ballparkPrice: 1.25 },
      { category: 'HDPE Conduit', name: '4" HDPE SDR-13.5', unit: 'LF', ballparkPrice: 2.00 },
      { category: 'Innerduct', name: '1" Fiber Innerduct', unit: 'LF', ballparkPrice: 0.20 },
      { category: 'Innerduct', name: '1-1/4" Fiber Innerduct', unit: 'LF', ballparkPrice: 0.28 },
      { category: 'Innerduct', name: 'Microduct (7-way)', unit: 'LF', ballparkPrice: 1.50 },
      { category: 'PVC Conduit', name: '4" PVC Schedule 40', unit: 'LF', ballparkPrice: 3.25 },
      { category: 'Structures', name: 'Handhole 17x30 (polymer)', unit: 'EA', ballparkPrice: 180.00 },
      { category: 'Structures', name: 'Handhole 24x36 (polymer)', unit: 'EA', ballparkPrice: 320.00 },
      { category: 'Structures', name: 'Handhole 36x48 (polymer)', unit: 'EA', ballparkPrice: 550.00 },
      { category: 'Structures', name: 'Splice Vault (precast)', unit: 'EA', ballparkPrice: 2200.00 },
      { category: 'Structures', name: 'Pedestal (copper/fiber)', unit: 'EA', ballparkPrice: 120.00 },
      { category: 'Misc', name: 'Warning Tape (fiber optic)', unit: 'LF', ballparkPrice: 0.08 },
      { category: 'Misc', name: 'Pull Tape (1800 lb)', unit: 'LF', ballparkPrice: 0.04 },
      { category: 'Misc', name: 'Tracer Wire (12 AWG)', unit: 'LF', ballparkPrice: 0.15 },
    ],
    laborRoles: [
      { name: 'Foreman', rate: 36.00, burden: 1.40, notes: 'Crew foreman' },
      { name: 'Operator', rate: 34.00, burden: 1.40, notes: 'Equipment operator' },
      { name: 'Laborer', rate: 22.00, burden: 1.35, notes: 'General laborer' },
    ],
    equipment: [
      { name: 'Mini Excavator', category: 'Excavator', hourlyRate: 45.00, mobilization: 250.00, isOwned: true, notes: '3-5 ton' },
      { name: 'Directional Drill (small)', category: 'Drill', hourlyRate: 95.00, mobilization: 500.00, isOwned: true, notes: 'For horizontal directional boring' },
      { name: 'Trencher (ride-on)', category: 'Trencher', hourlyRate: 35.00, mobilization: 200.00, isOwned: true, notes: 'Ditch Witch or Vermeer' },
      { name: 'Cable Plow', category: 'Plow', hourlyRate: 45.00, mobilization: 250.00, isOwned: true, notes: 'Vibratory cable plow' },
      { name: 'Dump Truck - Single Axle', category: 'Truck', hourlyRate: 40.00, mobilization: 100.00, isOwned: true, notes: 'Single axle dump' },
    ],
  },
};
