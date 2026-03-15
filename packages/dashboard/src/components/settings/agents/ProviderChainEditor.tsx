import { useState, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IProviderChainEntry } from '@tamma/shared';
import { ProviderEntryForm } from './ProviderEntryForm.js';

interface ProviderChainEditorProps {
  chain: IProviderChainEntry[];
  onChange: (chain: IProviderChainEntry[]) => void;
}

function SortableEntry({
  id,
  entry,
  index,
  onRemove,
}: {
  id: string;
  entry: IProviderChainEntry;
  index: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-md border border-gray-200"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab text-gray-400 hover:text-gray-600 touch-none"
        title="Drag to reorder"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
        </svg>
      </button>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-gray-900">{entry.provider}</span>
        {entry.model && <span className="text-sm text-gray-500 ml-2">{entry.model}</span>}
        {entry.apiKeyRef && (
          <span className="text-xs text-gray-400 ml-2">[{entry.apiKeyRef}]</span>
        )}
      </div>
      <span className="text-xs text-gray-400 shrink-0">
        {index === 0 ? 'Primary' : `Fallback ${index}`}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="text-red-400 hover:text-red-600 text-sm shrink-0"
        title="Remove provider"
      >
        &times;
      </button>
    </div>
  );
}

/** Generate stable IDs: provider:model@index */
function buildItemIds(chain: IProviderChainEntry[]): string[] {
  return chain.map((entry, i) => `${entry.provider}:${entry.model ?? ''}@${i}`);
}

export function ProviderChainEditor({ chain, onChange }: ProviderChainEditorProps): JSX.Element {
  const [showForm, setShowForm] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const itemIds = useMemo(() => buildItemIds(chain), [chain]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = itemIds.indexOf(String(active.id));
    const newIndex = itemIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    onChange(arrayMove(chain, oldIndex, newIndex));
  };

  const handleRemove = (index: number) => {
    onChange(chain.filter((_, i) => i !== index));
  };

  const handleAdd = (entry: IProviderChainEntry) => {
    onChange([...chain, entry]);
    setShowForm(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-gray-700">Provider Chain</label>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          {showForm ? 'Cancel' : '+ Add Provider'}
        </button>
      </div>

      {chain.length === 0 && !showForm && (
        <p className="text-sm text-gray-500 italic py-2">
          No providers configured. Uses defaults.
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {chain.map((entry, index) => (
              <SortableEntry
                key={itemIds[index]}
                id={itemIds[index]!}
                entry={entry}
                index={index}
                onRemove={() => handleRemove(index)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {showForm && (
        <div className="mt-3">
          <ProviderEntryForm onAdd={handleAdd} onCancel={() => setShowForm(false)} />
        </div>
      )}
    </div>
  );
}
