// Thumbnail Queue System for Frontend
// Limits concurrent thumbnail requests to prevent overwhelming the backend

interface ThumbnailRequest {
  filePath: string;
  resolve: (url: string) => void;
  reject: (error: Error) => void;
}

class ThumbnailQueue {
  private queue: ThumbnailRequest[] = [];
  private activeRequests = 0;
  private readonly maxConcurrent = 5;
  private readonly cache = new Map<string, string>();
  private readonly pendingRequests = new Map<string, Promise<string>>();

  // Process queue
  private processQueue(): void {
    while (this.activeRequests < this.maxConcurrent && this.queue.length > 0) {
      const request = this.queue.shift();
      if (request) {
        this.processRequest(request);
      }
    }
  }

  // Process single request
  private async processRequest(request: ThumbnailRequest): Promise<void> {
    // Check cache first
    const cached = this.cache.get(request.filePath);
    if (cached) {
      request.resolve(cached);
      return;
    }

    // Check if already pending
    const pending = this.pendingRequests.get(request.filePath);
    if (pending) {
      try {
        const result = await pending;
        request.resolve(result);
      } catch (error) {
        request.reject(error as Error);
      }
      return;
    }

    this.activeRequests++;
    
    try {
      // Dynamic import to avoid circular dependency
      const { GetThumbnail } = await import('../wailsjs/go/main/App');
      
      const thumbnailPromise = GetThumbnail(request.filePath);
      this.pendingRequests.set(request.filePath, thumbnailPromise);
      
      const result = await thumbnailPromise;
      this.cache.set(request.filePath, result);
      request.resolve(result);
    } catch (error) {
      request.reject(error as Error);
    } finally {
      this.activeRequests--;
      this.pendingRequests.delete(request.filePath);
      this.processQueue();
    }
  }

  // Public method to enqueue a thumbnail request
  async enqueue(filePath: string): Promise<string> {
    // Check cache first
    const cached = this.cache.get(filePath);
    if (cached) {
      return cached;
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ filePath, resolve, reject });
      this.processQueue();
    });
  }

  // Clear cache
  clearCache(): void {
    this.cache.clear();
  }

  // Invalidate cache for a specific file
  invalidate(filePath: string): void {
    this.cache.delete(filePath);
  }

  // Get cache size
  getCacheSize(): number {
    return this.cache.size;
  }
}

// Global thumbnail queue instance
export const thumbnailQueue = new ThumbnailQueue();

// Hook for using the thumbnail queue
export function useThumbnailQueue() {
  return thumbnailQueue;
}

export default thumbnailQueue;