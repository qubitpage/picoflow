"use client";
import { useState } from "react";

/**
 * Tiny client-side pagination wrapper. Splits a row array into pages of
 * `pageSize` and renders pageNum/total + prev/next controls. Designed to
 * stay snappy with up to a few thousand rows; for larger sets, switch to
 * server-side pagination.
 */
export function Paginated<T>({
  rows,
  pageSize = 25,
  emptyMessage = "No rows yet.",
  render,
}: {
  rows: T[];
  pageSize?: number;
  emptyMessage?: string;
  render: (row: T, indexOnPage: number, absoluteIndex: number) => React.ReactNode;
}) {
  const [page, setPage] = useState(0);
  if (rows.length === 0) return <p className="text-ink/50 text-sm">{emptyMessage}</p>;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const slice = rows.slice(start, start + pageSize);
  return (
    <>
      <div>{slice.map((r, i) => render(r, i, start + i))}</div>
      <div className="flex items-center justify-between mt-3 text-xs text-ink/60">
        <span>
          Showing <strong>{start + 1}</strong>–<strong>{start + slice.length}</strong> of{" "}
          <strong>{rows.length}</strong>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="px-2 py-1 rounded border border-ink/10 disabled:opacity-30"
          >
            Prev
          </button>
          <span className="font-mono">
            {safePage + 1} / {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="px-2 py-1 rounded border border-ink/10 disabled:opacity-30"
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}
