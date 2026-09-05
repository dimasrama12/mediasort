import { useEffect, useRef, useState, useCallback } from 'react';

interface UseIntersectionObserverOptions {
  threshold?: number;
  rootMargin?: string;
  triggerOnce?: boolean;
}

export function useIntersectionObserver<T extends HTMLElement = HTMLDivElement>(
  options: UseIntersectionObserverOptions = {}
): [React.RefObject<T>, boolean] {
  const { threshold = 0.1, rootMargin = '100px', triggerOnce = true } = options;
  const ref = useRef<T>(null);
  const [isIntersecting, setIsIntersecting] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsIntersecting(true);
          if (triggerOnce) {
            observer.unobserve(element);
          }
        } else if (!triggerOnce) {
          setIsIntersecting(false);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);

    return () => {
      observer.unobserve(element);
    };
  }, [threshold, rootMargin, triggerOnce]);

  return [ref as React.RefObject<T>, isIntersecting];
}

// Hook for lazy loading with loading state
interface UseLazyLoadOptions extends UseIntersectionObserverOptions {
  onLoad?: () => void;
}

export function useLazyLoad<T extends HTMLElement = HTMLDivElement>(
  options: UseLazyLoadOptions = {}
): [React.RefObject<T>, boolean, boolean] {
  const { onLoad, ...observerOptions } = options;
  const [ref, isVisible] = useIntersectionObserver<T>(observerOptions);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (isVisible && !hasLoaded) {
      setHasLoaded(true);
      onLoad?.();
    }
  }, [isVisible, hasLoaded, onLoad]);

  return [ref as React.RefObject<T>, isVisible, hasLoaded];
}

// Hook for virtual list item
export function useVirtualItem<T extends HTMLElement = HTMLDivElement>(
  index: number,
  itemHeight: number
): [React.RefObject<T>, React.CSSProperties] {
  const ref = useRef<T>(null);
  const style: React.CSSProperties = {
    position: 'absolute',
    top: index * itemHeight,
    height: itemHeight,
    left: 0,
    right: 0
  };

  return [ref as React.RefObject<T>, style];
}

export default useIntersectionObserver;