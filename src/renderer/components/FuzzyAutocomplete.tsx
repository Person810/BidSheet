import React, { useState, useRef, useEffect, useCallback } from 'react';

// ============================================================
// FUZZY AUTOCOMPLETE COMPONENT
// Replaces all <select> dropdowns with searchable type-ahead
// ============================================================

export interface AutocompleteItem {
  id: number | string;
  label: string;           // Primary display text (e.g. material name)
  sublabel?: string;        // Secondary text (e.g. category, crew description)
  detail?: string;          // Right-side info (e.g. "$4.25/LF")
  detailSub?: string;       // Below detail (e.g. unit)
  aliases?: string;         // Comma-separated aliases for fuzzy matching
  [key: string]: any;       // Allow passthrough of original item data
}

interface FuzzyAutocompleteProps {
  items: AutocompleteItem[];
  value: number | string | null;       // Currently selected item ID
  onSelect: (item: AutocompleteItem | null) => void;
  placeholder?: string;
  allowManualEntry?: boolean;          // Show "-- Manual entry --" as first option
  manualEntryLabel?: string;
  disabled?: boolean;
  className?: string;
}

// ---- Fuzzy matching engine ----

function fuzzyMatch(items: AutocompleteItem[], query: string): AutocompleteItem[] {
  if (!query.trim()) return items.slice(0, 15);

  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { item: AutocompleteItem; score: number }[] = [];

  for (const item of items) {
    // Build searchable string from label, sublabel, and aliases
    const searchable = [
      item.label,
      item.sublabel || '',
      item.aliases || '',
      item.detail || '',
    ]
      .join(' ')
      .toLowerCase();

    let allMatch = true;
    let totalScore = 0;

    for (const tok of tokens) {
      const idx = searchable.indexOf(tok);
      if (idx === -1) {
        allMatch = false;
        break;
      }
      // Score: exact prefix > word-start > substring
      if (idx === 0) {
        totalScore += 3;
      } else if (
        searchable[idx - 1] === ' ' ||
        searchable[idx - 1] === '(' ||
        searchable[idx - 1] === '"' ||
        searchable[idx - 1] === ','
      ) {
        totalScore += 2;
      } else {
        totalScore += 1;
      }
    }

    if (allMatch) {
      // Prefer shorter names (more specific matches)
      totalScore -= item.label.length * 0.01;
      scored.push({ item, score: totalScore });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item).slice(0, 12);
}

// ---- Component ----

export function FuzzyAutocomplete({
  items,
  value,
  onSelect,
  placeholder = 'Type to search...',
  allowManualEntry = false,
  manualEntryLabel = '-- Manual entry --',
  disabled = false,
  className = '',
}: FuzzyAutocompleteProps) {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [filtered, setFiltered] = useState<AutocompleteItem[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync display value with selected item
  useEffect(() => {
    if (value) {
      const selected = items.find((item) => item.id === value);
      if (selected) {
        setInputValue(selected.label);
      }
    } else {
      // If allowManualEntry and value is null/0, show empty
      if (allowManualEntry) {
        setInputValue('');
      }
    }
  }, [value, items, allowManualEntry]);

  const updateFiltered = useCallback(
    (query: string) => {
      const results = fuzzyMatch(items, query);
      setFiltered(results);
      setActiveIndex(-1);
    },
    [items]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        // Restore display value if nothing was picked
        if (value) {
          const selected = items.find((item) => item.id === value);
          if (selected) setInputValue(selected.label);
        } else if (allowManualEntry) {
          setInputValue('');
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [value, items, allowManualEntry]);

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const activeEl = listRef.current.children[
        allowManualEntry ? activeIndex + 1 : activeIndex
      ] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex, allowManualEntry]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    updateFiltered(val);
    setIsOpen(true);
  };

  const handleFocus = () => {
    updateFiltered(inputValue);
    setIsOpen(true);
  };

  const selectItem = (item: AutocompleteItem | null) => {
    if (item) {
      setInputValue(item.label);
      onSelect(item);
    } else {
      // Manual entry selected
      setInputValue('');
      onSelect(null);
    }
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalItems = filtered.length + (allowManualEntry ? 1 : 0);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, totalItems - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, allowManualEntry ? -1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex === -1 && allowManualEntry) {
        selectItem(null);
      } else if (activeIndex >= 0) {
        const adjustedIndex = allowManualEntry ? activeIndex - 1 : activeIndex;
        if (adjustedIndex === -1 && allowManualEntry) {
          selectItem(null);
        } else if (adjustedIndex >= 0 && adjustedIndex < filtered.length) {
          selectItem(filtered[adjustedIndex]);
        }
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    } else if (e.key === 'Tab') {
      if (isOpen && filtered.length > 0) {
        const idx = Math.max(activeIndex, allowManualEntry ? 1 : 0);
        const adjustedIndex = allowManualEntry ? idx - 1 : idx;
        if (adjustedIndex >= 0 && adjustedIndex < filtered.length) {
          selectItem(filtered[adjustedIndex]);
        }
      }
    }
  };

  const handleItemClick = (item: AutocompleteItem | null) => {
    selectItem(item);
    inputRef.current?.focus();
  };

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInputValue('');
    onSelect(null);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className={`fuzzy-autocomplete ${className}`} ref={containerRef}>
      <div className="fuzzy-input-wrap">
        <input
          ref={inputRef}
          type="text"
          className="form-control fuzzy-input"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
        />
        {value && inputValue && (
          <button
            className="fuzzy-clear-btn"
            onClick={clearSelection}
            title="Clear selection"
            type="button"
          >
            ×
          </button>
        )}
      </div>

      {isOpen && (
        <div className="fuzzy-dropdown" ref={listRef}>
          {allowManualEntry && (
            <div
              className={`fuzzy-item fuzzy-manual ${activeIndex === 0 ? 'fuzzy-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleItemClick(null)}
              onMouseEnter={() => setActiveIndex(0)}
            >
              <span className="fuzzy-manual-label">{manualEntryLabel}</span>
            </div>
          )}

          {filtered.length === 0 && inputValue.trim() ? (
            <div className="fuzzy-no-results">
              No matches found
            </div>
          ) : (
            filtered.map((item, index) => {
              const adjustedIndex = allowManualEntry ? index + 1 : index;
              return (
                <div
                  key={item.id}
                  className={`fuzzy-item ${adjustedIndex === activeIndex ? 'fuzzy-active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleItemClick(item)}
                  onMouseEnter={() => setActiveIndex(adjustedIndex)}
                >
                  <div className="fuzzy-item-left">
                    <div className="fuzzy-item-label">{item.label}</div>
                    {item.sublabel && (
                      <div className="fuzzy-item-sublabel">{item.sublabel}</div>
                    )}
                  </div>
                  {(item.detail || item.detailSub) && (
                    <div className="fuzzy-item-right">
                      {item.detail && <div className="fuzzy-item-detail">{item.detail}</div>}
                      {item.detailSub && (
                        <div className="fuzzy-item-detail-sub">{item.detailSub}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// HELPER: Convert raw data arrays to AutocompleteItem format
// ============================================================

export function materialsToAutocomplete(materials: any[]): AutocompleteItem[] {
  return materials.map((m) => ({
    id: m.id,
    label: m.name,
    sublabel: m.category_name || m.category || '',
    detail: `$${Number(m.default_unit_cost).toFixed(2)}`,
    detailSub: m.unit,
    aliases: m.aliases || '',
    // Pass through original fields
    default_unit_cost: m.default_unit_cost,
    unit: m.unit,
    category_id: m.category_id,
  }));
}

export function crewsToAutocomplete(crews: any[]): AutocompleteItem[] {
  return crews.map((c) => {
    const costPerHour = (c.members || []).reduce(
      (sum: number, m: any) => sum + m.quantity * m.default_hourly_rate * m.burden_multiplier,
      0
    );
    return {
      id: c.id,
      label: c.name,
      sublabel: c.description || `${(c.members || []).length} member types`,
      detail: `$${costPerHour.toFixed(2)}/hr`,
      aliases: c.aliases || '',
      costPerHour,
      members: c.members,
    };
  });
}

export function productionRatesToAutocomplete(rates: any[]): AutocompleteItem[] {
  return rates.map((r) => ({
    id: r.id,
    label: r.description,
    sublabel: r.crew_name || '',
    detail: `${r.rate_per_hour} ${r.unit}/hr`,
    detailSub: r.conditions || '',
    aliases: r.aliases || '',
    rate_per_hour: r.rate_per_hour,
    crew_template_id: r.crew_template_id,
    unit: r.unit,
  }));
}

export function equipmentToAutocomplete(equipment: any[]): AutocompleteItem[] {
  return equipment.map((eq) => ({
    id: eq.id,
    label: eq.name,
    sublabel: eq.category + (eq.is_owned ? ' · Owned' : ' · Rental'),
    detail: `$${Number(eq.hourly_rate).toFixed(2)}/hr`,
    detailSub: eq.notes || '',
    aliases: eq.aliases || '',
    hourly_rate: eq.hourly_rate,
    category: eq.category,
  }));
}

export function laborRolesToAutocomplete(roles: any[]): AutocompleteItem[] {
  return roles.map((r) => ({
    id: r.id,
    label: r.name,
    sublabel: r.notes || '',
    detail: `$${(r.default_hourly_rate * r.burden_multiplier).toFixed(2)}/hr`,
    detailSub: 'burdened',
    aliases: r.aliases || '',
    default_hourly_rate: r.default_hourly_rate,
    burden_multiplier: r.burden_multiplier,
  }));
}

export function categoriesToAutocomplete(categories: any[]): AutocompleteItem[] {
  return categories.map((c) => ({
    id: c.id,
    label: c.name,
    sublabel: c.description || '',
  }));
}

export function simpleListToAutocomplete(items: string[]): AutocompleteItem[] {
  return items.map((item, idx) => ({
    id: item,
    label: item,
  }));
}
