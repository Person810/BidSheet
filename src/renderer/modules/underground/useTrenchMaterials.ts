import { useState, useEffect } from 'react';
import { materialsToAutocomplete, type AutocompleteItem } from '../../components/FuzzyAutocomplete';
import { NATIVE_BACKFILL_LABEL } from './trenchCalc';

const PIPE_CATEGORIES = [
  'PVC Pipe', 'Ductile Iron Pipe', 'HDPE Pipe', 'RCP Pipe',
  'Pipe', 'Pipes', 'Conduit', 'Conduits', 'Electrical Conduit', 'Fiber Conduit', 'Utility Pipe',
];
const BEDDING_CATEGORY = 'Bedding & Backfill';

export const NATIVE_MATERIAL_ITEM: AutocompleteItem = {
  id: 'native',
  label: NATIVE_BACKFILL_LABEL,
  sublabel: 'Excavated trench material',
  detail: '',
  detailSub: '',
};

export function useTrenchMaterials() {
  const [pipeMaterials, setPipeMaterials] = useState<AutocompleteItem[]>([]);
  const [beddingMaterials, setBeddingMaterials] = useState<AutocompleteItem[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const allPipe: any[] = [];
        for (const cat of PIPE_CATEGORIES) {
          try {
            const rows = await window.api.getMaterialsByCategoryName(cat);
            if (Array.isArray(rows)) allPipe.push(...rows);
          } catch {}
        }

        let generalMaterials: any[] = [];
        try {
          if (typeof (window.api as any).getMaterials === 'function') {
            generalMaterials = await (window.api as any).getMaterials();
          } else if (typeof (window.api as any).listMaterials === 'function') {
            generalMaterials = await (window.api as any).listMaterials();
          }
        } catch {}

        const pipePool = [...allPipe, ...generalMaterials];
        const uniqueMap = new Map<number | string, any>();
        for (const m of pipePool) {
          if (m && m.id != null) uniqueMap.set(m.id, m);
        }

        const combinedList = Array.from(uniqueMap.values());

        const filtered = combinedList.filter((m) => {
          if (!m || !m.name) return false;
          const isLengthUnit = m.unit === 'LF' || m.unit === 'm' || m.unit === 'ft';
          const matchesSizeFormat = /^(\d+['"]|DN ?\d+|\d+ ?mm|\d+ ?in)/i.test(m.name);
          const matchesKeyword = /pipe|conduit|tubing|duct|pvc|hdpe|iron/i.test(m.name) || /pipe|conduit/i.test(m.category_name || '');
          return (isLengthUnit && matchesSizeFormat) || matchesKeyword;
        });

        setPipeMaterials(materialsToAutocomplete(filtered));

        const bedding = await window.api.getMaterialsByCategoryName(BEDDING_CATEGORY);
        setBeddingMaterials(materialsToAutocomplete(Array.isArray(bedding) ? bedding : []));
      } catch (err) {
        console.error('Failed to load trench materials:', err);
      }
    }
    load();
  }, []);

  return { pipeMaterials, beddingMaterials };
}
