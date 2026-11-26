// @vitest-environment jsdom
import {
  computeBoardDropResult,
  toColumnDroppableId,
  type BoardColumnDescriptor,
} from '../BoardDragContext.js';

const COLUMNS: BoardColumnDescriptor[] = [
  { key: 'backlog', itemIds: ['a', 'b', 'c'] },
  { key: 'in_progress', itemIds: ['d', 'e'] },
  { key: 'done', itemIds: [] },
];

describe('BoardDragContext — computeBoardDropResult (Story 44-6 Test 3)', () => {
  it('computes (itemId, fromColumnKey, toColumnKey, afterId, beforeId) for within-column downward move', () => {
    const result = computeBoardDropResult(COLUMNS, 'a', 'b');
    expect(result).toEqual({
      itemId: 'a',
      fromColumnKey: 'backlog',
      toColumnKey: 'backlog',
      afterId: 'b',
      beforeId: 'c',
    });
  });

  it('computes (afterId, beforeId) for within-column upward move', () => {
    const result = computeBoardDropResult(COLUMNS, 'c', 'b');
    expect(result).toEqual({
      itemId: 'c',
      fromColumnKey: 'backlog',
      toColumnKey: 'backlog',
      afterId: 'a',
      beforeId: 'b',
    });
  });

  it('computes cross-column drop onto a populated target card', () => {
    const result = computeBoardDropResult(COLUMNS, 'a', 'e');
    expect(result).toEqual({
      itemId: 'a',
      fromColumnKey: 'backlog',
      toColumnKey: 'in_progress',
      afterId: 'd',
      beforeId: 'e',
    });
  });

  it('computes cross-column drop onto an empty column container', () => {
    const result = computeBoardDropResult(COLUMNS, 'a', toColumnDroppableId('done'));
    expect(result).toEqual({
      itemId: 'a',
      fromColumnKey: 'backlog',
      toColumnKey: 'done',
      afterId: null,
      beforeId: null,
    });
  });

  it('returns null when dropped onto itself in the same column', () => {
    expect(computeBoardDropResult(COLUMNS, 'b', 'b')).toBeNull();
  });
});
