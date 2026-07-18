import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu';
import { SortableTh, useSortableRows } from '../../components/SortableTable';
import { useToastStore } from '../../stores/toast-store';
import { buildFolderTree, descendantIds, folderPath, formatBytes, type FolderLike } from '../../../shared/documentFiles';
import type { AddDocumentsResult, JobDocumentFolderDTO, JobDocumentRow } from '../../../shared/types/ipc';
import { DOC_DRAG_TYPE, FolderTree } from './FolderTree';

/**
 * What was right-clicked. 'root' = the tree's "Documents" header (targets the
 * job root); 'pane' = blank space in the file pane (targets the open folder);
 * 'folder' / 'doc' = a specific folder row/chip or document row.
 */
type MenuState =
  | { kind: 'root' | 'pane'; x: number; y: number }
  | { kind: 'folder'; folder: { id: number; name: string }; x: number; y: number }
  | { kind: 'doc'; doc: JobDocumentRow; x: number; y: number };

type NamePrompt =
  | { kind: 'newFolder'; parentId: number | null }
  | { kind: 'newText'; parentId: number | null }
  | { kind: 'renameFolder'; folderId: number; initial: string };

/**
 * Per-job document store: every file related to the job (plans, addenda,
 * sub quotes, photos, contracts) in one place, organized into a folder tree
 * the user builds themselves. Files are copied into an app-managed folder,
 * so the originals can move or disappear without breaking the job.
 */
export function DocumentsTab({ jobId, onCountChange }: {
  jobId: number;
  onCountChange?: (count: number) => void;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const [docs, setDocs] = useState<JobDocumentRow[]>([]);
  const [folders, setFolders] = useState<JobDocumentFolderDTO[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void } | null>(null);
  const [movingDoc, setMovingDoc] = useState<JobDocumentRow | null>(null);
  const [movingFolder, setMovingFolder] = useState<{ id: number; name: string } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null);

  const load = useCallback(async () => {
    try {
      const [docRows, folderRows] = await Promise.all([
        window.api.listJobDocuments(jobId),
        window.api.listJobDocumentFolders(jobId),
      ]);
      setDocs(docRows);
      setFolders(folderRows);
      onCountChange?.(docRows.length);
    } catch (err: any) {
      addToast(err?.message || 'Failed to load documents.', 'error');
    }
  }, [jobId, onCountChange, addToast]);

  useEffect(() => { load(); }, [load]);

  // If the open folder was just deleted (e.g. from a second window), fall back to root.
  useEffect(() => {
    if (currentFolderId != null && !folders.some((f) => f.id === currentFolderId)) {
      setCurrentFolderId(null);
    }
  }, [folders, currentFolderId]);

  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const childFolders = useMemo(
    () => folders
      .filter((f) => f.parent_id === currentFolderId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [folders, currentFolderId]
  );
  const currentDocs = useMemo(
    () => docs.filter((d) => (d.folder_id ?? null) === currentFolderId),
    [docs, currentFolderId]
  );
  const totalBytes = useMemo(() => docs.reduce((s, d) => s + d.size_bytes, 0), [docs]);

  const breadcrumb = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const chain: JobDocumentFolderDTO[] = [];
    let cur = currentFolderId != null ? byId.get(currentFolderId) : undefined;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
    }
    return chain;
  }, [folders, currentFolderId]);

  // Every folder is a valid target for a document. A folder being moved can't
  // go to itself or one of its own subfolders (the backend re-checks this).
  const moveTargets = useCallback((excludeFolderId?: number) => {
    const blocked = excludeFolderId != null ? descendantIds(folders as FolderLike[], excludeFolderId) : new Set<number>();
    return folders
      .filter((f) => !blocked.has(f.id))
      .map((f) => ({ id: f.id, label: folderPath(folders as FolderLike[], f.id).join(' / ') }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [folders]);

  const { sorted, sort, toggleSort } = useSortableRows(currentDocs, {
    name: (d) => d.filename,
    size: (d) => d.size_bytes,
    added: (d) => d.added_at,
  });

  const reportResult = (result: AddDocumentsResult | null) => {
    if (!result) return; // dialog canceled
    if (result.added > 0) {
      addToast(`Added ${result.added} document${result.added !== 1 ? 's' : ''}.`, 'success');
    }
    if (result.skippedDuplicates > 0) {
      addToast(`Skipped ${result.skippedDuplicates} duplicate${result.skippedDuplicates !== 1 ? 's' : ''} already on this job.`, 'info');
    }
    if (result.failed.length > 0) {
      addToast(`Could not add: ${result.failed.join(', ')}`, 'error');
    }
  };

  const handleAdd = async (folderId: number | null = currentFolderId) => {
    setBusy(true);
    try {
      const result = await window.api.addJobDocuments(jobId, folderId);
      reportResult(result);
      if (result && folderId !== currentFolderId) setCurrentFolderId(folderId);
      await load();
    } catch (err: any) {
      addToast(err?.message || 'Failed to add documents.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // "New Text File": create an empty .txt in the store, then open it in the
  // OS editor so the user can start typing right away.
  const handleCreateText = async (parentId: number | null, name: string) => {
    try {
      const { id } = await window.api.createJobTextDocument(jobId, parentId, name);
      await load();
      if (parentId !== currentFolderId) setCurrentFolderId(parentId);
      await window.api.openJobDocument(id);
    } catch (err: any) {
      addToast(err?.message || 'Failed to create text file.', 'error');
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    setBusy(true);
    try {
      const paths = files
        .map((f) => {
          try { return window.api.getDroppedFilePath(f); } catch { return ''; }
        })
        .filter(Boolean);
      if (paths.length === 0) {
        addToast('Could not read the dropped files.', 'error');
        return;
      }
      reportResult(await window.api.addJobDocumentPaths(jobId, paths, currentFolderId));
      await load();
    } catch (err: any) {
      addToast(err?.message || 'Failed to add documents.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async (doc: JobDocumentRow) => {
    try {
      await window.api.openJobDocument(doc.id);
    } catch (err: any) {
      addToast(err?.message || 'Failed to open document.', 'error');
    }
  };

  const handleReveal = async (doc: JobDocumentRow) => {
    try {
      await window.api.revealJobDocument(doc.id);
    } catch (err: any) {
      addToast(err?.message || 'Failed to show document.', 'error');
    }
  };

  const handleDelete = (doc: JobDocumentRow) => {
    setConfirmState({
      msg: `Delete "${doc.filename}" from this job? The copy in BidSheet's document store is removed; your original file (if it still exists) is not touched.`,
      onYes: async () => {
        setConfirmState(null);
        try {
          await window.api.deleteJobDocument(doc.id);
          await load();
        } catch (err: any) {
          addToast(err?.message || 'Failed to delete document.', 'error');
        }
      },
    });
  };

  const handleDropDocOnFolder = async (docId: number, folderId: number | null) => {
    try {
      await window.api.moveJobDocument(docId, folderId);
      await load();
    } catch (err: any) {
      addToast(err?.message || 'Failed to move document.', 'error');
    }
  };

  const handleCreateFolder = async (parentId: number | null, name: string) => {
    try {
      const result = await window.api.createJobDocumentFolder(jobId, parentId, name);
      await load();
      setCurrentFolderId(result.id);
    } catch (err: any) {
      addToast(err?.message || 'Failed to create folder.', 'error');
    }
  };

  const handleRenameFolder = async (id: number, name: string) => {
    try {
      await window.api.renameJobDocumentFolder(id, name);
      await load();
    } catch (err: any) {
      addToast(err?.message || 'Failed to rename folder.', 'error');
    }
  };

  const handleDeleteFolderRequest = (node: { id: number; name: string }) => {
    setConfirmState({
      msg: `Delete the empty folder "${node.name}"? This only works while it has no files or subfolders in it.`,
      onYes: async () => {
        setConfirmState(null);
        try {
          await window.api.deleteJobDocumentFolder(node.id);
          if (currentFolderId === node.id) setCurrentFolderId(null);
          await load();
        } catch (err: any) {
          addToast(err?.message || 'Failed to delete folder.', 'error');
        }
      },
    });
  };

  const menuItems = (m: MenuState): ContextMenuItem[] => {
    switch (m.kind) {
      case 'folder':
        return [
          { label: 'Open', action: 'open' },
          { label: 'New Subfolder…', action: 'newFolder' },
          { label: 'New Text File…', action: 'newText' },
          { label: 'Add Files Here…', action: 'addFiles' },
          { label: 'Rename…', action: 'rename' },
          { label: 'Move to…', action: 'moveFolder' },
          { label: 'Delete Folder', action: 'deleteFolder', danger: true },
        ];
      case 'doc':
        return [
          { label: 'Open', action: 'open' },
          { label: 'Show in Folder', action: 'reveal' },
          { label: 'Move to…', action: 'moveDoc' },
          { label: 'Delete', action: 'deleteDoc', danger: true },
        ];
      default: // 'root' and 'pane': create things in the targeted folder
        return [
          { label: 'New Folder…', action: 'newFolder' },
          { label: 'New Text File…', action: 'newText' },
          { label: 'Add Files…', action: 'addFiles' },
        ];
    }
  };

  const handleMenuAction = (action: string) => {
    if (!menu) return;
    // 'root' always targets the job root, even when a folder is open.
    const targetFolderId =
      menu.kind === 'folder' ? menu.folder.id : menu.kind === 'pane' ? currentFolderId : null;
    switch (action) {
      case 'open':
        if (menu.kind === 'doc') handleOpen(menu.doc);
        else setCurrentFolderId(targetFolderId);
        break;
      case 'newFolder':
        setNamePrompt({ kind: 'newFolder', parentId: targetFolderId });
        break;
      case 'newText':
        setNamePrompt({ kind: 'newText', parentId: targetFolderId });
        break;
      case 'addFiles':
        handleAdd(targetFolderId);
        break;
      case 'rename':
        if (menu.kind === 'folder') setNamePrompt({ kind: 'renameFolder', folderId: menu.folder.id, initial: menu.folder.name });
        break;
      case 'moveFolder':
        if (menu.kind === 'folder') setMovingFolder(menu.folder);
        break;
      case 'deleteFolder':
        if (menu.kind === 'folder') handleDeleteFolderRequest(menu.folder);
        break;
      case 'reveal':
        if (menu.kind === 'doc') handleReveal(menu.doc);
        break;
      case 'moveDoc':
        if (menu.kind === 'doc') setMovingDoc(menu.doc);
        break;
      case 'deleteDoc':
        if (menu.kind === 'doc') handleDelete(menu.doc);
        break;
    }
  };

  const formatAdded = (iso: string) => (iso ? iso.slice(0, 10) : '--');

  return (
    // Fill the visible page so the whole file pane (and the folder tree) is a
    // drop / right-click target, not just the short top strip its content fills.
    <div className="flex gap-12" style={{ alignItems: 'stretch', minHeight: 'calc(100vh - 210px)' }}>
      <div style={{ width: 220, flexShrink: 0, display: 'flex' }} className="no-print">
        <FolderTree
          tree={tree}
          selectedId={currentFolderId}
          onSelect={setCurrentFolderId}
          onCreateFolder={handleCreateFolder}
          onRename={handleRenameFolder}
          onDeleteRequest={handleDeleteFolderRequest}
          onMoveRequest={setMovingFolder}
          onDropDocument={handleDropDocOnFolder}
          onContextMenu={(node, x, y) =>
            setMenu(node ? { kind: 'folder', folder: node, x, y } : { kind: 'root', x, y })}
        />
      </div>

      <div
        style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', ...(dragOver ? { outline: '2px dashed var(--accent, #4a90d9)', outlineOffset: -2, borderRadius: 8 } : {}) }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
        onDrop={handleDrop}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ kind: 'pane', x: e.clientX, y: e.clientY });
        }}
      >
        <div className="flex justify-between items-center" style={{ padding: '8px 8px 4px' }}>
          <div>
            <span className="text-muted" style={{ fontSize: 12 }}>
              {docs.length} document{docs.length !== 1 ? 's' : ''}
              {docs.length > 0 && <> &middot; {formatBytes(totalBytes)} total &middot; drag files here or use Add Files</>}
            </span>
            <div style={{ fontSize: 12, marginTop: 2 }}>
              <span className="material-name-link" onClick={() => setCurrentFolderId(null)}>Documents</span>
              {breadcrumb.map((f) => (
                <React.Fragment key={f.id}>
                  {' / '}
                  <span className="material-name-link" onClick={() => setCurrentFolderId(f.id)}>{f.name}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="flex gap-8 items-center no-print">
            <button className="btn btn-sm btn-secondary"
              onClick={() => setNamePrompt({ kind: 'newFolder', parentId: currentFolderId })}>
              + New Folder
            </button>
            <button className="btn btn-sm btn-secondary" title="Create an empty text file and open it"
              onClick={() => setNamePrompt({ kind: 'newText', parentId: currentFolderId })}>
              + Text File
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => handleAdd()} disabled={busy}>
              + Add Files
            </button>
          </div>
        </div>

        {childFolders.length > 0 && (
          <div className="flex gap-8" style={{ flexWrap: 'wrap', padding: '4px 8px 10px' }}>
            {childFolders.map((f) => (
              <button
                key={f.id}
                className="btn btn-sm btn-secondary"
                onClick={() => setCurrentFolderId(f.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ kind: 'folder', folder: { id: f.id, name: f.name }, x: e.clientX, y: e.clientY });
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const docId = e.dataTransfer.getData(DOC_DRAG_TYPE);
                  if (docId) handleDropDocOnFolder(Number(docId), f.id);
                }}
              >
                📁 {f.name}
              </button>
            ))}
          </div>
        )}

        {currentDocs.length === 0 ? (
          childFolders.length === 0 && (
            <p className="text-muted" style={{ fontSize: 13, padding: '24px 8px', textAlign: 'center' }}>
              {currentFolderId == null
                ? 'No documents yet. Drag files here, or click "+ Add Files" to attach plans, addenda, quotes, photos, or anything else that belongs with this job.'
                : 'This folder is empty. Drag files here, or click "+ Add Files".'}
            </p>
          )
        ) : (
          <table className="bid-grid">
            <thead>
              <tr>
                <SortableTh label="Name" sortKey="name" sort={sort} onToggle={toggleSort} />
                <SortableTh label="Size" sortKey="size" sort={sort} onToggle={toggleSort} className="text-right" />
                <SortableTh label="Added" sortKey="added" sort={sort} onToggle={toggleSort} className="text-right" />
                <th className="no-print" style={{ width: 220 }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((doc) => (
                <tr
                  key={doc.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData(DOC_DRAG_TYPE, String(doc.id))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenu({ kind: 'doc', doc, x: e.clientX, y: e.clientY });
                  }}
                >
                  <td>
                    <span className="material-name-link" onClick={() => handleOpen(doc)} title="Open">
                      {doc.filename}
                    </span>
                  </td>
                  <td className="text-right">{formatBytes(doc.size_bytes)}</td>
                  <td className="text-right">{formatAdded(doc.added_at)}</td>
                  <td className="no-print">
                    <div className="flex gap-8 justify-end">
                      <button className="btn btn-sm btn-secondary" onClick={() => handleOpen(doc)}>Open</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleReveal(doc)} title="Show in folder">Folder</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => setMovingDoc(doc)}>Move</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(doc)}>&times;</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {movingDoc && (
        <MoveModal
          title={`Move "${movingDoc.filename}" to`}
          targets={moveTargets()}
          onMove={async (folderId) => {
            await window.api.moveJobDocument(movingDoc.id, folderId);
            setMovingDoc(null);
            await load();
          }}
          onCancel={() => setMovingDoc(null)}
        />
      )}

      {movingFolder && (
        <MoveModal
          title={`Move folder "${movingFolder.name}" to`}
          targets={moveTargets(movingFolder.id)}
          onMove={async (folderId) => {
            try {
              await window.api.moveJobDocumentFolder(movingFolder.id, folderId);
              setMovingFolder(null);
              await load();
            } catch (err: any) {
              addToast(err?.message || 'Failed to move folder.', 'error');
            }
          }}
          onCancel={() => setMovingFolder(null)}
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu)}
          onAction={handleMenuAction}
          onClose={() => setMenu(null)}
        />
      )}

      {namePrompt && (
        <NamePromptModal
          title={
            namePrompt.kind === 'newFolder' ? 'New Folder'
              : namePrompt.kind === 'newText' ? 'New Text File'
              : 'Rename Folder'
          }
          placeholder={namePrompt.kind === 'newText' ? 'Notes.txt' : 'Folder name'}
          initial={namePrompt.kind === 'renameFolder' ? namePrompt.initial : ''}
          submitLabel={namePrompt.kind === 'renameFolder' ? 'Rename' : 'Create'}
          onSubmit={async (name) => {
            const prompt = namePrompt;
            setNamePrompt(null);
            if (prompt.kind === 'newFolder') await handleCreateFolder(prompt.parentId, name);
            else if (prompt.kind === 'newText') await handleCreateText(prompt.parentId, name);
            else await handleRenameFolder(prompt.folderId, name);
          }}
          onCancel={() => setNamePrompt(null)}
        />
      )}

      {confirmState && (
        <ConfirmDialog message={confirmState.msg} onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)} yesLabel="Delete" variant="danger" />
      )}
    </div>
  );
}

/** Small "give it a name" modal used by New Folder / New Text File / Rename Folder. */
function NamePromptModal({ title, placeholder, initial, submitLabel, onSubmit, onCancel }: {
  title: string;
  placeholder: string;
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const commit = () => { const trimmed = name.trim(); if (trimmed) onSubmit(trimmed); };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 380 }} role="dialog" aria-label={title}>
        <h3>{title}</h3>
        <input
          autoFocus
          className="form-control"
          placeholder={placeholder}
          value={name}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') onCancel();
          }}
        />
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={commit} disabled={!name.trim()}>{submitLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** Shared picker for "move this document/folder to…", including a Root option. */
function MoveModal({ title, targets, onMove, onCancel }: {
  title: string;
  targets: { id: number; label: string }[];
  onMove: (folderId: number | null) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<string>('');

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 420 }} role="dialog" aria-label={title}>
        <h3>{title}</h3>
        <select className="form-control" autoFocus value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Documents (root)</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onMove(choice ? Number(choice) : null)}>Move</button>
        </div>
      </div>
    </div>
  );
}
