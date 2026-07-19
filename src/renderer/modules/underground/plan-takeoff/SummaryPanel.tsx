import React, { useMemo } from 'react';
import { List } from 'lucide-react';
import { calculateTrench, type TrenchInput } from '../trenchCalc';
import type { TakeoffRun, TakeoffItem, TakeoffArea, TakeoffWall } from './types';
import { AREA_TYPE_LABELS } from './types';
import {
  computeRunLengthLF, getMaxDepthFt, SHORING_DEPTH_THRESHOLD_FT,
  computePolygonAreaSF, computePolygonPerimeterLF, ftToInches,
} from './takeoffUtils';
import { computeWallQuantities } from './wallTakeoff';
import { cubicFeetToYards, squareFeetToYards } from '../../../../shared/constants/units';
import { formatQty } from '../../../../shared/unitSystem';
import { useUnitSystem } from '../../../stores/units-store';

export type SummaryTab = 'runs' | 'items' | 'areas' | 'walls';

interface SummaryPanelProps {
  runs: TakeoffRun[];
  allRuns: TakeoffRun[];
  activeRunId: number | null;
  selectedRunId: number | null;
  scalePxPerFt: number;
  pageNumber: number;
  onSelectRun: (runId: number | null) => void;
  onEditRun: (runId: number) => void;
  onDeleteRun: (runId: number) => void;
  onSendToProfiles?: () => void;
  items: TakeoffItem[];
  selectedItemId: number | null;
  onSelectItem: (id: number | null) => void;
  onDeleteItem: (id: number) => void;
  onSendItemsToBid?: () => void;
  areas: TakeoffArea[];
  allAreas: TakeoffArea[];
  activeAreaId: number | null;
  selectedAreaId: number | null;
  onSelectArea: (id: number | null) => void;
  onEditArea: (id: number) => void;
  onDeleteArea: (id: number) => void;
  onSendAreasToBid?: () => void;
  walls: TakeoffWall[];
  allWalls: TakeoffWall[];
  activeWallId: number | null;
  selectedWallId: number | null;
  onSelectWall: (id: number | null) => void;
  onEditWall: (id: number) => void;
  onDeleteWall: (id: number) => void;
  onSendWallsToBid?: () => void;
  activeTab: SummaryTab;
  onTabChange: (tab: SummaryTab) => void;
}

function buildTrenchInput(run: TakeoffRun, runLengthLF: number): TrenchInput {
  return {
    pipeSizeIn: run.pipeSizeIn, pipeMaterial: run.pipeMaterial,
    startDepthFt: run.startDepthFt, gradePct: run.gradePct, runLengthLF,
    trenchWidthFt: run.trenchWidthFt, benchWidthFt: run.benchWidthFt,
    beddingDepthFt: run.beddingDepthFt, backfillType: run.backfillType,
  };
}

export function SummaryPanel(props: SummaryPanelProps) {
  const {
    runs, allRuns, activeRunId, selectedRunId, scalePxPerFt, pageNumber,
    onSelectRun, onEditRun, onDeleteRun, onSendToProfiles,
    items, selectedItemId, onSelectItem, onDeleteItem, onSendItemsToBid,
    areas, allAreas, activeAreaId, selectedAreaId,
    onSelectArea, onEditArea, onDeleteArea, onSendAreasToBid,
    walls, allWalls, activeWallId, selectedWallId,
    onSelectWall, onEditWall, onDeleteWall, onSendWallsToBid,
    activeTab, onTabChange,
  } = props;

  return (
    <div className="tk-panel">
      <div className="tk-panel-header">
        <List size={12} strokeWidth={2} />
        Measurements
      </div>
      {/* Tab bar */}
      <div className="tk-panel-tabs">
        <button className={`tk-panel-tab${activeTab === 'runs' ? ' tk-panel-tab-active' : ''}`}
          onClick={() => onTabChange('runs')}>
          Runs ({runs.length})
        </button>
        <button className={`tk-panel-tab${activeTab === 'items' ? ' tk-panel-tab-active' : ''}`}
          onClick={() => onTabChange('items')}>
          Items ({items.length})
        </button>
        <button className={`tk-panel-tab${activeTab === 'areas' ? ' tk-panel-tab-active' : ''}`}
          onClick={() => onTabChange('areas')}>
          Areas ({areas.length})
        </button>
        <button className={`tk-panel-tab${activeTab === 'walls' ? ' tk-panel-tab-active' : ''}`}
          onClick={() => onTabChange('walls')}>
          Walls ({walls.length})
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'runs' ? (
        <RunsTabContent
          runs={runs} allRuns={allRuns} activeRunId={activeRunId}
          selectedRunId={selectedRunId} scalePxPerFt={scalePxPerFt}
          onSelectRun={onSelectRun} onEditRun={onEditRun}
          onDeleteRun={onDeleteRun} onSendToProfiles={onSendToProfiles}
        />
      ) : activeTab === 'items' ? (
        <ItemsTabContent
          items={items} selectedItemId={selectedItemId}
          onSelectItem={onSelectItem} onDeleteItem={onDeleteItem}
          onSendItemsToBid={onSendItemsToBid}
          activeRunId={activeRunId}
        />
      ) : activeTab === 'areas' ? (
        <AreasTabContent
          areas={areas} allAreas={allAreas} activeAreaId={activeAreaId}
          selectedAreaId={selectedAreaId} scalePxPerFt={scalePxPerFt}
          onSelectArea={onSelectArea} onEditArea={onEditArea}
          onDeleteArea={onDeleteArea} onSendAreasToBid={onSendAreasToBid}
        />
      ) : (
        <WallsTabContent
          walls={walls} allWalls={allWalls} activeWallId={activeWallId}
          selectedWallId={selectedWallId} scalePxPerFt={scalePxPerFt}
          onSelectWall={onSelectWall} onEditWall={onEditWall}
          onDeleteWall={onDeleteWall} onSendWallsToBid={onSendWallsToBid}
        />
      )}
    </div>
  );
}

/* ==== RUNS TAB ==== */

function RunsTabContent({ runs, allRuns, activeRunId, selectedRunId, scalePxPerFt,
  onSelectRun, onEditRun, onDeleteRun, onSendToProfiles,
}: {
  runs: TakeoffRun[]; allRuns: TakeoffRun[]; activeRunId: number | null;
  selectedRunId: number | null; scalePxPerFt: number;
  onSelectRun: (id: number | null) => void; onEditRun: (id: number) => void;
  onDeleteRun: (id: number) => void; onSendToProfiles?: () => void;
}) {
  const system = useUnitSystem();
  const focusedRun = runs.find((r) => r.id === (activeRunId ?? selectedRunId));

  if (focusedRun) {
    return (
      <RunDetail
        run={focusedRun} scalePxPerFt={scalePxPerFt}
        isActive={focusedRun.id === activeRunId}
        onEdit={() => onEditRun(focusedRun.id)}
        onDelete={() => onDeleteRun(focusedRun.id)}
      />
    );
  }

  const hasCompletedRuns = allRuns.some((r) => r.points.length >= 2);
  return (
    <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
      {runs.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 24 }}>
          No runs on this page.
        </p>
      )}
      {runs.map((run) => {
        const globalIdx = allRuns.indexOf(run);
        const lf = computeRunLengthLF(run.points, scalePxPerFt);
        return (
          <div key={run.id} onClick={() => onSelectRun(run.id)} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
            borderRadius: 4, cursor: 'pointer', marginBottom: 2,
          }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: run.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {run.label || `Run ${globalIdx + 1}`}
            </span>
            <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
              {system === 'metric' ? formatQty(lf, 'lf', system, 1) : `${fmt(lf)}'`}
            </span>
          </div>
        );
      })}
      {onSendToProfiles && hasCompletedRuns && !activeRunId && (
        <button className="btn btn-primary btn-sm" style={{ width: '100%', marginTop: 12 }}
          onClick={onSendToProfiles}>
          Send to Trench Profiles
        </button>
      )}
    </div>
  );
}

function RunDetail({ run, scalePxPerFt, isActive, onEdit, onDelete }: {
  run: TakeoffRun; scalePxPerFt: number; isActive: boolean;
  onEdit: () => void; onDelete: () => void;
}) {
  const system = useUnitSystem();
  const metric = system === 'metric';
  const runLengthLF = computeRunLengthLF(run.points, scalePxPerFt);
  const maxDepth = getMaxDepthFt(run, scalePxPerFt);
  const result = runLengthLF > 0 ? calculateTrench(buildTrenchInput(run, runLengthLF)) : null;

  return (
    <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: run.color, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {run.label || 'Untitled Run'}
        </span>
        {isActive && <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>DRAWING</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        {run.utilityType.charAt(0).toUpperCase() + run.utilityType.slice(1)} &middot;{' '}
        {run.points.length} point{run.points.length !== 1 ? 's' : ''} &middot;{' '}
        {run.points.length > 1 ? run.points.length - 1 : 0} segment{run.points.length - 1 !== 1 ? 's' : ''}
      </div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <tbody>
          <QtyRow label={metric ? 'Total Length' : 'Total LF'}
            value={metric ? formatQty(runLengthLF, 'lf', system, 1) : fmt(runLengthLF)} />
          {result && (<>
            <QtyRow label={metric ? 'Pipe Length' : 'Pipe LF'}
              value={metric ? formatQty(result.pipeLF, 'lf', system, 1) : fmt(result.pipeLF)} />
            <QtyRow label="Excavation"
              value={metric ? formatQty(result.excavationCY, 'cy', system, 1) : `${fmt(result.excavationCY)} CY`} />
            <QtyRow label="Bedding"
              value={metric ? formatQty(result.beddingCY, 'cy', system, 1) : `${fmt(result.beddingCY)} CY`} />
            <QtyRow label="Backfill"
              value={metric ? formatQty(result.backfillCY, 'cy', system, 1) : `${fmt(result.backfillCY)} CY`} />
            <QtyRow label="Tracer Wire"
              value={metric ? formatQty(result.tracerWireLF, 'lf', system, 1) : `${fmt(result.tracerWireLF)} LF`} />
            <QtyRow label="Warning Tape"
              value={metric ? formatQty(result.warningTapeLF, 'lf', system, 1) : `${fmt(result.warningTapeLF)} LF`} />
          </>)}
        </tbody>
      </table>
      {maxDepth > SHORING_DEPTH_THRESHOLD_FT && (
        <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 4,
          background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)',
          fontSize: 11, color: '#d97706' }}>
          {metric
            ? <>&#9888; Max depth {formatQty(maxDepth, 'ft', system, 1)} exceeds {formatQty(SHORING_DEPTH_THRESHOLD_FT, 'ft', system, 1)} &mdash; shoring may be required</>
            : <>&#9888; Max depth {maxDepth.toFixed(1)}&apos; exceeds {SHORING_DEPTH_THRESHOLD_FT}&apos; &mdash; shoring may be required</>}
        </div>
      )}
      {!isActive && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={onEdit}>Edit Config</button>
          <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={onDelete}>Delete Run</button>
        </div>
      )}
    </div>
  );
}

/* ==== ITEMS TAB ==== */

interface MaterialGroup {
  materialId: number | null;
  materialName: string;
  count: number;
  itemIds: number[];
}

function ItemsTabContent({ items, selectedItemId, onSelectItem, onDeleteItem, onSendItemsToBid, activeRunId }: {
  items: TakeoffItem[]; selectedItemId: number | null;
  onSelectItem: (id: number | null) => void; onDeleteItem: (id: number) => void;
  onSendItemsToBid?: () => void; activeRunId: number | null;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, MaterialGroup>();
    for (const item of items) {
      const key = String(item.materialId ?? item.materialName);
      const g = map.get(key);
      if (g) { g.count += item.quantity; g.itemIds.push(item.id); }
      else map.set(key, { materialId: item.materialId, materialName: item.materialName, count: item.quantity, itemIds: [item.id] });
    }
    return Array.from(map.values());
  }, [items]);

  const selectedItem = selectedItemId != null ? items.find((i) => i.id === selectedItemId) : null;

  if (selectedItem) {
    return (
      <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
        <button className="btn btn-secondary btn-sm" style={{ marginBottom: 12, fontSize: 11 }}
          onClick={() => onSelectItem(null)}>&larr; Back</button>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{selectedItem.materialName}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
          Page {selectedItem.pdfPage}
        </div>
        <button className="btn btn-danger btn-sm" onClick={() => onDeleteItem(selectedItem.id)}>
          Delete Item
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
        {items.length} item{items.length !== 1 ? 's' : ''} on this page
      </div>
      {groups.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 24 }}>
          No items on this page.
        </p>
      )}
      {groups.map((g) => (
        <div key={g.materialName} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
          borderRadius: 4, cursor: 'pointer', marginBottom: 2,
        }}
          onClick={() => onSelectItem(g.itemIds[0])}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ width: 8, height: 8, background: '#e91e63', transform: 'rotate(45deg)', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {g.materialName}
          </span>
          <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
            x{g.count}
          </span>
        </div>
      ))}
      {onSendItemsToBid && items.length > 0 && !activeRunId && (
        <button className="btn btn-primary btn-sm" style={{ width: '100%', marginTop: 12 }}
          onClick={onSendItemsToBid}>
          Send Items to Bid
        </button>
      )}
    </div>
  );
}

/* ==== AREAS TAB ==== */

function AreasTabContent({ areas, allAreas, activeAreaId, selectedAreaId, scalePxPerFt,
  onSelectArea, onEditArea, onDeleteArea, onSendAreasToBid,
}: {
  areas: TakeoffArea[]; allAreas: TakeoffArea[]; activeAreaId: number | null;
  selectedAreaId: number | null; scalePxPerFt: number;
  onSelectArea: (id: number | null) => void; onEditArea: (id: number) => void;
  onDeleteArea: (id: number) => void; onSendAreasToBid?: () => void;
}) {
  const system = useUnitSystem();
  const metric = system === 'metric';
  const focusedArea = areas.find((a) => a.id === (activeAreaId ?? selectedAreaId));

  if (focusedArea) {
    return (
      <AreaDetail
        area={focusedArea} scalePxPerFt={scalePxPerFt}
        isActive={focusedArea.id === activeAreaId}
        onEdit={() => onEditArea(focusedArea.id)}
        onDelete={() => onDeleteArea(focusedArea.id)}
      />
    );
  }

  const hasCompletedAreas = allAreas.some((a) => a.points.length >= 3);
  const pageTotalSF = areas.reduce(
    (sum, a) => sum + (a.points.length >= 3 ? computePolygonAreaSF(a.points, scalePxPerFt) : 0), 0,
  );
  return (
    <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
      {areas.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 24 }}>
          No areas on this page.
        </p>
      )}
      {areas.map((area) => {
        const globalIdx = allAreas.indexOf(area);
        const sf = area.points.length >= 3 ? computePolygonAreaSF(area.points, scalePxPerFt) : 0;
        return (
          <div key={area.id} onClick={() => onSelectArea(area.id)} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
            borderRadius: 4, cursor: 'pointer', marginBottom: 2,
          }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ width: 8, height: 8, borderRadius: 2, background: area.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {area.label || `Area ${globalIdx + 1}`}
            </span>
            <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
              {metric ? formatQty(sf, 'sf', system, 0) : `${Math.round(sf).toLocaleString()} SF`}
            </span>
          </div>
        );
      })}
      {areas.length > 1 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right', marginTop: 6, paddingRight: 8 }}>
          {metric
            ? <>Page total: {formatQty(pageTotalSF, 'sf', system, 0)}</>
            : <>Page total: {Math.round(pageTotalSF).toLocaleString()} SF ({squareFeetToYards(pageTotalSF).toFixed(1)} SY)</>}
        </div>
      )}
      {onSendAreasToBid && hasCompletedAreas && !activeAreaId && (
        <button className="btn btn-primary btn-sm" style={{ width: '100%', marginTop: 12 }}
          onClick={onSendAreasToBid}>
          Send Areas to Bid
        </button>
      )}
    </div>
  );
}

function AreaDetail({ area, scalePxPerFt, isActive, onEdit, onDelete }: {
  area: TakeoffArea; scalePxPerFt: number; isActive: boolean;
  onEdit: () => void; onDelete: () => void;
}) {
  const system = useUnitSystem();
  const metric = system === 'metric';
  const sf = area.points.length >= 3 ? computePolygonAreaSF(area.points, scalePxPerFt) : 0;
  const sy = squareFeetToYards(sf);
  const cy = cubicFeetToYards(sf * area.depthFt);
  const perimeter = area.points.length >= 3 ? computePolygonPerimeterLF(area.points, scalePxPerFt) : 0;
  const depthIn = ftToInches(area.depthFt);

  return (
    <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: area.color, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {area.label || 'Untitled Area'}
        </span>
        {isActive && <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>DRAWING</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        {AREA_TYPE_LABELS[area.areaType]} &middot;{' '}
        {area.points.length} vert{area.points.length !== 1 ? 'ices' : 'ex'}
        {depthIn > 0
          ? <> &middot; {metric ? formatQty(depthIn, 'in', system, 0) : <>{depthIn}&quot;</>} depth</>
          : null}
      </div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <tbody>
          {metric ? (
            <QtyRow label="Area" value={formatQty(sf, 'sf', system, 1)} />
          ) : (<>
            <QtyRow label="Area (SF)" value={`${Math.round(sf).toLocaleString()} SF`} />
            <QtyRow label="Area (SY)" value={`${sy.toFixed(1)} SY`} />
          </>)}
          {cy > 0 && <QtyRow label="Volume"
            value={metric ? formatQty(cy, 'cy', system, 1) : `${cy.toFixed(1)} CY`} />}
          <QtyRow label="Perimeter"
            value={metric ? formatQty(perimeter, 'lf', system, 1) : `${perimeter.toFixed(1)} LF`} />
        </tbody>
      </table>
      {!isActive && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={onEdit}>Edit Config</button>
          <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={onDelete}>Delete Area</button>
        </div>
      )}
    </div>
  );
}

/* ==== WALLS TAB ==== */

function WallsTabContent({ walls, allWalls, activeWallId, selectedWallId, scalePxPerFt,
  onSelectWall, onEditWall, onDeleteWall, onSendWallsToBid,
}: {
  walls: TakeoffWall[]; allWalls: TakeoffWall[]; activeWallId: number | null;
  selectedWallId: number | null; scalePxPerFt: number;
  onSelectWall: (id: number | null) => void; onEditWall: (id: number) => void;
  onDeleteWall: (id: number) => void; onSendWallsToBid?: () => void;
}) {
  const system = useUnitSystem();
  const focusedWall = walls.find((w) => w.id === (activeWallId ?? selectedWallId));

  if (focusedWall) {
    return (
      <WallDetail
        wall={focusedWall} scalePxPerFt={scalePxPerFt}
        isActive={focusedWall.id === activeWallId}
        onEdit={() => onEditWall(focusedWall.id)}
        onDelete={() => onDeleteWall(focusedWall.id)}
      />
    );
  }

  const hasCompletedWalls = allWalls.some((w) => w.points.length >= 2);
  return (
    <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
      {walls.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 24 }}>
          No walls on this page.
        </p>
      )}
      {walls.map((wall) => {
        const globalIdx = allWalls.indexOf(wall);
        const lf = computeRunLengthLF(wall.points, scalePxPerFt);
        return (
          <div key={wall.id} onClick={() => onSelectWall(wall.id)} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
            borderRadius: 4, cursor: 'pointer', marginBottom: 2,
          }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ width: 8, height: 8, borderRadius: 2, background: wall.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {wall.label || `Wall ${globalIdx + 1}`}
            </span>
            <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
              {system === 'metric' ? formatQty(lf, 'lf', system, 1) : `${fmt(lf)}'`}
            </span>
          </div>
        );
      })}
      {onSendWallsToBid && hasCompletedWalls && !activeWallId && (
        <button className="btn btn-primary btn-sm" style={{ width: '100%', marginTop: 12 }}
          onClick={onSendWallsToBid}>
          Send Walls to Bid
        </button>
      )}
    </div>
  );
}

function WallDetail({ wall, scalePxPerFt, isActive, onEdit, onDelete }: {
  wall: TakeoffWall; scalePxPerFt: number; isActive: boolean;
  onEdit: () => void; onDelete: () => void;
}) {
  const system = useUnitSystem();
  const metric = system === 'metric';
  const lengthLF = computeRunLengthLF(wall.points, scalePxPerFt);
  const q = computeWallQuantities({
    lengthLF, heightFt: wall.heightFt, thicknessIn: wall.thicknessIn,
    faces: wall.faces, memberSpacingIn: wall.memberSpacingIn,
  });

  return (
    <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: wall.color, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {wall.label || 'Untitled Wall'}
        </span>
        {isActive && <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>DRAWING</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        {metric
          ? <>{formatQty(wall.heightFt, 'ft', system)} H &middot; {formatQty(wall.thicknessIn, 'in', system, 0)} thk</>
          : <>{wall.heightFt}&apos; H &middot; {wall.thicknessIn}&quot; thk</>} &middot;{' '}
        {wall.faces} face{wall.faces !== 1 ? 's' : ''}
      </div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <tbody>
          <QtyRow label="Length"
            value={metric ? formatQty(lengthLF, 'lf', system, 1) : `${fmt(lengthLF)} LF`} />
          <QtyRow label="Surface area"
            value={metric ? formatQty(q.surfaceSF, 'sf', system, 1) : `${Math.round(q.surfaceSF).toLocaleString()} SF`} />
          <QtyRow label="Volume"
            value={metric ? formatQty(q.volumeCY, 'cy', system, 2) : `${q.volumeCY.toFixed(2)} CY`} />
          {q.memberCount > 0 && (
            <QtyRow label="Members"
              value={`${q.memberCount} @ ${metric ? formatQty(q.memberLF, 'lf', system, 1) : `${fmt(q.memberLF)} LF`}`} />
          )}
        </tbody>
      </table>
      {!isActive && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={onEdit}>Edit Config</button>
          <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={onDelete}>Delete Wall</button>
        </div>
      )}
    </div>
  );
}

/* ==== Shared helpers ==== */

function QtyRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '3px 0', color: 'var(--text-secondary)' }}>{label}</td>
      <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 600 }}>{value}</td>
    </tr>
  );
}

function fmt(n: number): string { return n.toFixed(1); }
