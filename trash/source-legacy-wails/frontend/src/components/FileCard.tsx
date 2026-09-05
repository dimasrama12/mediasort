import React, { useState, useEffect, useRef, memo } from 'react';
import { Loader2 } from 'lucide-react';
import { useIntersectionObserver } from '../hooks/useIntersectionObserver';
import { thumbnailQueue } from '../utils/thumbnailQueue';

interface FileItem {
  id: string;
  path: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: string;
  thumbnailUrl: string;
  fileType: string;
  groupId: string;
}

interface FileCardProps {
  file: FileItem;
  index: number;
  isSelected: boolean;
  isFocused: boolean;
  isCut: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  currentView: 'grid' | 'list';
  formatBytes: (bytes: number) => string;
  thumbnailVersion?: number;
}

const FileCard = memo(({
  file,
  index,
  isSelected,
  isFocused,
  isCut,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  currentView,
  formatBytes,
  thumbnailVersion = 0
}: FileCardProps) => {
  const [ref, isVisible] = useIntersectionObserver<HTMLDivElement>({
    threshold: 0.1,
    rootMargin: '200px',
    triggerOnce: true
  });
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const hasFetched = useRef(false);
  const lastVersion = useRef(0);

  // Reset fetch flag when thumbnailVersion changes (image was rotated)
  useEffect(() => {
    if (thumbnailVersion !== lastVersion.current) {
      lastVersion.current = thumbnailVersion;
      hasFetched.current = false;
      setThumbnailUrl(null);
    }
  }, [thumbnailVersion]);

  useEffect(() => {
    if (isVisible && !hasFetched.current && file.fileType === 'image') {
      hasFetched.current = true;
      setLoading(true);

      thumbnailQueue.enqueue(file.path)
        .then(thumb => {
          setThumbnailUrl(thumb);
        })
        .catch(error => {
          console.error('Failed to fetch thumbnail for', file.name, error);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isVisible, file.path, file.name, file.fileType]);

  const getFileIcon = () => {
    switch (file.fileType) {
      case 'video': return '🎬';
      case 'audio': return '🎵';
      case 'document': return '📄';
      case 'code': return '💻';
      case 'archive': return '📦';
      case 'image': return '🖼️';
      default: return '📁';
    }
  };

  return (
    <div
      ref={ref}
      data-file-index={index}
      className={`file-item ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''} ${isCut ? 'cut-item' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseDown={(e) => e.stopPropagation()}
      draggable
      onDragStart={onDragStart}
      title={`${file.name}\n${formatBytes(file.size)} • ${file.fileType}`}
    >
      {currentView === 'list' && (
        <span className="file-index-number">{index + 1}</span>
      )}
      <div className="file-thumbnail">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={file.name}
            className="thumbnail-image"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="file-icon-placeholder">
            {loading ? <Loader2 size={24} className="animate-spin" /> : getFileIcon()}
          </div>
        )}
      </div>
      <div className="file-info">
        <div className="file-name" title={file.name}>
          {file.name.length > 30 ? file.name.substring(0, 30) + '...' : file.name}
        </div>
        <div className="file-meta">
          <span className="file-size">{formatBytes(file.size)}</span>
          <span className="file-type">{file.fileType}</span>
        </div>
      </div>
    </div>
  );
});

FileCard.displayName = 'FileCard';

export default FileCard;