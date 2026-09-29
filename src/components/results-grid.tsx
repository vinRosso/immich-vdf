"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { resultsGridColumns, resultsGridGap, visibleRowRange } from "@/lib/results-sort";

const OVERSCAN_ROWS = 2;

type GridState = {
  columns: number;
  gap: number;
  cardWidth: number;
  cardHeight: number;
  startRow: number;
  endRow: number;
};

export function ResultsGrid<T>({
  items,
  cardSize,
  getKey,
  renderItem,
}: {
  items: T[];
  cardSize: number;
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<GridState | null>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const parent = scrollParent(grid);
    let frame = 0;

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const node = gridRef.current;
        if (!node) return;
        const width = node.clientWidth;
        const columns = resultsGridColumns(cardSize, window.innerWidth);
        const gap = resultsGridGap(cardSize);
        if (width <= 0 || columns <= 0) return;
        const cardWidth = (width - gap * (columns - 1)) / columns;
        const cardHeight = (cardWidth * 3) / 4;
        const rowCount = Math.ceil(items.length / columns);
        const parentRect = parent.getBoundingClientRect();
        const gridRect = node.getBoundingClientRect();
        const range = visibleRowRange({
          scrollTop: parent.scrollTop,
          viewportHeight: parent.clientHeight,
          gridTop: gridRect.top - parentRect.top + parent.scrollTop,
          rowStride: cardHeight + gap,
          rowCount,
          overscan: OVERSCAN_ROWS,
        });
        setState((current) => {
          if (
            current &&
            current.columns === columns &&
            current.gap === gap &&
            nearly(current.cardWidth, cardWidth) &&
            nearly(current.cardHeight, cardHeight) &&
            current.startRow === range.startRow &&
            current.endRow === range.endRow
          ) {
            return current;
          }
          return { columns, gap, cardWidth, cardHeight, startRow: range.startRow, endRow: range.endRow };
        });
      });
    };

    measure();
    parent.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    observer.observe(parent);
    const timer = window.setInterval(measure, 400);
    return () => {
      cancelAnimationFrame(frame);
      parent.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [cardSize, items.length]);

  const columns = state?.columns ?? resultsGridColumns(cardSize, 1280);
  const gap = state?.gap ?? resultsGridGap(cardSize);
  const cardWidth = state?.cardWidth ?? 0;
  const cardHeight = state?.cardHeight ?? 0;
  const rowCount = Math.ceil(items.length / columns);
  const height = state
    ? rowCount === 0
      ? 0
      : rowCount * cardHeight + Math.max(0, rowCount - 1) * gap
    : placeholderHeight(items.length, cardSize);
  const cells: { item: T; top: number; left: number }[] = [];
  if (state && cardWidth > 0) {
    const start = state.startRow * columns;
    const end = Math.min(items.length, state.endRow * columns);
    for (let index = start; index < end; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      cells.push({
        item: items[index],
        top: row * (cardHeight + gap),
        left: column * (cardWidth + gap),
      });
    }
  }

  return (
    <div ref={gridRef} className="relative" style={{ height: height || undefined }}>
      {cells.map((cell) => (
        <div
          key={getKey(cell.item)}
          className="absolute"
          style={{ top: cell.top, left: cell.left, width: cardWidth, height: cardHeight }}
        >
          {renderItem(cell.item)}
        </div>
      ))}
    </div>
  );
}

function scrollParent(node: HTMLElement): HTMLElement {
  let current = node.parentElement;
  while (current) {
    const overflow = getComputedStyle(current).overflowY;
    if (overflow === "auto" || overflow === "scroll") return current;
    current = current.parentElement;
  }
  return document.documentElement;
}

function nearly(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.5;
}

function placeholderHeight(count: number, cardSize: number): number {
  const columns = resultsGridColumns(cardSize, 1280);
  const gap = resultsGridGap(cardSize);
  const cardWidth = (1100 - gap * (columns - 1)) / columns;
  const cardHeight = (cardWidth * 3) / 4;
  const rows = Math.ceil(count / columns);
  if (rows <= 0) return 0;
  return rows * cardHeight + (rows - 1) * gap;
}
