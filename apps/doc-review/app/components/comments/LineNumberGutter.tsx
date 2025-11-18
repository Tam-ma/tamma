import { MessageCircle } from 'lucide-react';

interface LineNumberGutterProps {
  lineNumber: number;
  hasComments: boolean;
  commentCount: number;
  isSelected: boolean;
  onClick: () => void;
}

export function LineNumberGutter({
  lineNumber,
  hasComments,
  commentCount,
  isSelected,
  onClick,
}: LineNumberGutterProps) {
  return (
    <div
      className={`
        group relative flex h-full min-w-[3.5rem] cursor-pointer items-center justify-end
        border-r px-3 py-1 transition-colors
        ${isSelected ? 'bg-blue-50 border-blue-300' : 'border-slate-200 hover:bg-slate-50'}
      `}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`Line ${lineNumber}${hasComments ? `, ${commentCount} comments` : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <span
        className={`
          select-none text-xs font-mono tabular-nums
          ${isSelected ? 'text-blue-700 font-semibold' : 'text-slate-500'}
        `}
      >
        {lineNumber}
      </span>

      {hasComments && (
        <div className="absolute -right-2 top-1/2 -translate-y-1/2">
          <div className="relative">
            <MessageCircle
              className={`h-4 w-4 ${isSelected ? 'text-blue-600' : 'text-amber-500'}`}
              fill="currentColor"
            />
            {commentCount > 1 && (
              <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-900 text-[9px] font-bold text-white">
                {commentCount > 9 ? '9+' : commentCount}
              </span>
            )}
          </div>
        </div>
      )}

      {!hasComments && (
        <div className="absolute -right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
          <MessageCircle className="h-4 w-4 text-slate-400" />
        </div>
      )}
    </div>
  );
}
