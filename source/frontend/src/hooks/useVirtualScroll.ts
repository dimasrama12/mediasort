import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

interface VirtualScrollOptions {
  itemCount: number;
  itemHeight: number;
  overscan?: number;
  containerHeight: number;
}

interface VirtualScrollResult {
  virtualItems: Array<{ index: number; style: React.CSSProperties }>;
  totalHeight: number;
  startIndex: number;
  endIndex: number;
  scrollToIndex: (index: number) => void;
}

export function useVirtualScroll({
  itemCount,
  itemHeight,
  overscan = 5,
  containerHeight
}: VirtualScrollOptions): VirtualScrollResult {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate visible range
  const { startIndex, endIndex, totalHeight } = useMemo(() => {
    const start = Math.floor(scrollTop / itemHeight);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const startWithOverscan = Math.max(0, start - overscan);
    const endWithOverscan = Math.min(itemCount - 1, start + visibleCount + overscan);
    
    return {
      startIndex: startWithOverscan,
      endIndex: endWithOverscan,
      totalHeight: itemCount * itemHeight
    };
  }, [scrollTop, itemHeight, containerHeight, itemCount, overscan]);

  // Generate virtual items
  const virtualItems = useMemo(() => {
    const items = [];
    for (let i = startIndex; i <= endIndex; i++) {
      items.push({
        index: i,
        style: {
          position: 'absolute' as const,
          top: i * itemHeight,
          height: itemHeight,
          left: 0,
          right: 0
        }
      });
    }
    return items;
  }, [startIndex, endIndex, itemHeight]);

  // Scroll handler with RAF throttling
  const rafId = useRef<number | null>(null);
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
    }
    rafId.current = requestAnimationFrame(() => {
      setScrollTop((e.target as HTMLDivElement).scrollTop);
    });
  }, []);

  // Scroll to specific index
  const scrollToIndex = useCallback((index: number) => {
    if (containerRef.current) {
      containerRef.current.scrollTop = index * itemHeight;
    }
  }, [itemHeight]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, []);

  return {
    virtualItems,
    totalHeight,
    startIndex,
    endIndex,
    scrollToIndex
  };
}

// Hook for grid virtual scrolling (2D)
interface GridVirtualScrollOptions {
  itemCount: number;
  columns: number;
  itemWidth: number;
  itemHeight: number;
  overscan?: number;
  containerHeight: number;
}

interface GridVirtualScrollResult {
  virtualItems: Array<{ index: number; row: number; col: number; style: React.CSSProperties }>;
  totalHeight: number;
  startRow: number;
  endRow: number;
  scrollToIndex: (index: number) => void;
}

export function useGridVirtualScroll({
  itemCount,
  columns,
  itemWidth,
  itemHeight,
  overscan = 2,
  containerHeight
}: GridVirtualScrollOptions): GridVirtualScrollResult {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const rows = Math.ceil(itemCount / columns);

  // Calculate visible range
  const { startRow, endRow, totalHeight } = useMemo(() => {
    const start = Math.floor(scrollTop / itemHeight);
    const visibleRows = Math.ceil(containerHeight / itemHeight);
    const startWithOverscan = Math.max(0, start - overscan);
    const endWithOverscan = Math.min(rows - 1, start + visibleRows + overscan);
    
    return {
      startRow: startWithOverscan,
      endRow: endWithOverscan,
      totalHeight: rows * itemHeight
    };
  }, [scrollTop, itemHeight, containerHeight, rows, overscan]);

  // Generate virtual items
  const virtualItems = useMemo(() => {
    const items = [];
    const startIndex = startRow * columns;
    const endIndex = Math.min(itemCount - 1, (endRow + 1) * columns - 1);
    
    for (let i = startIndex; i <= endIndex; i++) {
      const row = Math.floor(i / columns);
      const col = i % columns;
      items.push({
        index: i,
        row,
        col,
        style: {
          position: 'absolute' as const,
          top: row * itemHeight,
          left: col * itemWidth,
          width: itemWidth,
          height: itemHeight
        }
      });
    }
    return items;
  }, [startRow, endRow, columns, itemWidth, itemHeight, itemCount]);

  // Scroll handler with RAF throttling
  const rafId = useRef<number | null>(null);
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
    }
    rafId.current = requestAnimationFrame(() => {
      setScrollTop((e.target as HTMLDivElement).scrollTop);
    });
  }, []);

  // Scroll to specific index
  const scrollToIndex = useCallback((index: number) => {
    if (containerRef.current) {
      const row = Math.floor(index / columns);
      containerRef.current.scrollTop = row * itemHeight;
    }
  }, [columns, itemHeight]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, []);

  return {
    virtualItems,
    totalHeight,
    startRow,
    endRow,
    scrollToIndex
  };
}

export { useVirtualScroll as default };