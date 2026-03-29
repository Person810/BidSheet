import { useState, useEffect } from 'react';
import { materialsToAutocomplete, type AutocompleteItem } from '../../components/FuzzyAutocomplete';

const PIPE_CATEGORIES = ['PVC Pipe', 'Ductile Iron Pipe', 'HDPE Pipe', 'RCP Pipe'];
const BEDDING_CATEGORY = 'Bedding & Backfill';

export const NATIVE_MATERIAL_ITEM: AutocompleteItem = {
  id: 'native',
  label: 'Native Material',
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
          const rows = await window.api.getMaterialsByCategoryName(cat);
          allPipe.push(...rows);
        }
        // Only include pipe materials with LF unit and name starting with size + quote
        const filtered = allPipe.filter(
          (m) => m.unit === 'LF' && /^\d+['"]/.test(m.name)
        );
        setPipeMaterials(materialsToAutocomplete(filtered));

        const bedding = await window.api.getMaterialsByCategoryName(BEDDING_CATEGORY);
        setBeddingMaterials(materialsToAutocomplete(bedding));
      } catch (err) {
        console.error('Failed to load trench materials:', err);
      }
    }
    load();
  }, []);

  return { pipeMaterials, beddingMaterials };
}
