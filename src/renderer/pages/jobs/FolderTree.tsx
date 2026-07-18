import React, { useState } from 'react';
import type { FolderNode } from '../../../shared/documentFiles';

export const DOC_DRAG_TYPE = 'application/x-bidsheet-doc-id';

interface FolderActions {
  onCreateFolder: (parentId: number | null, name: string) => void;
  onRename: (id: number, name: string) => void;
  onDeleteRequest: (node: { id: number; name: string }) => void;
  onMoveRequest: (node: { id: number; name: string }) => void;
  onDropDocument: (docId: number, folderId: number | null) => void;
  /** Right-click on a folder row (or the root "Documents" header with node = null). */
  onContextMenu: (node: { id: number; name: string } | null, x: number, y: number) => void;
}

interface Props extends FolderActions {
  tree: FolderNode[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}

/** Job Documents' folder sidebar: a small nested tree with inline create/rename and a Move picker for reparenting. */
export function FolderTree({ tree, selectedId, onSelect, ...actions }: Props) {
  const [addingRoot, setAddingRoot] = useState(false);
  const [rootDragOver, setRootDragOver] = useState(false);
  const [fillerDragOver, setFillerDragOver] = useState(false);

  return (
    <div className="card" style={{ padding: 6, flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div
        onClick={() => onSelect(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          actions.onContextMenu(null, e.clientX, e.clientY);
        }}
        onDragOver={(e) => { e.preventDefault(); setRootDragOver(true); }}
        onDragLeave={() => setRootDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setRootDragOver(false);
          const docId = e.dataTransfer.getData(DOC_DRAG_TYPE);
          if (docId) actions.onDropDocument(Number(docId), null);
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 6px',
          borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
          background: selectedId === null ? 'var(--accent-soft, rgba(74,144,217,0.15))' : rootDragOver ? 'rgba(74,144,217,0.25)' : 'transparent',
          outline: rootDragOver ? '1px dashed var(--accent, #4a90d9)' : undefined,
        }}
      >
        Documents
      </div>

      {tree.map((node) => (
        <FolderRow key={node.id} node={node} depth={1} selectedId={selectedId} onSelect={onSelect} {...actions} />
      ))}

      {addingRoot ? (
        <div style={{ paddingLeft: 10 }}>
          <NewFolderInline
            onSubmit={(name) => { actions.onCreateFolder(null, name); setAddingRoot(false); }}
            onCancel={() => setAddingRoot(false)}
          />
        </div>
      ) : (
        <button className="btn btn-sm btn-secondary" style={{ marginTop: 6, width: '100%' }}
          onClick={() => setAddingRoot(true)}>
          + New Folder
        </button>
      )}

      {/* Empty space under the folder list still drops-to-root and right-clicks
          the root, so the whole sidebar is a target — not just the header row. */}
      <div
        onClick={() => onSelect(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          actions.onContextMenu(null, e.clientX, e.clientY);
        }}
        onDragOver={(e) => { e.preventDefault(); setFillerDragOver(true); }}
        onDragLeave={() => setFillerDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setFillerDragOver(false);
          const docId = e.dataTransfer.getData(DOC_DRAG_TYPE);
          if (docId) actions.onDropDocument(Number(docId), null);
        }}
        style={{
          flex: 1, minHeight: 24, marginTop: 4, borderRadius: 4,
          background: fillerDragOver ? 'rgba(74,144,217,0.25)' : 'transparent',
          outline: fillerDragOver ? '1px dashed var(--accent, #4a90d9)' : undefined,
        }}
      />
    </div>
  );
}

function FolderRow({
  node, depth, selectedId, onSelect, onCreateFolder, onRename, onDeleteRequest, onMoveRequest, onDropDocument, onContextMenu,
}: FolderActions & {
  node: FolderNode;
  depth: number;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [hover, setHover] = useState(false);
  const [nameDraft, setNameDraft] = useState(node.name);

  const commitRename = () => {
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== node.name) onRename(node.id, trimmed);
    else setNameDraft(node.name);
    setRenaming(false);
  };

  return (
    <div>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const docId = e.dataTransfer.getData(DOC_DRAG_TYPE);
          if (docId) onDropDocument(Number(docId), node.id);
        }}
        onClick={() => !renaming && onSelect(node.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu({ id: node.id, name: node.name }, e.clientX, e.clientY);
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, height: 26,
          paddingLeft: 6 + depth * 14, paddingRight: 4,
          borderRadius: 4, cursor: 'pointer',
          background: selectedId === node.id ? 'var(--accent-soft, rgba(74,144,217,0.15))' : dragOver ? 'rgba(74,144,217,0.25)' : 'transparent',
          outline: dragOver ? '1px dashed var(--accent, #4a90d9)' : undefined,
        }}
      >
        {renaming ? (
          <input
            autoFocus
            className="form-control"
            style={{ fontSize: 12, padding: '1px 4px', height: 20, flex: 1 }}
            value={nameDraft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { setNameDraft(node.name); setRenaming(false); }
            }}
            onBlur={commitRename}
          />
        ) : (
          <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.name}
          </span>
        )}
        {hover && !renaming && (
          <div className="flex gap-4 no-print" onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
            <IconBtn title="New subfolder" onClick={() => setAddingChild(true)}>+</IconBtn>
            <IconBtn title="Rename" onClick={() => setRenaming(true)}>✎</IconBtn>
            <IconBtn title="Move to…" onClick={() => onMoveRequest(node)}>⇒</IconBtn>
            <IconBtn title="Delete (must be empty)" onClick={() => onDeleteRequest(node)}>×</IconBtn>
          </div>
        )}
      </div>

      {addingChild && (
        <div style={{ paddingLeft: 6 + (depth + 1) * 14 }}>
          <NewFolderInline
            onSubmit={(name) => { onCreateFolder(node.id, name); setAddingChild(false); }}
            onCancel={() => setAddingChild(false)}
          />
        </div>
      )}

      {node.children.map((child) => (
        <FolderRow
          key={child.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect}
          onCreateFolder={onCreateFolder} onRename={onRename}
          onDeleteRequest={onDeleteRequest} onMoveRequest={onMoveRequest} onDropDocument={onDropDocument}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 18, height: 18, lineHeight: '16px', padding: 0, fontSize: 11,
        border: '1px solid var(--border, #3a3f47)', borderRadius: 3, background: 'transparent',
        color: 'var(--text-muted)', cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function NewFolderInline({ onSubmit, onCancel }: { onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  return (
    <div className="flex gap-4" style={{ padding: '4px 4px 6px' }}>
      <input
        autoFocus
        className="form-control"
        style={{ fontSize: 12, padding: '2px 6px', height: 22 }}
        placeholder="Folder name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) onSubmit(name.trim());
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={() => { if (!name.trim()) onCancel(); }}
      />
      <button className="btn btn-sm btn-primary" style={{ padding: '2px 8px' }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => name.trim() && onSubmit(name.trim())}>
        Add
      </button>
    </div>
  );
}
