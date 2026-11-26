// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BoardCard,
  BoardColumn,
  BoardDragContext,
  type BoardColumnDescriptor,
  type BoardDropResult,
} from '../index.js';

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

describe('BoardDragContext — keyboard operability (Story 44-6 Test 4 / AC12)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('moves a card across columns with grab (Space), ArrowRight, drop (Space) without a pointer', async () => {
    const user = userEvent.setup();
    const onDragEnd = vi.fn<(result: BoardDropResult) => void>();

    const columns: BoardColumnDescriptor[] = [
      { key: 'backlog', itemIds: ['card-1'] },
      { key: 'in_progress', itemIds: [] },
    ];

    // Supply deterministic layout boxes in jsdom so @dnd-kit collision detection
    // and keyboard coordinate movement resolve column 0 -> column 1 cleanly.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const colKey = this.getAttribute('data-column-key');
      if (colKey === 'backlog') return makeRect(0, 0, 280, 400);
      if (colKey === 'in_progress') return makeRect(300, 0, 280, 400);
      const itemId = this.getAttribute('data-item-id');
      if (itemId === 'card-1') return makeRect(10, 40, 260, 80);
      return makeRect(10, 40, 24, 24);
    });

    render(
      <BoardDragContext columns={columns} onDragEnd={onDragEnd}>
        <BoardColumn columnKey="backlog" label="Backlog" totalCount={1} itemIds={['card-1']}>
          <BoardCard itemId="card-1" columnKey="backlog" ariaLabel="TAM-1: Keyboard drag card">
            <span>TAM-1: Keyboard drag card</span>
          </BoardCard>
        </BoardColumn>
        <BoardColumn columnKey="in_progress" label="In Progress" totalCount={0} itemIds={[]}>
          {null}
        </BoardColumn>
      </BoardDragContext>,
    );

    const handle = screen.getByTestId('board-card-handle-card-1');
    handle.focus();
    expect(handle).toHaveFocus();

    // Grab with Space, move right into the empty "In Progress" column, drop with Space
    await user.keyboard(' ');
    await user.keyboard('{ArrowRight}');
    await user.keyboard(' ');

    await waitFor(() => {
      expect(onDragEnd).toHaveBeenCalledWith({
        itemId: 'card-1',
        fromColumnKey: 'backlog',
        toColumnKey: 'in_progress',
        afterId: null,
        beforeId: null,
      });
    });
  });
});
