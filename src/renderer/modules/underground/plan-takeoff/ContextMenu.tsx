import type { ContextMenuItem } from '../../../components/ContextMenu';

// The generic menu component lives in components/ContextMenu; this module
// keeps only the takeoff-specific item lists.
export { ContextMenu } from '../../../components/ContextMenu';
export type { ContextMenuItem } from '../../../components/ContextMenu';

export type ContextTargetType = 'vertex' | 'segment' | 'fitting' | 'countItem' | 'area' | 'annotation' | 'canvas';

export function getMenuItems(targetType: ContextTargetType): ContextMenuItem[] {
  switch (targetType) {
    case 'vertex':
      return [
        { label: 'Edit Vertex', action: 'editVertex' },
        { label: 'Move Vertex', action: 'moveVertex' },
        { label: 'Delete Vertex', action: 'deleteVertex' },
        { label: 'Insert Fitting', action: 'insertFitting' },
        { label: 'Start New Run From Here', action: 'startRunFromHere' },
        { label: 'View Profile', action: 'viewProfile' },
      ];
    case 'segment':
      return [
        { label: 'View Profile', action: 'viewProfile' },
        { label: 'Add Vertex Here', action: 'addVertexHere' },
        { label: 'Insert Fitting Here', action: 'insertFittingHere' },
        { label: 'Delete Run', action: 'deleteRun' },
      ];
    case 'fitting':
      return [
        { label: 'Edit Fitting', action: 'editFitting' },
        { label: 'Remove Fitting', action: 'removeFitting' },
        { label: 'Start New Run From Here', action: 'startRunFromHere' },
      ];
    case 'countItem':
      return [
        { label: 'Edit Item', action: 'editItem' },
        { label: 'Remove Item', action: 'removeItem' },
        { label: 'Duplicate Item', action: 'duplicateItem' },
      ];
    case 'area':
      return [
        { label: 'Edit Area', action: 'editArea' },
        { label: 'Delete Area', action: 'deleteArea' },
      ];
    case 'annotation':
      return [
        { label: 'Edit Text', action: 'editAnnotationText' },
        { label: 'Delete Annotation', action: 'deleteAnnotation' },
      ];
    case 'canvas':
      return [
        { label: 'Start New Run', action: 'startNewRun' },
        { label: 'Add Count Item', action: 'addCountItem' },
        { label: 'Measure Area', action: 'addArea' },
      ];
  }
}
