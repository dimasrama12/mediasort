import React from 'react';
import FileCard from './FileCard';

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
  dateTaken: string;
}

interface GroupedFiles {
  name: string;
  files: FileItem[];
  count: number;
  thumbnailUrl: string;
}

interface VirtualFileGridProps {
  files: FileItem[];
  groupedFiles: GroupedFiles[] | null;
  displayedFiles: FileItem[];
  currentView: 'grid' | 'list';
  selectedFiles: Set<string>;
  focusedFileIndex: number;
  selectionMode: boolean;
  clipboard: { files: string[]; mode: 'copy' | 'cut' } | null;
  onFileClick: (fileId: string, index: number, e: React.MouseEvent) => void;
  onFileDoubleClick: (file: FileItem) => void;
  onContextMenu: (e: React.MouseEvent, fileId: string) => void;
  onDragStart: (e: React.DragEvent, fileId: string) => void;
  formatBytes: (bytes: number) => string;
  showGroupPreviews?: boolean;
  showDateGroupThumbnails?: boolean;
  groupBy?: 'date' | 'type' | null;
  collapsedGroups?: Set<string>;
  onToggleCollapse?: (groupName: string) => void;
  thumbnailVersion?: number;
}

const VirtualFileGrid: React.FC<VirtualFileGridProps> = ({
  groupedFiles,
  displayedFiles,
  currentView,
  selectedFiles,
  focusedFileIndex,
  selectionMode,
  clipboard,
  onFileClick,
  onFileDoubleClick,
  onContextMenu,
  onDragStart,
  formatBytes,
  showGroupPreviews = true,
  showDateGroupThumbnails = true,
  groupBy,
  collapsedGroups,
  onToggleCollapse,
  thumbnailVersion = 0
}) => {
  if (groupedFiles) {
    // Grouped view
    return (
      <div className={`file-${currentView}`}>
        {groupedFiles.map(group => {
          // Check if we should show thumbnail for this group
          const isDateGrouping = groupBy === 'date';
          const isTypeGrouping = groupBy === 'type';

          let shouldShowThumbnail = showGroupPreviews;
          if (isDateGrouping && !showDateGroupThumbnails) {
            shouldShowThumbnail = false;
          }

          const isCollapsed = collapsedGroups?.has(group.name);

          return (
            <div key={group.name} className="file-group">
              <div
                className="file-group-header"
                onClick={() => onToggleCollapse && onToggleCollapse(group.name)}
                style={{ cursor: 'pointer' }}
              >
                <div className="group-header-left">
                  <div className={`group-toggle-icon ${isCollapsed ? 'collapsed' : ''}`}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </div>

                  {shouldShowThumbnail && group.thumbnailUrl && (
                    <div className="group-thumbnail">
                      <img src={group.thumbnailUrl} alt="" className="group-th-img" />
                    </div>
                  )}
                  <span className="group-name">{group.name}</span>
                  <span className="group-count">({group.count})</span>
                </div>
              </div>

              {!isCollapsed && (
                <div className="files-grid-wrapper">
                  {group.files.map((file) => {
                    const globalIndex = displayedFiles.findIndex(f => f.id === file.id);
                    return (
                      <FileCard
                        key={`${file.id}-${thumbnailVersion}`}
                        file={file}
                        index={globalIndex}
                        isSelected={selectedFiles.has(file.id)}
                        isFocused={focusedFileIndex === globalIndex && selectionMode}
                        isCut={clipboard?.mode === 'cut' && clipboard.files.includes(file.path)}
                        onClick={(e) => onFileClick(file.id, globalIndex, e)}
                        onDoubleClick={() => onFileDoubleClick(file)}
                        onContextMenu={(e) => onContextMenu(e, file.id)}
                        onDragStart={(e) => onDragStart(e, file.id)}
                        currentView={currentView}
                        formatBytes={formatBytes}
                        thumbnailVersion={thumbnailVersion}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Flat view - render all files (performance handled by FileCard)
  return (
    <div className={`file-${currentView}`}>
      {displayedFiles.map((file, index) => (
        <FileCard
          key={`${file.id}-${thumbnailVersion}`}
          file={file}
          index={index}
          isSelected={selectedFiles.has(file.id)}
          isFocused={focusedFileIndex === index && selectionMode}
          isCut={clipboard?.mode === 'cut' && clipboard.files.includes(file.path)}
          onClick={(e) => onFileClick(file.id, index, e)}
          onDoubleClick={() => onFileDoubleClick(file)}
          onContextMenu={(e) => onContextMenu(e, file.id)}
          onDragStart={(e) => onDragStart(e, file.id)}
          currentView={currentView}
          formatBytes={formatBytes}
          thumbnailVersion={thumbnailVersion}
        />
      ))}
    </div>
  );
};

export default VirtualFileGrid;