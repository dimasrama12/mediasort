import { useState, useEffect, useRef, useMemo, useCallback, memo, Fragment } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, Box, Check, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, Clipboard, Clock, Command, Copy, Download, Edit2, Eye, ExternalLink, FileText, Film, Filter, FolderOpen, FolderPlus, Fullscreen, GripVertical, Hash, Image as ImageIcon, Info, LayoutGrid, List, Loader2, LogOut, Maximize, Maximize2, Minimize, Minimize2, Moon, MoreVertical, Move, Music, Plus, Redo, RefreshCw, RotateCcw, RotateCw, Save, Search, Send, Settings, Share2, Shrink, Sparkles, Sun, Trash, Trash2, Undo, Users, X, ZoomIn, ZoomOut
} from 'lucide-react'

import './App.css'
import TrashPanel from './components/TrashPanel'
import ContextMenu from './components/ContextMenu'
import UserGuide from './components/UserGuide'
import {
  SelectFolder, ScanFolder, CreateFolder, MoveFiles, CopyFiles,
  RenameFolder, GetFolderStats, AnalyzeSingleImage, GetSettings,
  SaveSettings, Undo as UndoOperation, Redo as RedoOperation, CanUndo, CanRedo,
  GetFilePreview, GetThumbnail,
  MoveFilesToTrash,
  MoveFolderToTrash,
  GetTrashItems,
  GetTrashStats,
  RestoreFromTrash,
  EmptyTrash,
  PerformUndo,
  PerformRedo,
  ToggleFullscreen,
  MoveFolder,
  CleanupThumbnails,
  RotateImage
} from './wailsjs/go/main/App'
import { classifyImage, CATEGORIES, initAI } from './utils/ai'
import { main } from './wailsjs/go/models'

// Types
interface FileItem {
  id: string
  path: string
  name: string
  extension: string
  size: number
  modifiedAt: string
  thumbnailUrl: string
  fileType: string
  groupId: string
  dateTaken: string
}

interface FolderItem {
  id: string
  name: string
  path: string
  color: string
  shortcut: string
  fileCount: number
  totalSize: number
  hasSubfolders?: boolean
}

interface FileGroup {
  id: string
  name: string
  files: FileItem[]
  similarity: number
  timeSpan: string
  groupType: string
  suggested: boolean
  confidence?: number
}

interface AppSettings {
  similarityThreshold: number
  timeWindowHours: number
  minGroupSize: number
  theme: string
  defaultView: string
  thumbnailSize: number
  sidebarWidth: number
  sidebarCollapsed: boolean
  interfaceFont: string
  showImages: boolean
  showVideos: boolean
  showAudio: boolean
  showDocuments: boolean
  showCode: boolean
  showArchives: boolean
  activeExtensions?: Record<string, boolean>
  geminiApiKey?: string
  cachePath?: string
  autoCleanupThumbnails?: boolean
  showGroupPreviews?: boolean
  showDateGroupThumbnails?: boolean
}



interface UndoOperation {
  type: 'move' | 'trash' | 'create_folder' | 'rename' | 'delete_folder' | 'delete_groups' | 'delete_group' | 'delete_all_groups';
  description: string;
  data: any;
}


// Import translation files
import enTranslations from './locales/en.json'
import idTranslations from './locales/id.json'

const translations = {
  en: enTranslations,
  id: idTranslations
}

// Virtual File Grid Component
import VirtualFileGrid from './components/VirtualFileGrid'

function App() {
  // Language State
  const [language, setLanguage] = useState<'en' | 'id'>('en')

  // Helper for translation - supports nested keys like "buttons.open"
  const t = (key: string): string => {
    const keys = key.split('.')
    let value: any = translations[language]

    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k]
      } else {
        return key // Return key if translation not found
      }
    }

    return typeof value === 'string' ? value : key
  }
  // Core state
  const [currentView, setCurrentView] = useState<'grid' | 'list'>('grid')
  const [files, setFiles] = useState<FileItem[]>([])
  const [subfolders, setSubfolders] = useState<FolderItem[]>([])
  const [projectRoot, setProjectRoot] = useState<string | null>(null)
  const [projectRootSubfolders, setProjectRootSubfolders] = useState<FolderItem[]>([])
  const [projectRootStats, setProjectRootStats] = useState<{ count: number, size: number }>({ count: 0, size: 0 })

  const [displayedFiles, setDisplayedFiles] = useState<FileItem[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [isGrouping, setIsGrouping] = useState(false)
  const [selectedFolders, setSelectedFolders] = useState<string[]>([])
  const selectedFolder = selectedFolders.length > 0 ? selectedFolders[selectedFolders.length - 1] : ''
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [groupSelectionMode, setGroupSelectionMode] = useState(false)
  const [groupFilterQuery, setGroupFilterQuery] = useState('')
  const [showEmptyGroups, setShowEmptyGroups] = useState(true)
  const [isGroupFilterSearchVisible, setIsGroupFilterSearchVisible] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light' | 'green'>('dark')
  const [folderError, setFolderError] = useState<string | null>(null)
  const [groups, setGroups] = useState<FileGroup[]>([])
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [removedFromGroups, setRemovedFromGroups] = useState<Record<string, Set<string>>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [_canUndoState, setCanUndoState] = useState(false)
  const [_canRedoState, setCanRedoState] = useState(false)
  const [trashCount, setTrashCount] = useState(0)
  const [showTrash, setShowTrash] = useState(false)

  // UI state
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false)
  const [showRenameFolderDialog, setShowRenameFolderDialog] = useState(false)
  const [showSettingsPanel, setShowSettingsPanel] = useState(false)
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
  const [previewFileIndex, setPreviewFileIndex] = useState<number>(0)
  const [previewNavigationFiles, setPreviewNavigationFiles] = useState<FileItem[]>([])
  const [previewFitToWindow, setPreviewFitToWindow] = useState(true)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [previewZoom, setPreviewZoom] = useState(90) // Zoom level: 20-200%
  const [previewRotation, setPreviewRotation] = useState(0) // Rotation in degrees
  const [showInfoPanel, setShowInfoPanel] = useState(false)
  const [navArrowsVisible, setNavArrowsVisible] = useState(true)
  const [mouseIdle, setMouseIdle] = useState(false)
  const mouseIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Thumbnail version to force refresh after rotation
  const [thumbnailVersion, setThumbnailVersion] = useState(0)
  // Pan state for grab & drag
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [showBatchRenameDialog, setShowBatchRenameDialog] = useState(false)
  const [showTrashConfirmDialog, setShowTrashConfirmDialog] = useState(false)
  const [groupingProgress, setGroupingProgress] = useState<number>(0)
  const [groupingMessage, setGroupingMessage] = useState<string>('')
  const [groupingStartTime, setGroupingStartTime] = useState<number>(0)
  const [elapsedTime, setElapsedTime] = useState<string>('00:00')
  const [aiProcessingFiles, setAiProcessingFiles] = useState<number>(0)
  const [aiTotalFiles, setAiTotalFiles] = useState<number>(0)
  const [isBackgroundGrouping, setIsBackgroundGrouping] = useState<boolean>(false)
  const [showTrashPanel, setShowTrashPanel] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const [trashItems, setTrashItems] = useState<any[]>([])
  const [classifierReady, setClassifierReady] = useState(false)
  const [aiSkills, setAiSkills] = useState<string[]>([
    "Semantic Grouping: 'Group beach photos together'",
    "Theme Switching: '/theme light'",
    "Navigation: 'Go to trash' or '/trash'",
    "Filtering: 'Show screenshots from today'",
    "Merge: '/merge Group 1 and Group 2'"
  ])

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, fileId: string } | null>(null)

  // Folder Creation/Rename State
  const [externalTargetFolders, setExternalTargetFolders] = useState<FolderItem[]>(() => {
    const saved = localStorage.getItem('externalTargetFolders')
    return saved ? JSON.parse(saved) : []
  })
  useEffect(() => {
    localStorage.setItem('externalTargetFolders', JSON.stringify(externalTargetFolders))
  }, [externalTargetFolders])

  const [draggedExternalIndex, setDraggedExternalIndex] = useState<number | null>(null)
  const [dragOverExternalIndex, setDragOverExternalIndex] = useState<number | null>(null)

  // New UI enhancement state
  const [sidebarWidth, setSidebarWidth] = useState(280)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const toggleFolderExpansion = async (path: string) => {
    const newExpanded = new Set(expandedFolders)
    if (newExpanded.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
      // If we don't have children for this folder yet, fetch them
      if (!folderHierarchy[path]) {
        try {
          const content = await ScanFolder(path)
          setFolderHierarchy(prev => ({
            ...prev,
            [path]: content.subfolders as any
          }))
        } catch (error) {
          console.error('Error scanning nested folder:', error)
        }
      }
    }
    setExpandedFolders(newExpanded)
  }

  // Context menu state
  // This was the old context menu state, now replaced by the one above.
  // const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null)

  // Settings tab state
  const [settingsTab, setSettingsTab] = useState<'general' | 'guide'>('general')

  // Toast notification state
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false })



  const [clipboard, setClipboard] = useState<{ files: string[], mode: 'copy' | 'cut' } | null>(null)

  // Form state
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolder, setRenamingFolder] = useState<FolderItem | null>(null)
  const [batchRenamePattern, setBatchRenamePattern] = useState('')
  const [batchRenameStartNumber, setBatchRenameStartNumber] = useState(1)

  // Navigation state
  const [focusedFileIndex, setFocusedFileIndex] = useState<number>(-1)
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1)
  const [draggedFiles, setDraggedFiles] = useState<string[]>([])

  // Hierarchical Sidebar state
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [folderHierarchy, setFolderHierarchy] = useState<Record<string, FolderItem[]>>({})
  const [customFolderOrder, setCustomFolderOrder] = useState<Record<string, string[]>>({})
  const [draggedFolder, setDraggedFolder] = useState<FolderItem | null>(null)
  const [dragOverFolderPath, setDragOverFolderPath] = useState<string | null>(null)
  const [reorderDropIndex, setReorderDropIndex] = useState<number | null>(null)
  const [reorderDropParent, setReorderDropParent] = useState<string | null>(null)

  const handleFolderDragStart = (e: React.DragEvent, folder: FolderItem) => {
    e.stopPropagation()
    setDraggedFolder(folder)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleFolderDragOver = (e: React.DragEvent, folderPath?: string) => {
    e.preventDefault()
    e.stopPropagation()

    // Detect Alt key for reordering
    if (e.altKey && draggedFolder && folderPath && folderPath !== draggedFolder.path) {
      setDragOverFolderPath(null) // Clear folder drop highlight
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const middle = rect.top + rect.height / 2
      const parentDir = folderPath.substring(0, Math.max(folderPath.lastIndexOf('\\'), folderPath.lastIndexOf('/')))

      setReorderDropParent(parentDir || (projectRoot || ''))

      // If pointer is in top half, we drop before. Bottom half, we drop after.
      const targetFolders = (parentDir === projectRoot || !parentDir) ? projectRootSubfolders : (folderHierarchy[parentDir] || [])
      const targetIdx = targetFolders.findIndex(f => f.path === folderPath)

      if (e.clientY < middle) {
        setReorderDropIndex(targetIdx)
      } else {
        setReorderDropIndex(targetIdx + 1)
      }
      return
    }

    setReorderDropIndex(null)
    setReorderDropParent(null)

    e.dataTransfer.dropEffect = 'move'
    if (folderPath && draggedFolder && draggedFolder.path !== folderPath) {
      setDragOverFolderPath(folderPath)
    }
  }

  const handleFolderDrop = async (e: React.DragEvent, targetParentPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolderPath(null)

    if (e.altKey && draggedFolder && reorderDropParent !== null && reorderDropIndex !== null) {
      // HANDLE REORDER
      const parent = reorderDropParent
      const dropIdx = reorderDropIndex
      const draggedPath = draggedFolder.path

      setCustomFolderOrder(prev => {
        const folders = (parent === projectRoot || !parent) ? projectRootSubfolders : (folderHierarchy[parent] || [])
        let currentOrder = prev[parent] || folders.map(f => f.path)

        // Remove dragged
        const filtered = currentOrder.filter(p => p !== draggedPath)

        // Find if dragged was in this parent
        const wasInParent = currentOrder.includes(draggedPath)

        // Insert at new index
        const nextOrder = [...filtered]
        nextOrder.splice(dropIdx > filtered.length ? filtered.length : dropIdx, 0, draggedPath)

        return { ...prev, [parent]: nextOrder }
      })

      setDraggedFolder(null)
      setReorderDropIndex(null)
      setReorderDropParent(null)
      return
    }

    if (!draggedFolder) {
      // Check if we are dropping files
      const data = e.dataTransfer.getData('application/json')
      if (data) {
        handleDropOnFolder(targetParentPath)
      }
      return
    }

    const sourcePath = draggedFolder.path
    if (sourcePath === targetParentPath || targetParentPath.startsWith(sourcePath)) {
      setDraggedFolder(null)
      return
    }

    try {
      await MoveFolder(sourcePath, targetParentPath)
      showToast(`Moved ${draggedFolder.name} successfully`)

      await refreshFolderStats()

      // If the target parent is expanded, refresh its children
      if (expandedFolders.has(targetParentPath)) {
        const content = await ScanFolder(targetParentPath)
        setFolderHierarchy(prev => ({
          ...prev,
          [targetParentPath]: content.subfolders as any
        }))
      }

      // If the source parent was in hierarchy, refresh it too
      const sourceParent = sourcePath.substring(0, sourcePath.lastIndexOf(sourcePath.includes('\\') ? '\\' : '/'))
      if (expandedFolders.has(sourceParent)) {
        const content = await ScanFolder(sourceParent)
        setFolderHierarchy(prev => ({
          ...prev,
          [sourceParent]: content.subfolders as any
        }))
      }

    } catch (error) {
      console.error('Error moving folder:', error)
      alert('Failed to move folder: ' + error)
    } finally {
      setDraggedFolder(null)
    }
  }

  const handleExternalTargetDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolderPath(null)

    if (!draggedFolder) {
      // Check if we are dropping files
      const data = e.dataTransfer.getData('application/json')
      if (data) {
        const targetFolder = externalTargetFolders.find(f => f.id === targetId)
        if (targetFolder) {
          handleDropOnFolder(targetFolder.path)
        }
      }
      return
    }

    const isDraggedExternal = externalTargetFolders.some(f => f.path === draggedFolder.path)
    const targetFolder = externalTargetFolders.find(f => f.id === targetId)
    const isTargetExternal = !!targetFolder

    if (isDraggedExternal && isTargetExternal) {
      // Strictly REORDER logic for external-to-external drag
      setExternalTargetFolders(prev => {
        const draggedIdx = prev.findIndex(f => f.path === draggedFolder.path)
        const targetIdx = prev.findIndex(f => f.id === targetId)
        if (draggedIdx === -1 || targetIdx === -1) return prev

        const next = [...prev]
        const [removed] = next.splice(draggedIdx, 1)
        next.splice(targetIdx, 0, removed)
        return next
      })
      setDraggedFolder(null)
    } else if (targetFolder) {
      // Move logic (internal to external, or vice-versa)
      await handleFolderDrop(e, targetFolder.path)
    }
  }

  const renderFolderTree = (treeFolders: FolderItem[], level: number = 0, parentPath: string = projectRoot || '') => {
    const order = customFolderOrder[parentPath]
    const sortedFolders = order
      ? [...treeFolders].sort((a, b) => {
        const idxA = order.indexOf(a.path)
        const idxB = order.indexOf(b.path)
        if (idxA === -1 && idxB === -1) return 0
        if (idxA === -1) return 1
        if (idxB === -1) return -1
        return idxA - idxB
      })
      : treeFolders

    return sortedFolders.map((folder, index) => {
      const isExpanded = expandedFolders.has(folder.path)
      const children = folderHierarchy[folder.path] || []
      const isSelected = selectedFolders.includes(folder.path)
      const isDragOver = dragOverFolderPath === folder.path

      const globalIndex = visibleSubfolders.findIndex(s => s.path === folder.path)
      const showShortcut = globalIndex !== -1 && globalIndex < 9

      const isReorderTarget = reorderDropParent === parentPath && reorderDropIndex === index
      const isLastReorderTarget = reorderDropParent === parentPath && reorderDropIndex === sortedFolders.length && index === sortedFolders.length - 1

      return (
        <Fragment key={folder.id}>
          {isReorderTarget && (
            <div
              className="reorder-indicator"
              style={{ marginLeft: `${sidebarCollapsed ? 0 : (12 + level * 16)}px` }}
            />
          )}
          <div className="folder-tree-node">
            <div
              className={`folder-item subfolder-item folder-drop-zone ${isSelected ? 'active' : ''} ${isDragOver ? 'drag-over' : ''}`}
              style={{ paddingLeft: `${sidebarCollapsed ? 0 : (12 + level * 16)}px` }}
              onClick={(e) => handleSubfolderClick(folder.path, e)}
              draggable
              onDragStart={(e) => handleFolderDragStart(e, folder as any)}
              onDragOver={(e) => handleFolderDragOver(e, folder.path)}
              onDragLeave={() => {
                setDragOverFolderPath(null)
                setReorderDropIndex(null)
                setReorderDropParent(null)
              }}
              onDrop={(e) => handleFolderDrop(e, folder.path)}
            >
              {!sidebarCollapsed && (
                <div className="folder-tree-toggle" onClick={(e) => {
                  e.stopPropagation()
                  if (folder.hasSubfolders) {
                    toggleFolderExpansion(folder.path)
                  }
                }}>
                  {folder.hasSubfolders ? (
                    isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                  ) : (
                    <div style={{ width: 14 }} />
                  )}
                </div>
              )}
              {showShortcut ? (
                <div className="subfolder-shortcut-badge tree-shortcut">{globalIndex + 1}</div>
              ) : (
                <span className="folder-icon">📁</span>
              )}
              {!sidebarCollapsed && (
                <>
                  <div className="subfolder-info">
                    <span className="folder-name">{folder.name}</span>
                    <div className="subfolder-metadata">
                      <span className="folder-size">{formatBytes(folder.totalSize)}</span>
                      <span className="folder-divider-dot">•</span>
                      <span className="folder-count-text">{folder.fileCount} files</span>
                    </div>
                  </div>

                  <div className="folder-actions">
                    <button
                      className="btn-icon btn-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRenamingFolder(folder)
                        setNewFolderName(folder.name)
                        setShowRenameFolderDialog(true)
                      }}
                      title="Rename folder"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button
                      className="btn-icon btn-xs text-danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteFolder(folder)
                      }}
                      title="Delete folder"
                    >
                      <Trash size={12} />
                    </button>
                  </div>
                </>
              )}
            </div>

            {!sidebarCollapsed && isExpanded && (
              <div className="folder-tree-children">
                {children.length > 0 ? (
                  renderFolderTree(children, level + 1, folder.path)
                ) : folder.hasSubfolders ? (
                  <div className="folder-tree-loading" style={{ paddingLeft: `${12 + (level + 1) * 16}px` }}>
                    <Loader2 size={12} className="animate-spin" />
                    <span>Loading...</span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          {isLastReorderTarget && (
            <div
              className="reorder-indicator"
              style={{ marginLeft: `${sidebarCollapsed ? 0 : (12 + level * 16)}px` }}
            />
          )}
        </Fragment>
      )
    })
  }

  // folderOrder replaced by purely manual externalTargetFolders

  // Settings state
  const [settings, setSettings] = useState<AppSettings>({
    similarityThreshold: 80,
    timeWindowHours: 24,
    minGroupSize: 2,
    theme: 'dark',
    defaultView: 'grid',
    thumbnailSize: 200,
    sidebarWidth: 280,
    sidebarCollapsed: false,
    interfaceFont: 'system',
    showImages: true,
    showVideos: true,
    showAudio: true,
    showDocuments: true,
    showCode: true,
    showArchives: true,
    activeExtensions: {
      'JPG': true, 'PNG': true, 'HEIC': true, 'GIF': true,
      'MP4': true, 'MOV': true, 'MKV': true,
      'MP3': true, 'WAV': true,
      'PDF': true, 'TXT': true, 'DOC': true,
      'JS': true, 'PY': true, 'GO': true,
      zip: true, rar: true
    },
    autoCleanupThumbnails: true,
    showGroupPreviews: true,
    showDateGroupThumbnails: true
  })



  // Filter and Sort state
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'type' | 'size' | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [groupBy, setGroupBy] = useState<'date' | 'type' | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const filterMenuRef = useRef<HTMLDivElement>(null)

  // Undo/Redo stacks
  const [undoStack, setUndoStack] = useState<UndoOperation[]>([])
  const [redoStack, setRedoStack] = useState<UndoOperation[]>([])

  // Manual target folders for sorting/navigation
  // Visible folders in order for 1-9 shortcuts
  const visibleSubfolders = useMemo(() => {
    const result: FolderItem[] = []

    const getSorted = (folders: FolderItem[], parentPath: string) => {
      const order = customFolderOrder[parentPath]
      if (!order) return folders
      return [...folders].sort((a, b) => {
        const idxA = order.indexOf(a.path)
        const idxB = order.indexOf(b.path)
        if (idxA === -1 && idxB === -1) return 0
        if (idxA === -1) return 1
        if (idxB === -1) return -1
        return idxA - idxB
      })
    }

    const traverse = (folders: FolderItem[], parentPath: string) => {
      const sorted = getSorted(folders, parentPath)
      sorted.forEach(folder => {
        result.push(folder)
        if (expandedFolders.has(folder.path) && folderHierarchy[folder.path]) {
          traverse(folderHierarchy[folder.path], folder.path)
        }
      })
    }

    // Include project subfolders
    traverse(projectRootSubfolders, projectRoot || '')

    // Include external targets (filtered)
    const rootPath = projectRoot || ''
    const actualExternal = externalTargetFolders.filter(f => !f.path.startsWith(rootPath))
    result.push(...actualExternal)

    return result
  }, [projectRootSubfolders, folderHierarchy, expandedFolders, externalTargetFolders, projectRoot, customFolderOrder])

  const allSubfolders = useMemo(() => {
    return visibleSubfolders
  }, [visibleSubfolders])

  // Flattened list of all known folders (for stats and searches)
  const allKnownFolders = useMemo(() => {
    const flat: FolderItem[] = [...allSubfolders]
    Object.values(folderHierarchy).forEach(list => {
      list.forEach(f => {
        if (!flat.some(item => item.path === f.path)) {
          flat.push(f as any)
        }
      })
    })
    return flat
  }, [allSubfolders, folderHierarchy])

  const selectedFolderStats = useMemo(() => {
    if (selectedFolders.length === 0) return null
    if (selectedGroups.size > 0) return null

    const stats = allKnownFolders
      .filter(f => selectedFolders.includes(f.path))
      .reduce((acc, f) => ({
        count: acc.count + f.fileCount,
        size: acc.size + f.totalSize
      }), { count: 0, size: 0 })

    return stats.count > 0 || stats.size > 0 ? stats : (projectRoot === selectedFolders[0] ? projectRootStats : null)
  }, [selectedFolders, allKnownFolders, projectRoot, projectRootStats, selectedGroups.size])

  const previewFolderOptions = useMemo(() => {
    const options: { id: string, name: string, path: string }[] = [];

    // If we are not in the root folder, add "All Files" as the first option
    if (projectRoot && selectedFolder !== projectRoot) {
      options.push({
        id: 'root-folder',
        name: 'All Files',
        path: projectRoot
      });
    }

    // Use all available target folders (scanned subfolders + external ones)
    const targets = allSubfolders.filter(f => f.path !== selectedFolder);
    options.push(...targets.map(f => ({
      id: f.id,
      name: f.name,
      path: f.path
    })));

    return options.slice(0, 9); // Support shortcuts 1-9
  }, [projectRoot, allSubfolders, selectedFolder]);

  // Calculate total files in selected groups
  const selectedGroupsTotalFiles = useMemo(() => {
    if (selectedGroups.size === 0) return 0
    let total = 0
    groups.forEach(g => {
      if (selectedGroups.has(g.id)) {
        total += g.files.length
      }
    })
    return total
  }, [selectedGroups, groups])

  const fileGridRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  // Apply font dynamically when settings change
  useEffect(() => {
    document.documentElement.setAttribute('data-font', settings.interfaceFont || 'system')
  }, [settings.interfaceFont])

  // Helper function to format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 10) / 10 + ' ' + sizes[i]
  }

  // Initialize app
  useEffect(() => {
    loadSettings()
    updateUndoRedoState()
  }, [])

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Apply font preference
  useEffect(() => {
    const font = settings.interfaceFont || 'system'
    document.documentElement.setAttribute('data-font', font)
  }, [settings.interfaceFont])

  // Filter files based on search and group
  useEffect(() => {
    let filtered = files

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(f =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    // Apply AI groups filter
    if (selectedGroups.size > 0) {
      const selectedGroupFileIds = new Set<string>()
      groups
        .filter(g => selectedGroups.has(g.id))
        .forEach(group => {
          const rejectedIds = removedFromGroups[group.id] || new Set()
          group.files.forEach(f => {
            if (!rejectedIds.has(f.id)) {
              selectedGroupFileIds.add(f.id)
            }
          })
        })
      filtered = filtered.filter(f => selectedGroupFileIds.has(f.id))
    }

    // Apply sorting
    if (sortBy) {
      filtered = [...filtered].sort((a, b) => {
        let comparison = 0

        switch (sortBy) {
          case 'name':
            comparison = a.name.localeCompare(b.name)
            break
          case 'date':
            comparison = new Date(a.modifiedAt || 0).getTime() - new Date(b.modifiedAt || 0).getTime()
            break
          case 'type':
            const extA = a.name.split('.').pop()?.toLowerCase() || ''
            const extB = b.name.split('.').pop()?.toLowerCase() || ''
            comparison = extA.localeCompare(extB)
            break
          case 'size':
            comparison = a.size - b.size
            break
        }

        return sortOrder === 'asc' ? comparison : -comparison
      })
    }

    setDisplayedFiles(filtered)
  }, [files, searchQuery, groups, selectedGroups, removedFromGroups, sortBy, sortOrder])

  // Group files by date or type (Explorer-style)
  const groupedFiles = useMemo(() => {
    if (!groupBy) return null

    const groups: { [key: string]: { files: FileItem[], date?: Date } } = {}

    displayedFiles.forEach(file => {
      let groupKey = ''
      let sortDate: Date | undefined

      if (groupBy === 'date') {
        const fileDate = new Date(file.dateTaken || file.modifiedAt)
        sortDate = fileDate

        // Format: DD MMM YYYY (e.g., 18 FEB 2026)
        const day = fileDate.getDate().toString().padStart(2, '0')
        const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
        const month = monthNames[fileDate.getMonth()]
        const year = fileDate.getFullYear()

        groupKey = `${day} ${month} ${year}`
      } else if (groupBy === 'type') {
        const ext = file.extension.toUpperCase().replace('.', '')
        groupKey = ext || 'Unknown'
      }

      if (!groups[groupKey]) {
        groups[groupKey] = { files: [], date: sortDate }
      }
      groups[groupKey].files.push(file)
    })

    // Sort groups
    const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
      if (groupBy === 'date') {
        // Sort dates descending (newest first)
        const dateA = groups[a].date?.getTime() || 0
        const dateB = groups[b].date?.getTime() || 0
        return dateB - dateA
      }
      return a.localeCompare(b)
    })

    return sortedGroupKeys.map(key => ({
      name: key,
      files: groups[key].files,
      count: groups[key].files.length,
      thumbnailUrl: groups[key].files[0]?.thumbnailUrl || ''
    }))
  }, [displayedFiles, groupBy])

  // Toggle group collapse
  const toggleGroupCollapse = (groupName: string) => {
    setCollapsedGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(groupName)) {
        newSet.delete(groupName)
      } else {
        newSet.add(groupName)
      }
      return newSet
    })
  }

  // Merged preview logic: Scan all selected folders and merge files
  useEffect(() => {
    if (selectedFolders.length === 0) {
      if (!projectRoot) {
        setFiles([])
        setSubfolders([])
      }
      return
    }

    const loadMergedFiles = async () => {
      try {
        setIsScanning(true)
        const allFiles: FileItem[] = []
        let primarySubfolders: FolderItem[] = []

        // Scan all folders in parallel
        const scanPromises = selectedFolders.map(path => ScanFolder(path))
        const results = await Promise.all(scanPromises)

        results.forEach((content, index) => {
          allFiles.push(...(content.files as any))
          // Only take subfolders from the "active" (last selected) folder
          if (selectedFolders[index] === selectedFolder) {
            primarySubfolders = content.subfolders as any
          }
        })

        // Deduplicate files by ID (path) just in case
        const uniqueFilesMap = new Map()
        allFiles.forEach(f => uniqueFilesMap.set(f.id, f))

        setFiles(Array.from(uniqueFilesMap.values()))
        setSubfolders(primarySubfolders)
      } catch (error) {
        console.error('Error scanning multi-folders:', error)
      } finally {
        setIsScanning(false)
      }
    }

    loadMergedFiles()
  }, [selectedFolders, projectRoot])

  // Close filter dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
        setShowFilterMenu(false)
      }
    }

    if (showFilterMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showFilterMenu])

  // Load settings from backend
  const loadSettings = async () => {
    try {
      const loadedSettings = await GetSettings()
      // Merge with defaults to ensure activeExtensions exists
      const mergedSettings: AppSettings = {
        ...loadedSettings,
        activeExtensions: {
          'JPG': true, 'PNG': true, 'HEIC': true, 'GIF': true,
          'MP4': true, 'MOV': true, 'MKV': true,
          'MP3': true, 'WAV': true,
          'PDF': true, 'TXT': true, 'DOC': true,
          'JS': true, 'PY': true, 'GO': true,
          'ZIP': true, 'RAR': true
        }
      } as AppSettings

      setTheme(mergedSettings.theme as 'dark' | 'light' | 'green')
      setCurrentView(mergedSettings.defaultView as 'grid' | 'list')
      setSettings(mergedSettings)
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  // Load settings on startup
  useEffect(() => {
    loadSettings()
  }, [])

  // Save settings to backend
  const handleSaveSettings = async () => {
    try {
      // Cast to any to avoid type mismatch with backend struct which lacks activeExtensions
      await SaveSettings(settings as any)
      setShowSettingsPanel(false)
    } catch (error) {
      console.error('Failed to save settings:', error)
      alert('Failed to save settings')
    }
  }



  // Update undo/redo state
  const updateUndoRedoState = async () => {
    try {
      const canUndoResult = await CanUndo()
      const canRedoResult = await CanRedo()
      setCanUndoState(canUndoResult)
      setCanRedoState(canRedoResult)
    } catch (error) {
      console.error('Failed to check undo/redo state:', error)
    }
  }

  // Record operation for undo/redo tracking
  const recordOperation = (operation: UndoOperation) => {
    setUndoStack(prev => {
      const newStack = [...prev, operation]
      return newStack.length > 20 ? newStack.slice(-20) : newStack
    })
    setRedoStack([])
  }

  // Handle undo
  const handleUndo = async () => {
    if (undoStack.length === 0) return

    try {
      const operation = undoStack[undoStack.length - 1]

      // Map frontend operation to backend Operation struct
      const backendOp = {
        type: operation.type,
        timestamp: Math.floor(Date.now() / 1000),
        payload: {
          sourcePaths: operation.data.files || (operation.data.oldPath ? [operation.data.oldPath] : []),
          destinationPath: operation.data.destination || operation.data.newPath || '',
          folderPath: operation.data.folderPath || '',
          oldName: operation.data.oldName,
          newName: operation.data.newName,
          trashItems: operation.data.trashItems
        }
      }

      setUndoStack(prev => prev.slice(0, -1))
      setRedoStack(prev => {
        const newStack = [...prev, operation]
        return newStack.length > 20 ? newStack.slice(-20) : newStack
      })

      await PerformUndo(backendOp as any)

      if (selectedFolder) {
        const content = await ScanFolder(selectedFolder)
        setFiles(content.files as any)
        setSubfolders(content.subfolders as any)
      }
      await updateUndoRedoState()
      await refreshFolderStats()
      showToast(`Undone: ${operation.description}`)
    } catch (error) {
      console.error('Undo failed:', error)
      alert('Cannot undo: ' + error)
    }
  }

  // Handle redo
  const handleRedo = async () => {
    if (redoStack.length === 0) return

    try {
      const operation = redoStack[redoStack.length - 1]

      // Map frontend operation to backend Operation struct
      const backendOp = {
        type: operation.type,
        timestamp: Math.floor(Date.now() / 1000),
        payload: {
          sourcePaths: operation.data.files || (operation.data.oldPath ? [operation.data.oldPath] : []),
          destinationPath: operation.data.destination || operation.data.newPath || '',
          folderPath: operation.data.folderPath || '',
          oldName: operation.data.oldName,
          newName: operation.data.newName,
          trashItems: operation.data.trashItems
        }
      }

      setRedoStack(prev => prev.slice(0, -1))
      setUndoStack(prev => {
        const newStack = [...prev, operation]
        return newStack.length > 20 ? newStack.slice(-20) : newStack
      })

      await PerformRedo(backendOp as any)

      if (selectedFolder) {
        const content = await ScanFolder(selectedFolder)
        setFiles(content.files as any)
        setSubfolders(content.subfolders as any)
      }
      await updateUndoRedoState()
      await refreshFolderStats()
      showToast(`Redone: ${operation.description}`)
    } catch (error) {
      console.error('Redo failed:', error)
      alert('Cannot redo: ' + error)
    }
  }

  // Toast notification helper
  const showToast = (message: string, duration: number = 3000) => {
    setToast({ message, visible: true })
    setTimeout(() => {
      setToast(prev => ({ ...prev, visible: false }))
    }, duration)
  }

  const handleSelectAll = () => {
    const allIds = displayedFiles.map(f => f.id)
    setSelectedFiles(new Set(allIds))
  }

  const handleCopyAll = () => {
    const allPaths = displayedFiles.map(f => f.path)
    if (allPaths.length > 0) {
      setClipboard({ files: allPaths, mode: 'copy' })
      showToast(`Copied all ${allPaths.length} items`)
    }
  }

  const handleDeleteAll = async () => {
    if (displayedFiles.length === 0) return

    // Only confirm if we are in the main folder (projectRoot)
    if (selectedFolder === projectRoot) {
      const confirmDelete = confirm(`Move all ${displayedFiles.length} item(s) to trash?`)
      if (!confirmDelete) return
    }

    const allPaths = displayedFiles.map(f => f.path)
    try {
      const trashItems = await MoveFilesToTrash(allPaths)

      const operation: UndoOperation = {
        type: 'trash',
        description: `Moved ${allPaths.length} items to trash`,
        data: { files: allPaths, trashItems: trashItems }
      }
      recordOperation(operation)

      setFiles(files.filter(f => !allPaths.includes(f.path)))
      setSelectedFiles(new Set())
      setTrashCount(prev => prev + allPaths.length)

      // Only show toast if we were in the main folder (where we had a confirmation)
      if (selectedFolder === projectRoot) {
        showToast(`Moved ${allPaths.length} items to trash`)
      }
    } catch (error) {
      console.error('Delete all failed:', error)
      showToast('Failed to delete items')
    }
  }

  const handleRestoreAllTrash = async () => {
    let itemsToRestore = trashItems

    // If trashItems is empty, try to fetch them from backend (allows global shortcut to work without opening drawer)
    if (itemsToRestore.length === 0) {
      try {
        itemsToRestore = await GetTrashItems()
      } catch (err) {
        console.error('Failed to fetch trash items for global restore:', err)
        showToast('Failed to fetch items from trash')
        return
      }
    }

    if (itemsToRestore.length === 0) {
      showToast('Trash is empty')
      return
    }

    try {
      for (const item of itemsToRestore) {
        await RestoreFromTrash(item.id, item.originalPath)
      }
      setTrashItems([])
      setTrashCount(0)
      showToast('Restored all items from trash')
      // Refresh current folder in case some files were restored here
      if (selectedFolder) {
        const content = await ScanFolder(selectedFolder)
        setFiles(content.files as any)
      }
      await refreshFolderStats()
    } catch (error) {
      console.error('Restore all failed:', error)
      showToast('Failed to restore some items')
    }
  }

  const handlePaste = async () => {
    if (!clipboard || !selectedFolder) return

    try {
      if (clipboard.mode === 'copy') {
        await CopyFiles(clipboard.files, selectedFolder)
        showToast(`Pasted ${clipboard.files.length} item(s)`)
      } else {
        await MoveFiles(clipboard.files, selectedFolder)
        setClipboard(null) // Clear clipboard after cut
        showToast(`Moved ${clipboard.files.length} item(s)`)
      }

      // Refresh UI
      const content = await ScanFolder(selectedFolder)
      setFiles(content.files as any)
      setSubfolders(content.subfolders as any)
      await refreshFolderStats()
    } catch (error) {
      console.error('Paste failed:', error)
      showToast('Failed to paste items')
    }
  }

  // Handle subfolder navigation
  const handleSubfolderClick = async (folderPath: string, e?: React.MouseEvent) => {
    if (e) {
      if (e.ctrlKey || e.metaKey) {
        // Toggle selection
        setSelectedFolders(prev => {
          if (prev.includes(folderPath)) {
            return prev.filter(p => p !== folderPath)
          } else {
            return [...prev, folderPath]
          }
        })
      } else if (e.shiftKey && selectedFolders.length > 0) {
        // Range selection
        const paths = allSubfolders.map(s => s.path)
        const lastIdx = paths.indexOf(selectedFolders[selectedFolders.length - 1])
        const currentIdx = paths.indexOf(folderPath)

        if (lastIdx !== -1 && currentIdx !== -1) {
          const start = Math.min(lastIdx, currentIdx)
          const end = Math.max(lastIdx, currentIdx)
          const range = paths.slice(start, end + 1)
          setSelectedFolders(Array.from(new Set([...selectedFolders, ...range])))
        } else {
          setSelectedFolders([folderPath])
        }
      } else {
        setSelectedFolders([folderPath])
      }
    } else {
      setSelectedFolders([folderPath])
    }

    // Clear selection of files when changing folder context
    setSelectedFiles(new Set())
    setSelectedGroups(new Set())
  }

  const handleGoUp = () => {
    if (!selectedFolder) return
    const parentPath = selectedFolder.substring(0, Math.max(selectedFolder.lastIndexOf('\\'), selectedFolder.lastIndexOf('/')))
    if (parentPath) {
      handleSubfolderClick(parentPath)
    }
  }

  // Refresh folder stats
  const refreshFolderStats = async () => {
    const currentExternal = [...externalTargetFolders];
    const currentProjectRoot = projectRoot;

    // 2. Perform async work

    const externalResults = await Promise.all(
      currentExternal.map(async (folder) => {
        try {
          const stats = await GetFolderStats(folder.path)
          return { id: folder.id, stats }
        } catch (error) {
          return { id: folder.id, stats: null }
        }
      })
    )

    // 3. Apply updates using functional state to avoid stomping on renames/deletes

    setExternalTargetFolders(prev => prev.map(f => {
      const res = externalResults.find(r => r.id === f.id);
      return (res && res.stats) ? { ...f, fileCount: res.stats.fileCount, totalSize: res.stats.totalSize } : f;
    }));

    // Refresh project root subfolders stats
    if (currentProjectRoot) {
      try {
        const content = await ScanFolder(currentProjectRoot)
        setProjectRootSubfolders(content.subfolders as any)

        const stats = await GetFolderStats(currentProjectRoot)
        setProjectRootStats({ count: stats.fileCount, size: stats.totalSize })
      } catch (error) {
        console.error('Error refreshing project root stats:', error)
      }
    }

    // Refresh all expanded/loaded subfolders in the hierarchy
    const hierarchyPaths = Object.keys(folderHierarchy);
    if (hierarchyPaths.length > 0) {
      const hierarchyUpdates: Record<string, FolderItem[]> = {};

      await Promise.all(hierarchyPaths.map(async (path) => {
        try {
          const content = await ScanFolder(path);
          hierarchyUpdates[path] = content.subfolders as any;
        } catch (error) {
          console.error(`Error refreshing hierarchy for ${path}:`, error);
        }
      }));

      setFolderHierarchy(prev => ({
        ...prev,
        ...hierarchyUpdates
      }));
    }

    // Update trash count
    try {
      const trashStats = await GetTrashStats()
      setTrashCount(typeof trashStats === 'number' ? trashStats : trashStats.count)
    } catch (error) {
      console.error('Error updating trash count:', error)
    }
  }

  // Automatic subfolder order disabled for manual sidebar model
  /*
  useEffect(() => {
    if (projectRootSubfolders.length > 0) {
      ...
    }
  }, [projectRootSubfolders])
  */

  // Aggregate file fetching effect
  useEffect(() => {
    const fetchAggregateFiles = async () => {
      if (selectedFolders.length === 0) {
        setFiles([])
        return
      }

      try {
        setIsScanning(true)
        const allFiles: FileItem[] = []
        for (const path of selectedFolders) {
          const content = await ScanFolder(path)
          allFiles.push(...(content.files as any))

          // Special case: if it's the root path, update root subfolders too
          if (path === projectRoot && selectedFolders.length === 1) {
            setProjectRootSubfolders(content.subfolders as any)
          }
        }
        setFiles(allFiles)
      } catch (error) {
        console.error('Error fetching aggregate files:', error)
      } finally {
        setIsScanning(false)
      }
    }

    fetchAggregateFiles()
  }, [selectedFolders, projectRoot])

  // Real-time sidebar sync polling
  useEffect(() => {
    if (!projectRoot && externalTargetFolders.length === 0) return

    const interval = setInterval(() => {
      refreshFolderStats()
    }, 2000)

    return () => clearInterval(interval)
  }, [projectRoot, externalTargetFolders.length])

  // New UI handler functions
  const handleQuitApplication = async () => {
    try {
      const { QuitApplication } = await import('./wailsjs/go/main/App')
      await QuitApplication()
    } catch (error) {
      console.error('Failed to quit application:', error)
    }
  }

  const handleZoomIn = () => {
    setSettings(prev => ({
      ...prev,
      thumbnailSize: Math.min(prev.thumbnailSize + 20, 400)
    }))
  }

  const handleZoomOut = () => {
    setSettings(prev => ({
      ...prev,
      thumbnailSize: Math.max(prev.thumbnailSize - 20, 100)
    }))
  }

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => !prev)
    setSettings(prev => ({
      ...prev,
      sidebarCollapsed: !prev.sidebarCollapsed
    }))
  }

  // Resizable sidebar handlers
  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }

  const stopResizing = () => {
    setIsResizing(false)
  }

  const resize = (e: MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX
      if (newWidth > 150 && newWidth < 600) {
        setSidebarWidth(newWidth)
        setSettings(prev => ({ ...prev, sidebarWidth: newWidth }))
      }
    }
  }

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize)
      window.addEventListener('mouseup', stopResizing)
    } else {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
    return () => {
      window.removeEventListener('mousemove', resize)
      window.removeEventListener('mouseup', stopResizing)
    }
  }, [isResizing])

  // Timer effect for AI Grouping elapsed time
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null

    if (isGrouping && groupingStartTime > 0) {
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - groupingStartTime) / 1000)
        const minutes = Math.floor(elapsed / 60)
        const seconds = elapsed % 60
        setElapsedTime(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`)
      }, 1000)
    } else {
      setElapsedTime('00:00')
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isGrouping, groupingStartTime])

  // Cleanup thumbnails on application close
  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (settings.autoCleanupThumbnails !== false) {
        try {
          await CleanupThumbnails()
          console.log('[Cleanup] Thumbnails cleaned up on exit')
        } catch (err) {
          console.error('[Cleanup] Failed to clean up thumbnails:', err)
        }
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [settings.autoCleanupThumbnails])

  const handleOpenTrash = async () => {
    setShowTrashPanel(true)
    try {
      const items = await GetTrashItems()
      setTrashItems(items as any)
    } catch (error) {
      console.error('Failed to load trash:', error)
      showToast('Failed to load trash items')
    }
  }

  const handleRestoreFromTrash = async (trashID: string, originalPath: string) => {
    try {
      await RestoreFromTrash(trashID, originalPath)

      // 1. Refresh trash items in the panel
      const items = await GetTrashItems()
      setTrashItems(items || [])

      // 2. Refresh global trash count
      const stats = await GetTrashStats()
      setTrashCount(stats ? (typeof stats === 'number' ? stats : stats.count) : 0)

      // 3. Refresh current folder grid immediately if active
      if (selectedFolder) {
        const content = await ScanFolder(selectedFolder)
        setFiles(content.files as any)
        setSubfolders(content.subfolders as any)
      }

      // 4. Update sidebar/shortcut stats
      await refreshFolderStats()

      // showToast('Item restored successfully') // Silenced as per user request
    } catch (error) {
      console.error('Failed to restore item:', error)
      showToast('Failed to restore item')
    }
  }

  const handleEmptyTrash = async () => {
    try {
      await EmptyTrash()
      setTrashItems([])
      setTrashCount(0)
      setShowTrashPanel(false)
      // showToast('Trash emptied successfully') // Silenced as per user request
    } catch (error) {
      console.error('Failed to empty trash:', error)
      showToast('Failed to empty trash')
    }
  }

  const handleMoveFilesToTrash = async () => {
    if (selectedFiles.size === 0) return

    const filePaths = files
      .filter(f => selectedFiles.has(f.id))
      .map(f => f.path)

    try {
      await MoveFilesToTrash(filePaths)

      // Remove files from current view
      setFiles(files.filter(f => !selectedFiles.has(f.id)))
      setSelectedFiles(new Set())

      // Refresh folder stats and trash count
      await refreshFolderStats()

      // showToast(`Moved ${filePaths.length} file(s) to trash`) // Silenced as per user request
    } catch (error) {
      console.error('Failed to move files to trash:', error)
      showToast('Failed to move files to trash')
    }
  }

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent, fileId: string) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      fileId
    })
  }

  const handleContextAction = async (action: string) => {
    if (!contextMenu) return
    const file = files.find(f => f.id === contextMenu.fileId)
    if (!file) return

    switch (action) {
      case 'rename':
        setShowBatchRenameDialog(true) // Should technically be single rename, but batch uses selection
        // Logic to ensure selection includes this file
        if (!selectedFiles.has(file.id)) {
          setSelectedFiles(new Set([file.id]))
        }
        setBatchRenamePattern('') // Let user type new name
        // Or trigger specific single rename dialog if preferred, but batch is fine
        // Using batch dialog logic for now as simplified rename
        break
      case 'move':
        // Trigger move logic - usually done via drag/drop or shortcuts 1-9
        // Could open a "Move to..." dialog, but for now we'll just focus it
        // Maybe unimplemented prompt?
        alert('Please use drag and drop or keys 1-9 to move files.')
        break
      case 'copy-path':
        navigator.clipboard.writeText(file.path)
        showToast('Path copied to clipboard')
        break
      case 'delete':
        try {
          await MoveFilesToTrash([file.path])
          // Refresh
          if (selectedFolder) {
            const content = await ScanFolder(selectedFolder)
            setFiles(content.files as any)
          }
          await refreshFolderStats()
          showToast(`Moved '${file.name}' to trash`)
        } catch (e) {
          console.error('Failed to move file to trash:', e)
          showToast('Failed to move file to trash')
        }
        break
    }
    setContextMenu(null)
  }

  // Clear all selections
  const clearSelections = () => {
    setSelectedFiles(new Set())
    setSelectionMode(false)
    setSelectedGroups(new Set())
    setShowTrashPanel(false)
    setContextMenu(null)
  }

  // Handle click outside to close context menu
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null)
    window.addEventListener('click', handleClickOutside)
    return () => window.removeEventListener('click', handleClickOutside)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
        if (e.key === 'Escape') {
          setShowNewFolderDialog(false)
          setShowRenameFolderDialog(false)
          setShowSettingsPanel(false)
          setShowPreviewModal(false)
          setShowBatchRenameDialog(false)
          setShowTrashConfirmDialog(false)
        }
        return
      }

      // Alt+X - Quit application (Global)
      if (e.altKey && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault()
        handleQuitApplication()
        return
      }

      // T key - Toggle trash panel (explicitly not Shift+T)
      if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        if (showTrashPanel) {
          setShowTrashPanel(false)
        } else {
          handleOpenTrash()
        }
        return
      }

      // Preview mode shortcuts
      if (showPreviewModal && previewFile) {
        if (e.key === 'Escape') {
          e.preventDefault()
          closePreview()
          return
        }
        if (e.code === 'Space') {
          e.preventDefault()
          setShowInfoPanel(prev => !prev)
          return
        }

        // V key: Fit to window/Actual size toggle
        if (e.key === 'v' || e.key === 'V') {
          e.preventDefault()
          setPreviewFitToWindow(prev => !prev)
          return
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          navigatePreview(-1)
          return
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          navigatePreview(1)
          return
        }
        // One-Key Sorting: 1-9 keys move image to corresponding quick sort option
        if (/^[1-9]$/.test(e.key) && previewFolderOptions.length >= parseInt(e.key)) {
          e.preventDefault()
          const index = parseInt(e.key) - 1
          moveCurrentPreviewFileToFolder(previewFolderOptions[index].path)
          return
        }
        // Jump keys: 5=first, 6=25%, 7=50%, 8=75%, 9=last
        const jumpNavFiles = previewNavigationFiles.length > 0 ? previewNavigationFiles : displayedFiles;
        if (e.key === '5') {
          e.preventDefault()
          jumpToPosition(0)
          return
        }
        if (e.key === '6') {
          e.preventDefault()
          jumpToPosition(Math.floor(jumpNavFiles.length * 0.25))
          return
        }
        if (e.key === '7') {
          e.preventDefault()
          jumpToPosition(Math.floor(jumpNavFiles.length * 0.5))
          return
        }
        if (e.key === '8') {
          e.preventDefault()
          jumpToPosition(Math.floor(jumpNavFiles.length * 0.75))
          return
        }
        if (e.key === '9') {
          e.preventDefault()
          jumpToPosition(jumpNavFiles.length - 1)
          return
        }
                        if (e.key === 'l' || e.key === 'L') {
                          e.preventDefault()
                          const ext = previewFile.extension.toLowerCase()
                          if (ext === '.gif' || ext === '.heic' || ext === '.heif') {
                            showToast('Rotation is not supported for this file format')
                            return
                          }
                          handleRotate(90)
                          return
                        }
                        if (e.key === 'r' || e.key === 'R') {
                          e.preventDefault()
                          const ext = previewFile.extension.toLowerCase()
                          if (ext === '.gif' || ext === '.heic' || ext === '.heif') {
                            showToast('Rotation is not supported for this file format')
                            return
                          }
                          handleRotate(-90)
                          return
                        }
        // B key: Move to Trash
        if (e.key === 'b' || e.key === 'B') {
          e.preventDefault()
          handleDeletePreviewFile()
          return
        }
        if (e.key === 'Delete') {
          e.preventDefault()
          handleDeletePreviewFile()
          return
        }
        if (e.key === '+' || e.key === '=') {
          e.preventDefault()
          setPreviewZoom(prev => Math.min(400, prev + 20))
          setPreviewFitToWindow(false)
          return
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault()
          setPreviewZoom(prev => Math.max(50, prev - 20))
          return
        }
        if (e.key === '0') {
          e.preventDefault()
          setPreviewZoom(70)
          setPreviewRotation(0)
          setPanOffset({ x: 0, y: 0 })
          return
        }
        return // Very important to return here so no other workspace shortcuts trigger while in preview
      }

      // X - Clear all selections
      if (e.key === 'x' || e.key === 'X') {
        e.preventDefault()
        clearSelections()
        return
      }

      // Ctrl+O - Open Folder
      else if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        handleSelectFolder()
      }
      // Ctrl+A - Select All
      else if (e.ctrlKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        handleSelectAll()
      }
      // Ctrl+N - New Folder
      else if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        handleNewFolderClick()
      }
      // Ctrl+G - AI Group
      else if (e.ctrlKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        handleAIGrouping()
      }
      // Ctrl+Z - Undo
      else if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      }
      // Ctrl+Shift+Z - Redo
      else if (e.ctrlKey && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        handleRedo()
      }
      // Ctrl+, - Settings
      else if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        setShowSettingsPanel(prev => !prev)
      }
      // Ctrl+F - Search
      else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        document.getElementById('search-input')?.focus()
      }
      // Number keys 1-9 - Move to folder (prioritize subfolders if All Files is explored)
      else if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey) {
        const folderIndex = parseInt(e.key) - 1

        // Priority to manual target shortcuts (1-9)
        if (allSubfolders.length > 0 && folderIndex < allSubfolders.length) {
          e.preventDefault()

          let idsToMove: string[] = []
          if (selectedFiles.size > 0) {
            // Multi-select mode
            idsToMove = Array.from(selectedFiles)
          } else if (selectionMode && focusedFileIndex >= 0 && focusedFileIndex < displayedFiles.length) {
            // Quick Move mode (focused only)
            const focusedFile = displayedFiles[focusedFileIndex]
            if (focusedFile) {
              idsToMove = [focusedFile.id]
            }
          }

          if (idsToMove.length > 0) {
            handleMoveToFolder(allSubfolders[folderIndex].path, idsToMove)
          }
        }
      }

      // Shift+Alt+T - Restore all trash (global shortcut)
      else if (e.shiftKey && e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault()
        handleRestoreAllTrash()
        showToast('Restored all items from trash')
      }
      // Ctrl+X - Cut (Move)
      else if (e.ctrlKey && e.key.toLowerCase() === 'x') {
        const selectedFileList = files.filter((f: FileItem) => selectedFiles.has(f.id))
        const selectedPaths = selectedFileList.map((f: FileItem) => f.path)
        if (selectedPaths.length > 0) {
          setClipboard({ files: selectedPaths, mode: 'cut' })
          showToast(`Cut ${selectedPaths.length} item(s) to clipboard`)
        }
      }
      // Ctrl+Plus or Ctrl+= - Increase preview size
      else if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault()
        handleZoomIn()
      }
      // Ctrl+Minus - Decrease preview size
      else if (e.ctrlKey && e.key === '-') {
        e.preventDefault()
        handleZoomOut()
      }
      // Ctrl+C - Copy
      else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        const selectedFileList = files.filter((f: FileItem) => selectedFiles.has(f.id))
        const selectedPaths = selectedFileList.map((f: FileItem) => f.path)
        if (selectedPaths.length > 0) {
          setClipboard({ files: selectedPaths, mode: 'copy' })
          showToast(`Copied ${selectedPaths.length} item(s) to clipboard`)
        }
      }

      // Ctrl+V - Paste
      else if (e.ctrlKey && e.key.toLowerCase() === 'v') {
        handlePaste()
      }
      // Ctrl+H - Toggle sidebar
      else if (e.ctrlKey && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        toggleSidebar()
      }
      // F key - Toggle Fullscreen (Only in main workspace)
      else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.altKey && !showPreviewModal) {
        e.preventDefault()
        ToggleFullscreen()
      }
      // Shift + V - Toggle Selection Mode
      else if (e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault()
        setSelectionMode(!selectionMode)
        if (!selectionMode) {
          setFocusedFileIndex(0)
        }
      }
      // V - Selection Toggle for focused item (when mode is ON)
      else if (e.key === 'v' && !e.ctrlKey && !e.altKey && selectionMode) {
        e.preventDefault()
        if (focusedFileIndex >= 0) {
          const fileId = files[focusedFileIndex]?.id
          if (fileId) {
            const newSelected = new Set<string>(selectedFiles)
            if (newSelected.has(fileId)) {
              newSelected.delete(fileId)
            } else {
              newSelected.add(fileId)
            }
            setSelectedFiles(newSelected)
          }
        }
      }

      // B key or Delete - SILENT DELETION (no confirmation)
      else if (e.key === 'Delete' || e.key === 'b' || e.key === 'B') {
        if (selectedFiles.size > 0 && !showTrashPanel) {
          e.preventDefault()
          handleMoveFilesToTrash() // Direct call - no dialog
        } else if (selectedFolders.length > 0 && !e.ctrlKey) {
          e.preventDefault()
          const firstPath = selectedFolders[0]
          const folder = allSubfolders.find(s => s.path === firstPath)
          if (folder) {
            handleDeleteFolder(folder)
          }
        }
      }
      // R key - Rename selected subfolder
      else if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (selectedFolders.length > 0) {
          e.preventDefault()
          const firstPath = selectedFolders[0]
          const folder = allSubfolders.find(s => s.path === firstPath)
          if (folder) {
            setRenamingFolder(folder)
            setNewFolderName(folder.name)
            setFolderError(null)
            setShowRenameFolderDialog(true)
          }
        }
      }
      // ` key (Backtick) - Move Selected back to main folder
      else if (e.key === '`' && selectedFiles.size > 0 && projectRoot && selectedFolder !== projectRoot) {
        e.preventDefault()
        handleMoveToFolder(projectRoot)
      }
      // Shift + R - Batch Rename Selected (DISABLED in Group view)
      else if (e.shiftKey && (e.key === 'r' || e.key === 'R') && selectedFiles.size > 0 && selectedGroups.size === 0) {
        e.preventDefault()
        setShowBatchRenameDialog(true)
      }
      // Shift + T - Empty Trash
      else if (e.shiftKey && (e.key === 't' || e.key === 'T') && !e.altKey) {
        e.preventDefault()
        handleEmptyTrash()
      }
      // Space - Preview file
      else if (e.code === 'Space' && selectedFiles.size > 0 && !showPreviewModal) {
        e.preventDefault()
        const selectedFile = files.find((f: FileItem) => selectedFiles.has(f.id))
        if (selectedFile) {
          handlePreviewFile(selectedFile)
        }
      }
      // Arrow Keys - Navigate in selection mode
      else if (selectionMode) {
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          setFocusedFileIndex(prev => Math.min(prev + 1, displayedFiles.length - 1))
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setFocusedFileIndex(prev => Math.max(prev - 1, 0))
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          const cols = currentView === 'grid'
            ? Math.floor((fileGridRef.current?.offsetWidth || 1000) / 180)
            : 1
          setFocusedFileIndex(prev => Math.min(prev + cols, displayedFiles.length - 1))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          const cols = currentView === 'grid'
            ? Math.floor((fileGridRef.current?.offsetWidth || 1000) / 180)
            : 1
          setFocusedFileIndex(prev => Math.max(prev - cols, 0))
        }
      }
      // [ - Switch to Grid View
      else if (e.key === '[') {
        e.preventDefault()
        setSettings(prev => ({ ...prev, defaultView: 'grid' }))
        setCurrentView('grid')
      }
      // ] - Switch to List View
      else if (e.key === ']') {
        e.preventDefault()
        setSettings(prev => ({ ...prev, defaultView: 'list' }))
        setCurrentView('list')
      }
      // Escape - Clear selection
      else if (e.key === 'Escape') {
        clearSelections()
        setSelectionMode(false)
        setFocusedFileIndex(-1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    selectionMode, selectedFiles, focusedFileIndex, files, allSubfolders,
    selectedFolder, displayedFiles, currentView, groups, selectedGroups,
    showPreviewModal, previewFile, undoStack, redoStack, showTrashPanel,
    projectRoot, showSettingsPanel, showNewFolderDialog,
    showRenameFolderDialog, showBatchRenameDialog, showTrashConfirmDialog,
    groupSelectionMode, previewNavigationFiles, previewFileIndex, groupBy
  ])

  // Scroll focused file into view
  useEffect(() => {
    if (focusedFileIndex >= 0 && selectionMode) {
      const element = document.querySelector(`[data-file-index="${focusedFileIndex}"]`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [focusedFileIndex, selectionMode])

  // Preview navigation functions
  const navigatePreview = (direction: number) => {
    const supportedPreviewExts = ['.jpg', '.jpeg', '.png', '.heic', '.gif'];
    const navFiles = previewNavigationFiles.length > 0 ? previewNavigationFiles : displayedFiles;
    const newIndex = previewFileIndex + direction
    if (newIndex >= 0 && newIndex < navFiles.length) {
      const file = navFiles[newIndex]
      if (supportedPreviewExts.includes(file.extension.toLowerCase())) {
        handlePreviewFile(file, newIndex, navFiles)
      }
    }
  }

  const jumpToPosition = (index: number) => {
    const supportedPreviewExts = ['.jpg', '.jpeg', '.png', '.heic', '.gif'];
    const navFiles = previewNavigationFiles.length > 0 ? previewNavigationFiles : displayedFiles;
    const clampedIndex = Math.max(0, Math.min(index, navFiles.length - 1))
    const file = navFiles[clampedIndex]
    if (file && supportedPreviewExts.includes(file.extension.toLowerCase())) {
      handlePreviewFile(file, clampedIndex, navFiles)
    }
  }

  /* Handle Mouse Wheel for Zooming */
  /* Global Ctrl+Scroll Zoom Handler */
  useEffect(() => {
    const handleGlobalWheel = (e: WheelEvent) => {
      // Only trigger if Ctrl key is pressed and NO modal is open
      if (e.ctrlKey && !showPreviewModal && !showSettingsPanel &&
        !showNewFolderDialog && !showRenameFolderDialog &&
        !showBatchRenameDialog && !showTrashPanel) {

        e.preventDefault()
        e.stopPropagation()

        const delta = e.deltaY
        const ZOOM_STEP = 20
        const MIN_ZOOM = 100
        const MAX_ZOOM = 400

        setSettings(prev => {
          let newSettings = { ...prev }

          if (delta < 0) {
            // Scrolling UP -> Zoom IN
            if (prev.defaultView === 'list') {
              newSettings.defaultView = 'grid'
              newSettings.thumbnailSize = MIN_ZOOM
            } else {
              newSettings.thumbnailSize = Math.min(prev.thumbnailSize + ZOOM_STEP, MAX_ZOOM)
            }
          } else {
            // Scrolling DOWN -> Zoom OUT
            if (prev.defaultView === 'grid') {
              if (prev.thumbnailSize <= MIN_ZOOM) {
                newSettings.defaultView = 'list'
              } else {
                newSettings.thumbnailSize = Math.max(prev.thumbnailSize - ZOOM_STEP, MIN_ZOOM)
              }
            }
          }
          return newSettings
        })
      }
    }

    // Use passive: false to allow preventDefault (crucial for overriding browser zoom)
    window.addEventListener('wheel', handleGlobalWheel, { passive: false })
    return () => window.removeEventListener('wheel', handleGlobalWheel)
  }, [showPreviewModal, showSettingsPanel, showNewFolderDialog, showRenameFolderDialog, showBatchRenameDialog, showTrashPanel])

  const closePreview = () => {
    setShowPreviewModal(false)
    setPreviewFile(null)
    setPreviewImageUrl(null)
    setPreviewLoading(false)
    setPreviewRotation(0)
    setShowInfoPanel(false)
    setNavArrowsVisible(true)
    setMouseIdle(false)
    setPreviewNavigationFiles([])
    if (mouseIdleTimerRef.current) {
      clearTimeout(mouseIdleTimerRef.current)
    }
  }

  // Mouse idle detection for hiding navigation arrows
  useEffect(() => {
    if (!showPreviewModal) return

    const handleMouseMove = () => {
      setMouseIdle(false)
      setNavArrowsVisible(true)

      if (mouseIdleTimerRef.current) {
        clearTimeout(mouseIdleTimerRef.current)
      }

      mouseIdleTimerRef.current = setTimeout(() => {
        setMouseIdle(true)
        setNavArrowsVisible(false)
      }, 3000)
    }

    window.addEventListener('mousemove', handleMouseMove)

    // Start the timer initially
    mouseIdleTimerRef.current = setTimeout(() => {
      setNavArrowsVisible(false)
    }, 3000)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      if (mouseIdleTimerRef.current) clearTimeout(mouseIdleTimerRef.current)
    }
  }, [showPreviewModal])

  // Automatic auto-selection when a group becomes empty - REMOVED (per user request)
  /*
  useEffect(() => {
    if (groups.length === 0 || selectedGroups.size !== 1) return
    ...
  }, [files, groups, selectedGroups])
  */

  // Handle preview click areas - left 20% = prev, right 20% = next, middle = close
  const handlePreviewClick = (e: React.MouseEvent) => {
    if (!previewRef.current) return

    const rect = previewRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const width = rect.width

    // Left 20% of screen - previous
    if (x < width * 0.2) {
      navigatePreview(-1)
    }
    // Right 20% of screen - next
    else if (x > width * 0.8) {
      navigatePreview(1)
    }
    // Middle 60% - No longer closes preview (user request)
  }

  // File operations
  const handleSelectFolder = async () => {
    try {
      // Clean up caches when switching folders (if setting enabled)
      if (settings.autoCleanupThumbnails !== false) {
        try {
          await CleanupThumbnails()
        } catch (err) {
          console.error('Failed to clean caches:', err)
        }
      }
      
      setIsScanning(true)
      const folder = await SelectFolder()
      if (folder) {
        setProjectRoot(folder)
        setSelectedFolders([folder])
        // ScanFolder and setFiles/setSubfolders is now handled by useEffect on selectedFolders change

        setExternalTargetFolders([]) // Clear external targets when opening new folder

        // Get root stats for the "All Files" label
        const stats = await GetFolderStats(folder)
        setProjectRootStats({ count: stats.fileCount, size: stats.totalSize })

        setGroups([])
        setSelectedGroups(new Set())
        setSelectedGroups(new Set())
        setSelectedFiles(new Set())
      }
    } catch (error) {
      console.error('Error selecting folder:', error)
      alert('Failed to scan folder: ' + error)
    } finally {
      setIsScanning(false)
    }
  }

  const handleAddExternalFolder = async () => {
    try {
      const path = await SelectFolder() // Reusing SelectFolder which is a directory picker
      if (path) {
        // Prevent adding the same folder twice
        if (externalTargetFolders.some(f => f.path === path)) {
          showToast('Folder already in target list')
          return
        }

        const folderName = path.split(/[\\/]/).pop() || path

        // Get initial stats
        let initialCount = 0
        let initialSize = 0
        try {
          const stats = await GetFolderStats(path)
          initialCount = stats.fileCount
          initialSize = stats.totalSize
        } catch (error) {
          console.error('Error getting initial stats:', error)
        }

        const newFolder: FolderItem = {
          id: `external-${Date.now()}`,
          name: folderName,
          path: path,
          color: 'var(--color-primary)',
          shortcut: '',
          fileCount: initialCount,
          totalSize: initialSize
        }
        setExternalTargetFolders(prev => [...prev, newFolder])
        showToast(`Added target folder: ${folderName}`)
      }
    } catch (error) {
      console.error('Error adding external folder:', error)
    }
  }

  const handleRemoveTargetFolder = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setExternalTargetFolders(prev => prev.filter(f => f.id !== id))
    showToast('Target folder unpinned')
  }

  const handleNewFolderClick = () => {
    if (!selectedFolder) {
      alert('You must scan a folder first')
      return
    }
    setNewFolderName('')
    setFolderError(null)
    setShowNewFolderDialog(true)
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !selectedFolder) return

    // Duplicate check
    const exists = subfolders.some(f => f.name.toLowerCase() === newFolderName.trim().toLowerCase())
    if (exists) {
      setFolderError("The folder name is already in use")
      return
    }

    try {
      const folder = await CreateFolder(selectedFolder, newFolderName)
      // Removal of auto-inclusion to sidebar as requested
      // const newFolders = [...folders, folder]
      // setFolders(newFolders)
      // setFolderOrder(newFolders)
      setNewFolderName('')
      setFolderError(null)
      setShowNewFolderDialog(false)

      const operation: UndoOperation = {
        type: 'create_folder',
        description: `Created folder "${newFolderName}"`,
        data: { folderPath: folder.path }
      }
      recordOperation(operation)

      await refreshFolderStats()
      await updateUndoRedoState()
    } catch (error: any) {
      console.error('Error creating folder:', error)
      if (error.toString().includes("already exists")) {
        setFolderError("The folder name is already in use")
      } else {
        alert('Failed to create folder: ' + error)
      }
    }
  }

  const handleRenameFolder = async () => {
    if (!newFolderName.trim() || !renamingFolder) return

    const isBatch = selectedFolders.length > 1 && selectedFolders.includes(renamingFolder.path)
    const targets = isBatch ? selectedFolders : [renamingFolder.path]

    const allExternalInSelection = externalTargetFolders.filter(f => targets.includes(f.path))

    if (allExternalInSelection.length > 0 && (allExternalInSelection.length === targets.length)) {
      // All selected are external targets
      try {
        for (let i = 0; i < allExternalInSelection.length; i++) {
          const target = allExternalInSelection[i]
          const finalName = isBatch ? `${newFolderName} (${i + 1})` : newFolderName
          await RenameFolder(target.path, finalName)

          // Calculate new path
          const dir = target.path.substring(0, Math.max(target.path.lastIndexOf('\\'), target.path.lastIndexOf('/')))
          const separator = target.path.includes('\\') ? '\\' : '/'
          const newPath = `${dir}${separator}${finalName}`

          // Update state array using functional update
          setExternalTargetFolders(prev => prev.map(f =>
            f.id === target.id ? { ...f, name: finalName, path: newPath } : f
          ))

          // Update selection
          setSelectedFolders(prev => prev.map(p => p === target.path ? newPath : p))
        }

        setShowRenameFolderDialog(false)
        setRenamingFolder(null)
        setNewFolderName('')
        showToast(isBatch ? `Renamed ${targets.length} target folders` : `Target folder renamed to "${newFolderName}"`)
        await refreshFolderStats()
        return
      } catch (error) {
        console.error('Error renaming target folders:', error)
        alert('Failed to rename target folders: ' + error)
        return
      }
    }

    // Duplicate check (only if single rename)
    if (!isBatch) {
      const parentDir = renamingFolder.path.substring(0, Math.max(renamingFolder.path.lastIndexOf('\\'), renamingFolder.path.lastIndexOf('/')))
      const isSubfolder = projectRoot && renamingFolder.path.startsWith(projectRoot)

      const nameConflict = newFolderName.trim() !== '' &&
        allSubfolders.some(f => f.path !== renamingFolder.path && f.name.toLowerCase() === newFolderName.trim().toLowerCase())

      if (nameConflict) {
        setFolderError("The folder name is already in use")
        return
      }
    }

    try {
      for (let i = 0; i < targets.length; i++) {
        const targetPath = targets[i]
        const finalName = isBatch ? `${newFolderName} (${i + 1})` : newFolderName

        await RenameFolder(targetPath, finalName)

        // Calculate new path
        const dir = targetPath.substring(0, Math.max(targetPath.lastIndexOf('\\'), targetPath.lastIndexOf('/')))
        const separator = targetPath.includes('\\') ? '\\' : '/'
        const newPath = `${dir}${separator}${finalName}`

        // Update states
        setProjectRootSubfolders(prev => prev.map(f => f.path === targetPath ? { ...f, name: finalName, path: newPath } : f))

        // Update Folder Hierarchy & Expanded Folders
        setFolderHierarchy(prev => {
          const next = { ...prev }
          // 1. Rename the key itself if this folder was expanded
          if (next[targetPath]) {
            next[newPath] = next[targetPath]
            delete next[targetPath]
          }
          // 2. Update this folder in its parent's list
          if (next[dir]) {
            next[dir] = next[dir].map(f => f.path === targetPath ? { ...f, name: finalName, path: newPath } : f)
          }
          return next
        })

        setExpandedFolders(prev => {
          const next = new Set(prev)
          if (next.has(targetPath)) {
            next.delete(targetPath)
            next.add(newPath)
          }
          return next
        })

        // 2. Local renaming logic
        setSubfolders(prev => prev.map(f => f.path === targetPath ? { ...f, name: finalName, path: newPath } : f))

        // Update selection
        setSelectedFolders(prev => prev.map(p => p === targetPath ? newPath : p))

        // If currently viewing
        if (selectedFolder === targetPath) {
          const updatedFiles = files.map(f => {
            if (f.path.startsWith(targetPath)) {
              const newFilePath = f.path.replace(targetPath, newPath)
              return { ...f, path: newFilePath, id: newFilePath }
            }
            return f
          })
          setFiles(updatedFiles)
        }
      }

      await refreshFolderStats()
      setNewFolderName('')
      setRenamingFolder(null)
      setShowRenameFolderDialog(false)
      setFolderError(null) // Clear error after successful rename
      updateUndoRedoState() // Update undo/redo state after all renames
      showToast(isBatch ? `Renamed ${targets.length} folders` : `Folder renamed to "${newFolderName}"`)
    } catch (error: any) {
      console.error('Error renaming folders:', error)
      if (error.toString().includes("already exists")) {
        setFolderError("The folder name is already in use")
      } else {
        alert('Failed to rename folder(s): ' + error)
      }
    }
  }

  const handleDeleteFolder = async (folder: FolderItem) => {
    const isBatch = selectedFolders.length > 1 && selectedFolders.includes(folder.path)
    const targets = isBatch ? allSubfolders.filter(s => selectedFolders.includes(s.path)) : [folder]

    // Check if any in selection are external
    const externalTargets = targets.filter(t => t.id.startsWith('external-'))
    const scannedSubfolders = targets.filter(t => !t.id.startsWith('external-'))

    // 1. Optimistic UI update
    const oldSubfolders = [...subfolders]
    const oldProjectRootSubfolders = [...projectRootSubfolders]
    const oldExternalTargetFolders = [...externalTargetFolders]

    const targetIds = targets.map(t => t.id)

    setSubfolders(prev => prev.filter(f => !targetIds.includes(f.id)))
    setProjectRootSubfolders(prev => prev.filter(f => !targetIds.includes(f.id)))
    setExternalTargetFolders(prev => prev.filter(f => !targetIds.includes(f.id)))
    setTrashCount(prev => prev + targets.length)

    if (isBatch) {
      setSelectedFolders([])
    }

    try {
      for (const target of targets) {
        await MoveFolderToTrash(target.path)
      }

      const operation: UndoOperation = {
        type: 'trash',
        description: isBatch ? `Moved ${targets.length} folders to trash` : `Moved folder "${folder.name}" to trash`,
        data: { folderPath: folder.path } // Simplified for now
      }
      recordOperation(operation)

      // Refresh stats in background
      refreshFolderStats()
      updateUndoRedoState()
    } catch (error) {
      console.error('Error moving folder to trash:', error)
      // Revert state on error
      setSubfolders(oldSubfolders)
      setProjectRootSubfolders(oldProjectRootSubfolders)
      setExternalTargetFolders(oldExternalTargetFolders)
      setTrashCount(prev => prev - targets.length)
      alert('Failed to move folder(s) to trash: ' + error)
    }
  }



  // Target reordering - supports multi-folder drag
  const handleExternalFolderDragStart = (e: React.DragEvent, index: number) => {
    e.stopPropagation()
    const draggedFolder = externalTargetFolders[index]

    // If dragging a folder that's not in selection, select only it
    if (!selectedFolders.includes(draggedFolder.path)) {
      setSelectedFolders([draggedFolder.path])
    }

    setDraggedExternalIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleExternalFolderDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (draggedExternalIndex !== null && draggedExternalIndex !== index) {
      setDragOverExternalIndex(index)
    }
  }

  const handleExternalFolderDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    e.stopPropagation()

    if (draggedExternalIndex === null || draggedExternalIndex === dropIndex) {
      setDraggedExternalIndex(null)
      setDragOverExternalIndex(null)
      return
    }

    // Get all selected folder paths
    const selectedPaths = selectedFolders.length > 0 ? selectedFolders : [externalTargetFolders[draggedExternalIndex].path]
    const selectedTargets = externalTargetFolders.filter(s => selectedPaths.includes(s.path))
    const unselectedTargets = externalTargetFolders.filter(s => !selectedPaths.includes(s.path))

    const newOrder = [...unselectedTargets]
    const actualDropIdx = Math.min(dropIndex, newOrder.length)
    newOrder.splice(actualDropIdx, 0, ...selectedTargets)

    setExternalTargetFolders(newOrder)
    setDraggedExternalIndex(null)
    setDragOverExternalIndex(null)
  }

  // Helper function to handle file drops on folders
  const handleDropOnFolder = async (folderPath: string) => {
    if (draggedFiles.length === 0) return

    const filePaths = files
      .filter(f => draggedFiles.includes(f.id))
      .map(f => f.path)

    try {
      await MoveFiles(filePaths, folderPath)

      const operation: UndoOperation = {
        type: 'move',
        description: `Moved ${filePaths.length} files to folder`,
        data: { files: filePaths, destination: folderPath, source: selectedFolder }
      }
      recordOperation(operation)

      setFiles(files.filter(f => !draggedFiles.includes(f.id)))
      setSelectedFiles(new Set())
      setDraggedFiles([])
      await refreshFolderStats()
      await updateUndoRedoState()
    } catch (error) {
      console.error('Error moving files:', error)
      alert('Failed to move files: ' + error)
    }
  }

  const handleFileClick = (fileId: string, index: number, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()

    if (e.shiftKey && lastSelectedIndex >= 0) {
      const start = Math.min(lastSelectedIndex, index)
      const end = Math.max(lastSelectedIndex, index)
      const newSelected = new Set(selectedFiles)
      for (let i = start; i <= end; i++) {
        newSelected.add(displayedFiles[i].id)
      }
      setSelectedFiles(newSelected)
    } else if (e.ctrlKey || selectionMode) {
      const newSelected = new Set(selectedFiles)
      if (newSelected.has(fileId)) {
        newSelected.delete(fileId)
      } else {
        newSelected.add(fileId)
      }
      setSelectedFiles(newSelected)
      setLastSelectedIndex(index)
    } else {
      setSelectedFiles(new Set([fileId]))
      setLastSelectedIndex(index)
    }

    setFocusedFileIndex(index)
  }

  const handleFileDoubleClick = (file: FileItem) => {
    handlePreviewFile(file)
  }

  const handlePreviewFile = async (file: FileItem, index?: number, navigationFiles?: FileItem[]) => {
    const supportedPreviewExts = ['.jpg', '.jpeg', '.png', '.heic', '.gif'];
    const ext = file.extension.toLowerCase();

    if (!supportedPreviewExts.includes(ext)) {
      alert('Preview is only available for images (JPG, PNG, HEIC, GIF)');
      return
    }

    // Fix: Prevent click-loop bug - don't reopen preview if already viewing this file
    if (showPreviewModal && previewFile?.id === file.id) {
      return
    }

    // Set navigation files based on current grouping (only when first entering preview)
    if (!showPreviewModal || navigationFiles) {
      let navFiles: FileItem[] = navigationFiles || displayedFiles;
      
      if (groupBy === 'type' && !navigationFiles) {
        const fileExt = file.extension.toUpperCase().replace('.', '');
        navFiles = displayedFiles.filter(f => 
          f.extension.toUpperCase().replace('.', '') === fileExt
        );
      } else if (groupBy === 'date' && !navigationFiles) {
        const fileDate = new Date(file.dateTaken || file.modifiedAt);
        const day = fileDate.getDate().toString().padStart(2, '0');
        const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
        const month = monthNames[fileDate.getMonth()];
        const year = fileDate.getFullYear();
        const dateKey = `${day} ${month} ${year}`;
        
        navFiles = displayedFiles.filter(f => {
          const fDate = new Date(f.dateTaken || f.modifiedAt);
          const fDay = fDate.getDate().toString().padStart(2, '0');
          const fMonth = monthNames[fDate.getMonth()];
          const fYear = fDate.getFullYear();
          return `${fDay} ${fMonth} ${fYear}` === dateKey;
        });
      }
      
      setPreviewNavigationFiles(navFiles);
      const groupIndex = navFiles.findIndex(f => f.id === file.id);
      setPreviewFileIndex(groupIndex >= 0 ? groupIndex : 0);
    } else if (index !== undefined) {
      setPreviewFileIndex(index);
    }

    // Show modal immediately with thumbnail as placeholder
    setPreviewFile(file)
    setShowPreviewModal(true)
    setPreviewImageUrl(null)
    // Reset zoom and pan when opening new image
    setPreviewZoom(90)
    setPanOffset({ x: 0, y: 0 })
    setPreviewRotation(0)
    setPreviewFitToWindow(false)

    // Load full HD preview using GetFilePreview API (in background)
    try {
      const previewUrl = await GetFilePreview(file.path)
      setPreviewImageUrl(previewUrl)
    } catch (error) {
      console.error('Error loading HD preview:', error)
    }
  }

  const handleRotate = async (angle: number) => {
    if (!previewFile) return

    try {
      setPreviewLoading(true)
      const newPath = await RotateImage(previewFile.path, angle)
      
      const wasConverted = newPath !== previewFile.path

      // Invalidate thumbnail cache for both old and new paths
      const { thumbnailQueue } = await import('./utils/thumbnailQueue')
      thumbnailQueue.invalidate(previewFile.path)
      if (wasConverted) {
        thumbnailQueue.invalidate(newPath)
      }

      // Reload preview with new path
      const newPreview = await GetFilePreview(newPath)
      setPreviewImageUrl(newPreview)

      const timestamp = Date.now()
      
      // Force all FileCards to refresh thumbnails
      setThumbnailVersion(prev => prev + 1)
      
      // Update file state
      setFiles(prev => {
        if (wasConverted) {
          // HEIC was converted to JPG - update the entire file entry
          return prev.map(f => {
            if (f.id === previewFile?.id) {
              const newName = f.name.replace(/\.(heic|heif)$/i, '.jpg')
              return {
                ...f,
                path: newPath,
                id: newPath,
                name: newName,
                extension: '.jpg',
                thumbnailUrl: `${newPath}?t=${timestamp}`,
                modifiedAt: new Date().toISOString()
              }
            }
            return f
          })
        } else {
          // Same format - just update thumbnail with cache busting
          return prev.map(f => {
            if (f.id === previewFile?.id) {
              const url = f.thumbnailUrl.split('?')[0]
              return { ...f, thumbnailUrl: `${url}?t=${timestamp}`, modifiedAt: new Date().toISOString() }
            }
            return f
          })
        }
      })

      // Update preview file state if path changed
      if (wasConverted) {
        setPreviewFile(prev => {
          if (!prev) return null
          const newName = prev.name.replace(/\.(heic|heif)$/i, '.jpg')
          return {
            ...prev,
            path: newPath,
            id: newPath,
            name: newName,
            extension: '.jpg',
            thumbnailUrl: `${newPath}?t=${timestamp}`
          }
        })
        showToast('HEIC converted to JPG and rotated')
      }

      setPreviewLoading(false)
    } catch (err) {
      console.error('Failed to rotate image:', err)
      showToast(`Failed to rotate image: ${err}`)
      setPreviewLoading(false)
    }
  }

  const handleMoveToFolder = async (folderPath: string, targetFileIds?: string[]) => {
    const idsToMove = targetFileIds || Array.from(selectedFiles)
    if (idsToMove.length === 0) return

    const selectedFileList = files.filter(f => idsToMove.includes(f.id))
    const filePaths = selectedFileList.map(f => f.path)

    try {
      await MoveFiles(filePaths, folderPath)

      const operation: UndoOperation = {
        type: 'move',
        description: `Moved ${filePaths.length} files to folder`,
        data: { files: filePaths, destination: folderPath, source: selectedFolder }
      }
      recordOperation(operation)

      // Remove moved files from state
      setFiles(files.filter(f => !idsToMove.includes(f.id)))

      // Clear selection if we moved selected files
      if (!targetFileIds) {
        setSelectedFiles(new Set())
      } else {
        // If moving specific files, remove them from selection if they were there
        const newSelected = new Set(selectedFiles)
        idsToMove.forEach(id => newSelected.delete(id))
        setSelectedFiles(newSelected)
      }

      await refreshFolderStats()
      await updateUndoRedoState()
      showToast(`Successfully moved ${filePaths.length} item(s)`)
    } catch (error) {
      console.error('Error moving files:', error)
      alert('Failed to move files: ' + error)
    }
  }

  // Move files to trash
  const handleMoveToTrash = async () => {
    if (selectedFiles.size === 0) return

    const filePaths = files
      .filter(f => selectedFiles.has(f.id))
      .map(f => f.path)

    try {
      const trashItems = await MoveFilesToTrash(filePaths)

      const operation: UndoOperation = {
        type: 'trash',
        description: `Moved ${filePaths.length} files to trash`,
        data: { files: filePaths, trashItems: trashItems }
      }
      recordOperation(operation)

      setFiles(files.filter(f => !selectedFiles.has(f.id)))
      setSelectedFiles(new Set())
      setShowTrashConfirmDialog(false)
      setTrashCount(prev => prev + filePaths.length)
      await updateUndoRedoState()
    } catch (error) {
      console.error('Error moving files to trash:', error)
      alert('Failed to move files to trash: ' + error)
    }
  }

  // Move current preview file to a specific folder (one-key sorting)
  const moveCurrentPreviewFileToFolder = async (folderPath: string) => {
    if (!previewFile) return

    const folderName = previewFolderOptions.find(f => f.path === folderPath)?.name || 'folder'

    try {
      await MoveFiles([previewFile.path], folderPath)

      const operation: UndoOperation = {
        type: 'move',
        description: `Moved "${previewFile.name}" to ${folderName}`,
        data: { files: [previewFile.path], destination: folderPath, source: selectedFolder }
      }
      recordOperation(operation)

      // Get current navigation files before state updates
      const navFiles = previewNavigationFiles.length > 0 ? previewNavigationFiles : displayedFiles;
      const updatedNavFiles = navFiles.filter(f => f.id !== previewFile.id);
      
      // Remove file from files list
      setFiles(files.filter(f => f.id !== previewFile.id))
      setPreviewNavigationFiles(updatedNavFiles)
      await refreshFolderStats()
      await updateUndoRedoState()

      // Navigate to next file or close preview
      if (updatedNavFiles.length === 0) {
        closePreview()
      } else {
        const nextIndex = previewFileIndex >= updatedNavFiles.length ? 0 : previewFileIndex;
        const nextFile = updatedNavFiles[nextIndex];

        if (nextFile) {
          handlePreviewFile(nextFile, nextIndex, updatedNavFiles)
        } else {
          closePreview()
        }
      }
    } catch (error) {
      console.error('Error moving file to folder:', error)
      alert('Failed to move file to folder: ' + error)
    }
  }

  // Delete single file from preview modal (auto-delete, no confirmation)
  const handleDeletePreviewFile = async () => {
    if (!previewFile) return

    try {
      const trashItems = await MoveFilesToTrash([previewFile.path])

      const operation: UndoOperation = {
        type: 'trash',
        description: `Moved "${previewFile.name}" to trash`,
        data: { files: [previewFile.path], trashItems: trashItems }
      }
      recordOperation(operation)

      // Get current navigation files before state updates
      const navFiles = previewNavigationFiles.length > 0 ? previewNavigationFiles : displayedFiles;
      const updatedNavFiles = navFiles.filter(f => f.id !== previewFile.id);

      // Remove file from files list
      setFiles(files.filter(f => f.id !== previewFile.id))
      setPreviewNavigationFiles(updatedNavFiles)
      setTrashCount(prev => prev + 1)
      await updateUndoRedoState()

      // Advance for better workflow
      if (updatedNavFiles.length === 0) {
        closePreview()
      } else {
        const nextIndex = previewFileIndex >= updatedNavFiles.length ? 0 : previewFileIndex;
        const nextFile = updatedNavFiles[nextIndex];

        if (nextFile) {
          handlePreviewFile(nextFile, nextIndex, updatedNavFiles)
        } else {
          closePreview()
        }
      }
    } catch (error) {
      console.error('Error moving file to trash:', error)
      alert('Failed to move file to trash: ' + error)
    }
  }

  // Batch rename functionality
  // Batch rename functionality
  const handleBatchRename = async () => {
    if (selectedFiles.size === 0 || !batchRenamePattern) return

    try {
      const selectedFileList = files.filter((f: FileItem) => selectedFiles.has(f.id))
      const filePaths = selectedFileList.map((f: FileItem) => f.path)

      // Use the pattern as the base name (remove {n} placeholder logic for now as requested is incremental suffix)
      // If user provided "MyImage", backend will generate "MyImage (1).jpg", etc.
      // We will strip invalid characters or placeholder if user typed them
      const baseName = batchRenamePattern.replace(/\{n\}/g, '').trim()

      const { BatchRenameFiles } = await import('./wailsjs/go/main/App')
      await BatchRenameFiles(filePaths, baseName)

      // Refresh folder
      if (selectedFolder) {
        const content = await ScanFolder(selectedFolder)
        const newFileList = content.files as FileItem[]
        setFiles(newFileList)
        setSubfolders(content.subfolders as FolderItem[])

        // SYNC GROUPS: Update any group that contained these files with their new names/paths
        setGroups(prev => prev.map(group => {
          let groupChanged = false
          const updatedGroupFiles = group.files.map(gf => {
            // Find if this group file has been updated in the fresh scan (match by ID if possible, or search paths)
            // Note: If ID is stable, we just replace it. If ID changed, we might need a fallback.
            const updated = newFileList.find(nf => nf.id === gf.id)
            if (updated && (updated.name !== gf.name || updated.path !== gf.path)) {
              groupChanged = true
              return updated
            }
            return gf
          })
          return groupChanged ? { ...group, files: updatedGroupFiles } : group
        }))
      }

      const count = filePaths.length
      showToast(count === 1 ? 'File renamed' : `Batch renamed ${count} files`)
      setBatchRenamePattern('')
      setShowBatchRenameDialog(false)

      const operation: UndoOperation = {
        type: 'rename', // We might want a dedicated 'batch_rename' type later
        description: count === 1 ? 'Renamed file' : `Batch renamed ${count} files`,
        data: { /* Complex data for undo, simplified for now */ }
      }
      recordOperation(operation)
      updateUndoRedoState()

    } catch (error) {
      console.error('Batch rename failed:', error)
      alert('Batch rename failed: ' + error)
    }
  }

  // Drag and drop for files
  const handleDragStart = (e: React.DragEvent, fileId: string) => {
    const filesToDrag = selectedFiles.has(fileId)
      ? Array.from(selectedFiles)
      : [fileId]

    setDraggedFiles(filesToDrag)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/json', JSON.stringify({
      ids: filesToDrag,
      source: selectedFolder
    }))
    // Also set text/plain for compatibility
    e.dataTransfer.setData('text/plain', filesToDrag.join(','))
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = async (e: React.DragEvent, folderPath: string) => {
    e.preventDefault()

    let idsToMove: string[] = []

    // Try to get data from dataTransfer first (most robust)
    try {
      const data = e.dataTransfer.getData('application/json')
      if (data) {
        const parsed = JSON.parse(data)
        idsToMove = parsed.ids
      }
    } catch (err) {
      console.warn('Failed to parse drag data:', err)
    }

    // Fallback to state
    if (idsToMove.length === 0) {
      idsToMove = draggedFiles
    }

    if (idsToMove.length === 0) return

    const filePaths = files
      .filter(f => idsToMove.includes(f.id))
      .map(f => f.path)

    try {
      await MoveFiles(filePaths, folderPath)

      const operation: UndoOperation = {
        type: 'move',
        description: `Moved ${filePaths.length} files to folder`,
        data: { files: filePaths, destination: folderPath, source: selectedFolder }
      }
      recordOperation(operation)

      setFiles(files.filter(f => !idsToMove.includes(f.id)))
      setSelectedFiles(new Set())
      setDraggedFiles([])
      await refreshFolderStats()
      await updateUndoRedoState()
    } catch (error) {
      console.error('Error moving files:', error)
      alert('Failed to move files: ' + error)
    }
  }

  // AI Grouping with BATCH PROCESSING - Non-blocking UI
  const BATCH_SIZE = 500 // Process 500 files per batch
  const BATCH_DELAY = 100 // Small delay between batches to keep UI responsive

  const handleCancelAIGrouping = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsGrouping(false)
    setIsBackgroundGrouping(false)
    showToast('AI Grouping cancelled')
  }

  const handleAIGrouping = async () => {
    if (files.length === 0) {
      alert('No files to group. Please scan a folder first.')
      return
    }

    // Check if already processing
    if (isBackgroundGrouping) {
      showToast('AI Grouping already in progress...')
      return
    }

    const settings = await GetSettings()

    // Create new abort controller
    abortControllerRef.current = new AbortController()

    setIsBackgroundGrouping(true)
    setIsGrouping(true)
    setGroupingProgress(0)
    setGroupingMessage('Starting AI Visual Organizing...')
    setGroupingStartTime(Date.now())

    try {
      // Import the old backend function from ai_grouping.go
      const { AIGroupFiles } = await import('./wailsjs/go/main/App')

      setGroupingProgress(20)
      setGroupingMessage('Analyzing visual similarity...')

      const config = {
        SimilarityThreshold: settings.similarityThreshold || 70,
        TimeWindowHours: settings.timeWindowHours || 4.0,
        MinGroupSize: settings.minGroupSize || 2
      }

      // Execute old-style visual grouping
      const result = await AIGroupFiles(files as any, config)

      setGroupingProgress(90)
      setGroupingMessage('Finalizing groups...')

      setGroups(result as unknown as FileGroup[])
      setSelectedGroups(new Set())

      if (result && result.length > 0) {
        setSelectedGroups(new Set([result[0].id]))
      }

      setGroupingProgress(100)
      showToast('Visual Grouping complete!')

    } catch (error) {
      console.error('Error grouping files:', error)
      alert('Failed to group files: ' + error)
    } finally {
      setIsGrouping(false)
    }
  }


  // Group management
  const handleRemoveFromFileGroup = (groupId: string, fileId: string) => {
    setRemovedFromGroups(prev => {
      const current = prev[groupId] || new Set()
      const next = new Set(current)
      next.add(fileId)
      return { ...prev, [groupId]: next }
    })
  }

  const handleGroupClick = (groupId: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || groupSelectionMode) {
      // Multi-select or toggle mode
      const next = new Set(selectedGroups)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      setSelectedGroups(next)
    } else {
      // Single select - toggle filter
      const next = new Set(selectedGroups)
      if (next.has(groupId) && next.size === 1) {
        next.clear()
      } else {
        next.clear()
        next.add(groupId)
      }
      setSelectedGroups(next)
    }
  }

  const handleDeleteGroups = () => {
    if (selectedGroups.size === 0) return

    // Get groups being deleted for undo
    const deletedGroups = groups.filter(g => selectedGroups.has(g.id))

    // Remove groups without deleting files (no confirmation needed - undo available)
    setGroups(groups.filter(g => !selectedGroups.has(g.id)))
    setSelectedGroups(new Set())

    // If active group was deleted, clear it
    const nextSelected = new Set(selectedGroups)
    deletedGroups.forEach(g => nextSelected.delete(g.id))
    setSelectedGroups(nextSelected)

    // Record for undo
    const operation: UndoOperation = {
      type: 'delete_groups',
      description: `Deleted ${deletedGroups.length} group(s)`,
      data: { deletedGroups }
    }
    recordOperation(operation)

    // Show toast
    showToast(`Deleted ${deletedGroups.length} group(s). Press Ctrl+Z to undo.`)
  }

  const handleDeleteSingleGroup = (groupId: string) => {
    // Get group being deleted for undo
    const deletedGroup = groups.find(g => g.id === groupId)
    if (!deletedGroup) return

    // Remove group without confirmation - undo available
    setGroups(groups.filter(g => g.id !== groupId))
    if (selectedGroups.has(groupId)) {
      const next = new Set(selectedGroups)
      next.delete(groupId)
      setSelectedGroups(next)
    }

    // Record for undo
    const operation: UndoOperation = {
      type: 'delete_group',
      description: `Deleted group "${deletedGroup.name}"`,
      data: { deletedGroup }
    }
    recordOperation(operation)

    // Show toast
    showToast(`Deleted group "${deletedGroup.name}". Press Ctrl+Z to undo.`)
  }

  // Delete all groups at once
  const handleRestoreGroupFiles = async () => {
    if (selectedGroups.size === 0) return
    const groupIds = Array.from(selectedGroups)
    const targetGroupId = groupIds[0]
    const group = groups.find(g => g.id === targetGroupId)
    if (!group) return

    showToast(`Searching subfolders to restore files to "${group.name}"...`)

    try {
      const currentFileIds = new Set(files.map(f => f.id))
      const missingFiles = group.files.filter(f => !currentFileIds.has(f.id))

      if (missingFiles.length === 0) {
        showToast("No missing files found for this group.")
        return
      }

      const filesToRestore: string[] = []

      // Scan immediate subfolders to find these files
      for (const sub of allSubfolders) {
        const subContent = await ScanFolder(sub.path)
        const subFiles = subContent.files as FileItem[]

        missingFiles.forEach(mf => {
          const found = subFiles.find(sf => sf.name === mf.name || sf.id === mf.id)
          if (found) {
            filesToRestore.push(found.path)
          }
        })
      }

      if (filesToRestore.length > 0) {
        await MoveFiles(filesToRestore, selectedFolder)

        // Refresh folder
        const content = await ScanFolder(selectedFolder)
        setFiles(content.files as FileItem[])
        setSubfolders(content.subfolders as FolderItem[])

        showToast(`Restored ${filesToRestore.length} file(s) to "${group.name}"`)
        await refreshFolderStats()
      } else {
        showToast("Could not find any group files in immediate subfolders.")
      }
    } catch (error) {
      console.error('Failed to restore group files:', error)
      showToast('Error during restoration.')
    }
  }

  const handleDeleteAllGroups = () => {
    if (groups.length === 0) return

    // Get all groups for undo
    const allGroups = [...groups]

    // Clear all groups
    setGroups([])
    setSelectedGroups(new Set())

    // Record for undo
    const operation: UndoOperation = {
      type: 'delete_all_groups',
      description: `Deleted all ${allGroups.length} groups`,
      data: { allGroups }
    }
    recordOperation(operation)

    // Show toast
    showToast(`Deleted all ${allGroups.length} groups. Press Ctrl+Z to undo.`)
  }



  // Toggle theme
  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(newTheme)
    setSettings({ ...settings, theme: newTheme })
  }

  // Format bytes
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  // Memoized active group names for display
  const activeGroupNames = useMemo(() => {
    if (selectedGroups.size === 0) return ''
    const names = groups
      .filter(g => selectedGroups.has(g.id))
      .map(g => g.name)
    return names.join(', ')
  }, [selectedGroups, groups])

  return (
    <div className="app">
      {/* Loading Overlay - Can be closed to run in background or cancelled */}
      {isGrouping && (
        <div className="grouping-overlay">
          <div className="grouping-content">
            <div className="grouping-header">
              {/* Close button removed for PhotoSort v3.4 to prevent accidental interruption */}
            </div>
            <Loader2 size={48} className="spinner" />
            <h3>{groupingMessage}</h3>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${groupingProgress}%` }}
              />
            </div>
            <div className="grouping-stats">
              <span className="progress-percent">{groupingProgress}%</span>
              <span className="elapsed-time">
                <Clock size={14} />
                {elapsedTime}
              </span>
            </div>
            <div className="grouping-actions">
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => setIsGrouping(false)}
              >
                Background
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={handleCancelAIGrouping}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="logo">
            <Sparkles size={22} />
            <h1>PhotoSort</h1>
          </div>
          <div className="header-divider" />
          <div className="header-actions">
            <button
              className="btn btn-primary"
              onClick={handleSelectFolder}
              disabled={isScanning}
              title={t('buttons.open')}
            >
              <FolderOpen size={16} />
              {t('buttons.open')}
            </button>

            <button
              className="btn btn-secondary"
              onClick={handleNewFolderClick}
              disabled={!selectedFolder}
              title={t('buttons.newFolder')}
            >
              <Plus size={16} />
              {t('buttons.newFolder')}
            </button>

            <button
              className="btn btn-secondary"
              onClick={handleAIGrouping}
              disabled={isBackgroundGrouping || files.length === 0}
              title={t('buttons.aiGroup')}
            >
              <Sparkles size={16} />
              {isBackgroundGrouping ? 'Processing...' : t('buttons.aiGroup')}
            </button>
          </div>
        </div>

        <div className="header-center">
          {selectedFolder && (
            <div className="search-container">
              <Search size={14} className="search-icon" />
              <input
                id="search-input"
                type="text"
                className="search-input"
                placeholder="Search files... (Ctrl+F)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="search-clear"
                  onClick={() => setSearchQuery('')}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="header-right">

          <button
            className="btn-icon"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title="Undo (Ctrl+Z)"
          >
            <Undo size={16} />
          </button>

          <button
            className="btn-icon"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo size={16} />
          </button>

          <div className="header-divider" />

          {/* Slider removed as requested */}

          <div className="header-divider" />

          <div className="view-toggle">
            <button
              className={`btn-icon ${currentView === 'grid' ? 'active' : ''}`}
              onClick={() => setCurrentView('grid')}
              title="Grid View"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={`btn-icon ${currentView === 'list' ? 'active' : ''}`}
              onClick={() => setCurrentView('list')}
              title="List View"
            >
              <List size={16} />
            </button>
          </div>

          <button
            className="btn-icon"
            onClick={toggleTheme}
            title="Toggle Theme"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <button
            className={`btn-icon ${selectionMode ? 'active' : ''}`}
            onClick={() => setSelectionMode(!selectionMode)}
            title="Toggle Selection Mode (V)"
          >
            <Check size={16} />
          </button>

          <button
            className="btn-icon"
            onClick={() => setShowSettingsPanel(prev => !prev)}
            title="Settings (Ctrl+,)"
          >
            <Settings size={16} />
          </button>
        </div>
      </header >

      {/* Main Content */}
      < div className="app-content" >
        {/* Sidebar */}
        < aside
          ref={sidebarRef}
          className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${isResizing ? 'resizing' : ''}`
          }
          style={{ width: sidebarCollapsed ? '50px' : `${sidebarWidth}px` }}
        >
          {/* Resizer Handle */}
          {!sidebarCollapsed && <div className="sidebar-resizer" onMouseDown={startResizing} />}
          {/* Sidebar Header with Collapse Button */}
          <div className="sidebar-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                className="btn-icon btn-xs"
                onClick={toggleSidebar}
                title={sidebarCollapsed ? "Expand Sidebar (Ctrl+H)" : "Collapse Sidebar (Ctrl+H)"}
              >
                {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>
              {!sidebarCollapsed && <h3>Folders</h3>}
            </div>
            {!sidebarCollapsed && (
              <button
                className="btn-icon btn-xs"
                onClick={handleAddExternalFolder}
                title="Add External Target Folder"
              >
                <Plus size={16} />
              </button>
            )}
          </div>

          {
            sidebarCollapsed ? (
              <div className="sidebar-collapsed-content">
                <div
                  className={`folder-item-collapsed ${selectedFolders.includes(projectRoot || '') ? 'active' : ''}`}
                  onClick={(e) => projectRoot && handleSubfolderClick(projectRoot, e)}
                  title="All Files"
                >
                  <span className="folder-icon">📁</span>
                </div>

                <div className="collapsed-subfolder-indicators">
                  {allSubfolders.slice(0, 9).map((subfolder, index) => (
                    <div
                      key={subfolder.id}
                      className={`collapsed-subfolder-badge ${selectedFolder === subfolder.path ? 'active' : ''}`}
                      title={`${subfolder.name} (${index + 1})`}
                      onClick={() => handleSubfolderClick(subfolder.path)}
                    >
                      {index + 1}
                    </div>
                  ))}
                </div>

                <div className="sidebar-section-divider" />

                <div
                  className={`folder-item-collapsed folder-item-trash ${showTrashPanel ? 'active' : ''}`}
                  onClick={handleOpenTrash}
                  title="Trash"
                >
                  <Trash size={18} />
                </div>
              </div>
            ) : (
              <div className="sidebar-content">
                <div className="folder-list">


                  <div className="folder-item-group">
                    <div
                      className={`folder-item folder-item-all folder-drop-zone ${selectedFolders.includes(projectRoot || '') ? 'active' : ''} ${dragOverFolderPath === projectRoot ? 'drag-over' : ''}`}
                      onClick={(e) => projectRoot && handleSubfolderClick(projectRoot, e)}
                      onDragOver={(e) => projectRoot && handleFolderDragOver(e, projectRoot || '')}
                      onDragLeave={() => setDragOverFolderPath(null)}
                      onDrop={(e) => projectRoot && handleFolderDrop(e, projectRoot || '')}
                    >
                      <span className="folder-icon">📁</span>
                      <span className="folder-name">All Files</span>
                      <span className="folder-count">{projectRootStats.count}</span>
                    </div>

                    {renderFolderTree(projectRootSubfolders, 0, projectRoot || '')}

                    {/* External Target Folders Section */}
                    {allSubfolders.filter(f => projectRoot && !f.path.startsWith(projectRoot)).length > 0 && (
                      <div className="external-target-list">
                        {!sidebarCollapsed && <div className="sidebar-targets-header">Target Folders</div>}
                        {allSubfolders
                          .filter(f => projectRoot && !f.path.startsWith(projectRoot))
                          .map((subfolder) => {
                            // Find the index in the original allSubfolders for keyboard shortcuts
                            const globalIndex = allSubfolders.findIndex(s => s.path === subfolder.path)
                            return (
                              <div
                                key={subfolder.id}
                                draggable
                                onDragStart={(e) => handleFolderDragStart(e, subfolder as any)}
                                onDragOver={(e) => handleFolderDragOver(e, subfolder.path)}
                                onDrop={(e) => handleExternalTargetDrop(e, subfolder.id)}
                                className={`folder-item subfolder-item folder-drop-zone ${selectedFolders.includes(subfolder.path) ? 'active' : ''} ${dragOverFolderPath === subfolder.path ? 'drag-over' : ''}`}
                                onClick={(e) => handleSubfolderClick(subfolder.path, e)}
                              >
                                <div className="subfolder-shortcut-badge">{globalIndex + 1}</div>
                                {!sidebarCollapsed && (
                                  <>
                                    <div className="subfolder-info">
                                      <span className="folder-name">{subfolder.name}</span>
                                      <div className="subfolder-metadata">
                                        <span className="folder-size">{formatBytes(subfolder.totalSize)}</span>
                                        <span className="folder-divider-dot">•</span>
                                        <span className="folder-count-text">{subfolder.fileCount} files</span>
                                      </div>
                                    </div>
                                    <div className="folder-actions">
                                      <button
                                        className="btn-icon btn-xs"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setRenamingFolder(subfolder)
                                          setNewFolderName(subfolder.name)
                                          setShowRenameFolderDialog(true)
                                        }}
                                        title="Rename target folder"
                                      >
                                        <Edit2 size={12} />
                                      </button>
                                      <button
                                        className="btn-icon btn-xs"
                                        onClick={(e) => handleRemoveTargetFolder(subfolder.id, e)}
                                        title="Unpin target folder"
                                      >
                                        <X size={12} />
                                      </button>
                                      <button
                                        className="btn-icon btn-xs text-danger"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleDeleteFolder(subfolder)
                                        }}
                                        title="Delete actual folder"
                                      >
                                        <Trash size={12} />
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            )
                          })
                        }
                      </div>
                    )}

                    {/* Trash Item */}
                    <div
                      className={`folder-item folder-item-trash ${showTrashPanel ? 'active' : ''}`}
                      onClick={handleOpenTrash}
                      onDragOver={(e) => {
                        e.preventDefault()
                        e.currentTarget.classList.add('drag-over')
                      }}
                      onDragLeave={(e) => {
                        e.currentTarget.classList.remove('drag-over')
                      }}
                      onDrop={async (e) => {
                        e.preventDefault()
                        e.currentTarget.classList.remove('drag-over')

                        let idsToMove: string[] = []
                        try {
                          const data = e.dataTransfer.getData('application/json')
                          if (data) {
                            const parsed = JSON.parse(data)
                            idsToMove = parsed.ids
                          }
                        } catch (err) { }

                        if (idsToMove.length === 0) idsToMove = draggedFiles
                        if (idsToMove.length === 0) return

                        const filePaths = files
                          .filter(f => idsToMove.includes(f.id))
                          .map(f => f.path)

                        if (filePaths.length === 0) return

                        try {
                          const trashItems = await MoveFilesToTrash(filePaths)
                          const operation: UndoOperation = {
                            type: 'trash',
                            description: `Moved ${filePaths.length} files to trash via drag-drop`,
                            data: { files: filePaths, trashItems: trashItems }
                          }
                          recordOperation(operation)
                          setFiles(files.filter(f => !idsToMove.includes(f.id)))
                          setSelectedFiles(new Set())
                          setTrashCount(prev => prev + filePaths.length)
                          await updateUndoRedoState()
                        } catch (error) {
                          console.error('Error dragging to trash:', error)
                        }
                      }}
                      title="View trash (T key) • Drag files here to delete"
                    >
                      <Trash size={14} className="folder-icon trash-icon" />
                      <span className="folder-name">Trash</span>
                      {trashCount > 0 && (
                        <span className="folder-count trash-count">{trashCount}</span>
                      )}
                    </div>
                  </div>

                  {/* Groups Section */}
                  {groups.length > 0 && (
                    <>
                      <div className="sidebar-section-divider" />
                      <div className="sidebar-header">
                        <h3>GROUPS ({groups.length})</h3>
                        <div className="group-header-actions">
                          <button
                            className="delete-all-groups-btn"
                            onClick={handleDeleteAllGroups}
                            title="Delete all groups (files won't be deleted)"
                          >
                            Delete All
                          </button>
                        </div>
                      </div>
                      <div className={`group-list ${groupSelectionMode ? 'selection-mode-active' : ''}`}>
                        {!sidebarCollapsed && (
                          <div className="sidebar-targets-header">
                            <div className="ai-groups-label">
                              <span>AI GROUPS</span>
                            </div>
                            <div className="group-header-actions">
                              <button
                                className={`group-filter-toggle ${isGroupFilterSearchVisible ? 'active' : ''}`}
                                onClick={() => setIsGroupFilterSearchVisible(!isGroupFilterSearchVisible)}
                                title="Filter Groups"
                              >
                                <Filter size={12} />
                              </button>
                              <button
                                className={`ai-multi-select-toggle ${groupSelectionMode ? 'active' : ''}`}
                                onClick={() => setGroupSelectionMode(!groupSelectionMode)}
                                title="Toggle Multi-selection Mode"
                              >
                                {groupSelectionMode ? 'Multi-select: ON' : 'Multi-select'}
                              </button>
                            </div>
                          </div>
                        )}

                        {isGroupFilterSearchVisible && !sidebarCollapsed && (
                          <div className="group-filter-bar redesigned">
                            <div className="filter-input-wrapper">
                              <Search size={14} className="filter-search-icon" />
                              <input
                                type="text"
                                placeholder="Search groups..."
                                value={groupFilterQuery}
                                onChange={(e) => setGroupFilterQuery(e.target.value)}
                                className="group-filter-input"
                                autoFocus
                              />
                            </div>
                            <div className="filter-controls">
                              <div className="filter-toggle-group">
                                <span className="filter-label">SHOW EMPTY GROUPS</span>
                                <label className="ui-switch large">
                                  <input
                                    type="checkbox"
                                    checked={showEmptyGroups}
                                    onChange={(e) => setShowEmptyGroups(e.target.checked)}
                                  />
                                  <span className="slider round"></span>
                                </label>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* AI Groups Section */}
                        {groups.length > 0 && !sidebarCollapsed && (
                          <div className="ai-groups-section">
                            {groups
                              .filter(g => {
                                const matchesSearch = g.name.toLowerCase().includes(groupFilterQuery.toLowerCase())
                                if (!matchesSearch) return false
                                if (!showEmptyGroups) {
                                  const currentFileIds = new Set(files.map(f => f.id))
                                  const hasVisibleFiles = g.files.some(f => currentFileIds.has(f.id))
                                  if (!hasVisibleFiles) return false
                                }
                                return true
                              })
                              .map((group) => {
                                const currentFileIds = new Set(files.map(f => f.id))
                                const rejectedIds = removedFromGroups[group.id] || new Set()
                                const visibleCount = group.files.filter(f =>
                                  currentFileIds.has(f.id) && !rejectedIds.has(f.id)
                                ).length

                                return (
                                  <div
                                    key={group.id}
                                    className={`group-item ${selectedGroups.has(group.id) ? 'active' : ''} ${visibleCount === 0 ? 'disabled' : ''}`}
                                    onClick={(e) => handleGroupClick(group.id, e)}
                                    title={`${group.groupType} group • ${visibleCount} files • Ctrl+Click to multi-select`}
                                  >
                                    <Users size={14} className="group-icon-svg" />
                                    <span className="group-name">{group.name}</span>
                                    {group.similarity > 0 && group.files.length > 0 && (
                                      <span className="group-similarity">{Math.round(group.similarity)}%</span>
                                    )}
                                    <span className="group-count">{visibleCount}</span>
                                  </div>
                                )
                              })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          }
        </aside>

        {/* File Grid */}
        < main className="main-content" >
          {selectedFolder && (
            <div className="content-header">
              <div className="breadcrumb">
                <button className="btn-icon btn-xs" onClick={handleGoUp} title="Go Up (Parent Folder)">
                  <ChevronLeft size={16} />
                </button>
                <span className="breadcrumb-item" title={selectedFolders.join('\n')}>
                  {selectedFolders.length > 1
                    ? `${selectedFolders.length} Folders Selected`
                    : (selectedFolder.length > 60 ? selectedFolder.substring(0, 60) + '...' : selectedFolder)}
                </span>

              </div>

              <div className="stats-divider-vertical" />

              <div className="content-stats">
                {selectedFolderStats && (
                  <span className="stat-item">
                    {selectedFolderStats.count} files • {formatBytes(selectedFolderStats.size)}
                  </span>
                )}
              </div>

              <div className="bulk-actions-group">
                {/* Filter Button with Dropdown */}
                <div className="filter-dropdown-container" ref={filterMenuRef}>
                  <button
                    className={`btn btn-sm btn-secondary ${(sortBy || groupBy !== null) ? 'filter-active' : ''}`}
                    onClick={() => setShowFilterMenu(!showFilterMenu)}
                    title="Filter and Sort"
                  >
                    <Filter size={14} />
                    {(sortBy || groupBy !== null) && (
                      <span className="filter-badge">{(sortBy ? 1 : 0) + (groupBy !== null ? 1 : 0)}</span>
                    )}
                  </button>

                  {showFilterMenu && (
                    <div className="filter-dropdown-menu">
                      {/* Sort Section */}
                      <div className="filter-section">
                        <div className="filter-section-header">Sort By</div>
                        <button
                          className={`filter-option ${sortBy === 'name' ? 'active' : ''}`}
                          onClick={() => {
                            if (sortBy === 'name') {
                              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                            } else {
                              setSortBy('name')
                              setSortOrder('asc')
                            }
                          }}
                        >
                          <span>Name</span>
                          {sortBy === 'name' && (
                            sortOrder === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                          )}
                        </button>
                        <button
                          className={`filter-option ${sortBy === 'date' ? 'active' : ''}`}
                          onClick={() => {
                            if (sortBy === 'date') {
                              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                            } else {
                              setSortBy('date')
                              setSortOrder('desc') // Default to newest first
                            }
                          }}
                        >
                          <span>Date</span>
                          {sortBy === 'date' && (
                            sortOrder === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />
                          )}
                        </button>
                        <button
                          className={`filter-option ${sortBy === 'type' ? 'active' : ''}`}
                          onClick={() => {
                            if (sortBy === 'type') {
                              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                            } else {
                              setSortBy('type')
                              setSortOrder('asc')
                            }
                          }}
                        >
                          <span>Type</span>
                          {sortBy === 'type' && (
                            sortOrder === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                          )}
                        </button>
                        <button
                          className={`filter-option ${sortBy === 'size' ? 'active' : ''}`}
                          onClick={() => {
                            if (sortBy === 'size') {
                              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                            } else {
                              setSortBy('size')
                              setSortOrder('desc') // Default to largest first
                            }
                          }}
                        >
                          <span>Size</span>
                          {sortBy === 'size' && (
                            sortOrder === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />
                          )}
                        </button>
                        {sortBy && (
                          <button
                            className="filter-option filter-clear"
                            onClick={() => setSortBy(null)}
                          >
                            Clear Sort
                          </button>
                        )}
                      </div>

                      {/* Group By Section */}
                      <div className="filter-section">
                        <div className="filter-section-header">Group By</div>
                        <button
                          className={`filter-option ${groupBy === 'date' ? 'active' : ''}`}
                          onClick={() => setGroupBy(groupBy === 'date' ? null : 'date')}
                        >
                          <span>Date</span>
                          {groupBy === 'date' && <ChevronDown size={14} />}
                        </button>
                        <button
                          className={`filter-option ${groupBy === 'type' ? 'active' : ''}`}
                          onClick={() => setGroupBy(groupBy === 'type' ? null : 'type')}
                        >
                          <span>Type</span>
                          {groupBy === 'type' && <ChevronDown size={14} />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  className="btn btn-sm btn-secondary"
                  onClick={handleSelectAll}
                  title={t('buttons.selectAll')}
                >
                  <CheckSquare size={14} />
                  {t('buttons.selectAll')}
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={handleCopyAll}
                  title={t('buttons.copyAll')}
                  disabled={displayedFiles.length === 0}
                >
                  <Copy size={14} />
                  {t('buttons.copyAll')}
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={handleDeleteAll}
                  title={t('buttons.deleteAll')}
                  disabled={displayedFiles.length === 0}
                >
                  <Trash2 size={14} />
                  {t('buttons.deleteAll')}
                </button>
              </div>
            </div>
          )}

          <div
            className="file-container"
            ref={fileGridRef}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                // Clear file selections but maintain group selection
                const nextSelected = new Set(selectedFiles)
                nextSelected.clear()
                setSelectedFiles(nextSelected)
                setSelectionMode(false)
                setContextMenu(null)
              }
            }}
          >
            {files.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <FolderOpen size={64} strokeWidth={1} />
                </div>
                <h2>No Files to Display</h2>
                <p>Click "Open" or press Ctrl+O to scan a folder</p>
                <div className="empty-state-shortcuts-container">
                  <p className="shortcuts-paragraph">
                    <span className="shortcut-group-inline">
                      <span className="shortcut-hint" data-tooltip="Open Folder"><kbd>Ctrl+O</kbd></span>
                      <span className="shortcut-hint" data-tooltip="Toggle Sidebar"><kbd>Ctrl+H</kbd></span>
                      <span className="shortcut-hint" data-tooltip="Search"><kbd>Ctrl+F</kbd></span>
                      <span className="shortcut-hint" data-tooltip="Settings"><kbd>Ctrl+,</kbd></span>
                      <span className="shortcut-hint" data-tooltip="Fullscreen"><kbd>F</kbd></span>
                    </span>
                    <span className="shortcut-separator">|</span>
                    <span className="shortcut-group-inline">
                      <span className="shortcut-hint" data-tooltip="AI Group"><kbd>Ctrl+G</kbd></span>
                      <span className="shortcut-hint" data-tooltip="New Folder"><kbd>Ctrl+N</kbd></span>
                      <span className="shortcut-hint" data-tooltip="Move to Folder (Sidebar order)"><kbd>1-9</kbd></span>
                      <span className="shortcut-hint" data-tooltip="Reorder Sidebar"><kbd>Alt + Drag</kbd></span>
                    </span>
                    <span className="shortcut-separator">|</span>
                    <span className="shortcut-group-inline">
                      <span className="shortcut-hint" data-tooltip="Select All"><kbd>Ctrl+A</kbd></span>
                      <span className="shortcut-hint" data-tooltip="Selection Mode"><kbd>Shift+V</kbd></span>
                      <span className="shortcut-hint" data-tooltip="Mark Selected"><kbd>V</kbd></span>
                      <span className="shortcut-hint" data-tooltip="Batch Rename"><kbd>Shift+R</kbd></span>
                      <span className="shortcut-hint" data-tooltip="Undo"><kbd>Ctrl+Z</kbd></span>
                    </span>
                    <span className="shortcut-separator">|</span>
                    <span className="shortcut-group-inline">
                      <span className="shortcut-hint" data-tooltip="Toggle Trash"><kbd>T</kbd></span>
                      <span className="shortcut-hint" data-tooltip="Empty Trash"><kbd>Shift+T</kbd></span>
                      <span className="shortcut-hint" data-tooltip="Restore Trash"><kbd>Shft+Alt+T</kbd></span>
                      <span className="shortcut-hint" data-tooltip="Exit App"><kbd>Alt+X</kbd></span>
                    </span>
                    <span className="shortcut-separator">|</span>
                    <span className="shortcut-group-inline">
                      <span className="shortcut-hint" data-tooltip="Preview"><kbd>Space</kbd></span>
                      <span className="shortcut-hint" data-tooltip="Close"><kbd>Esc</kbd></span>
                    </span>
                  </p>
                </div>
              </div>
            ) : displayedFiles.length === 0 ? (
              <div className="empty-state">
                <Search size={48} strokeWidth={1} />
                {selectedGroups.size > 0 ? (
                  <>
                    <h2>Empty Group</h2>
                    <p>No files from this group are present in the current folder.</p>
                    <div className="empty-state-actions">
                      <button className="btn btn-primary" onClick={handleRestoreGroupFiles}>
                        <RefreshCw size={14} style={{ marginRight: '8px' }} />
                        Restore Images to Group
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h2>No Matching Files</h2>
                    <p>Try adjusting your search or filters</p>
                    <button className="btn btn-secondary" onClick={() => { setSearchQuery(''); setSelectedGroups(new Set()); }}>
                      Clear Filters
                    </button>
                  </>
                )}
              </div>
            ) : (
              <VirtualFileGrid
                files={groupedFiles ? [] : displayedFiles}
                groupedFiles={groupedFiles}
                displayedFiles={displayedFiles}
                currentView={currentView}
                selectedFiles={selectedFiles}
                focusedFileIndex={focusedFileIndex}
                selectionMode={selectionMode}
                clipboard={clipboard}
                onFileClick={handleFileClick}
                onFileDoubleClick={handleFileDoubleClick}
                onContextMenu={handleContextMenu}
                onDragStart={handleDragStart}
                formatBytes={formatBytes}
                showGroupPreviews={settings.showGroupPreviews}
                showDateGroupThumbnails={settings.showDateGroupThumbnails}
                groupBy={groupBy}
                collapsedGroups={collapsedGroups}
                onToggleCollapse={toggleGroupCollapse}
                thumbnailVersion={thumbnailVersion}
              />
            )}
          </div>
        </main >
      </div >

      {/* Context Menu */}
      {
        contextMenu && (
          <div
            className="context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="context-menu-item" onClick={() => handleContextAction('rename')}>
              Rename
            </button>


            <div className="context-menu-separator" />

            <button className="context-menu-item" style={{ color: 'var(--color-error)' }} onClick={() => handleContextAction('delete')}>
              Delete
            </button>
          </div>
        )
      }

      {/* Status Bar */}
      <footer className="status-bar">
        <div className="status-left">
          <div className="about-container">
            <span className="about-link">
              <Info size={12} /> About PhotoSort
            </span>
            <div className="about-tooltip">
              <strong>PhotoSort v4.7.1</strong><br />
              AI-Powered File Organizer<br />
              © 2026
            </div>
          </div>
          {selectionMode && (
            <span className="status-badge">
              <Check size={10} />
              Selection Mode
              <span className="status-hint">Use arrow keys to navigate</span>
            </span>
          )}
          {allSubfolders.length > 0 && selectedFiles.size > 0 && (
            <span className="status-hint">
              Press 1-{Math.min(allSubfolders.length, 9)} to move to folder
            </span>
          )}
          {undoStack.length > 0 && (
            <span className="status-hint">
              <kbd>Ctrl</kbd>+<kbd>Z</kbd> to undo
            </span>
          )}
          {selectedGroups.size > 0 && (
            <>
              <span className="status-badge">
                {selectedGroups.size} group(s) selected
              </span>
              <span className="status-badge-secondary">
                {selectedGroupsTotalFiles} files
              </span>
            </>
          )}
          {isBackgroundGrouping && (
            <span
              className="status-badge ai-processing clickable"
              onClick={() => setIsGrouping(true)}
              title="Click to view progress"
            >
              <Loader2 size={12} className="animate-spin" />
              AI Grouping: {aiProcessingFiles}/{aiTotalFiles}
            </span>
          )}
        </div>
        <div className="status-right">
          {selectedFiles.size > 0 && (
            <span className="status-item selection-info">
              <strong>{selectedFiles.size}</strong> SELECTED
            </span>
          )}
          <span className="status-item">
            Total: <strong>{files.length}</strong> files
          </span>
          {groups.length > 0 && (
            <span className="status-item">
              • <strong>{groups.length}</strong> groups
            </span>
          )}
          {selectedGroups.size > 0 && (
            <span className="status-item filter-badge">
              <Filter size={10} />
              Filtered
            </span>
          )}
          {trashCount > 0 && (
            <span className="status-item trash-badge">
              <Trash size={10} />
              {trashCount} in trash
            </span>
          )}
        </div>
      </footer>

      {/* New Folder Dialog */}
      {
        showNewFolderDialog && (
          <div className="dialog-overlay" onClick={() => setShowNewFolderDialog(false)}>
            <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
              <div className="dialog-header">
                <h3>Create New Folder</h3>
              </div>

              <div className="dialog-body">
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
                  in {selectedFolder?.split('\\').pop() || selectedFolder}
                </div>
                <input
                  type="text"
                  className="dialog-input"
                  placeholder="Folder name"
                  value={newFolderName}
                  onChange={(e) => {
                    setNewFolderName(e.target.value)
                    setFolderError(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                  autoFocus
                />
                {folderError && <div className="dialog-error">{folderError}</div>}
              </div>

              <div className="dialog-footer">
                <button className="btn btn-sm btn-secondary" onClick={() => setShowNewFolderDialog(false)}>
                  Cancel
                </button>
                <button className="btn btn-sm btn-primary" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                  Create
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Rename Folder Dialog */}
      {
        showRenameFolderDialog && (
          <div className="dialog-overlay" onClick={() => setShowRenameFolderDialog(false)}>
            <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
              <div className="dialog-header">
                <h3>Rename Folder</h3>
              </div>

              <div className="dialog-body">
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
                  {renamingFolder?.name}
                </div>
                <input
                  type="text"
                  className="dialog-input"
                  placeholder="New folder name"
                  value={newFolderName}
                  onChange={(e) => {
                    setNewFolderName(e.target.value)
                    setFolderError(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleRenameFolder()}
                  autoFocus
                />
                {folderError && <div className="dialog-error">{folderError}</div>}
              </div>

              <div className="dialog-footer">
                <button className="btn btn-sm btn-secondary" onClick={() => setShowRenameFolderDialog(false)}>
                  Cancel
                </button>
                <button className="btn btn-sm btn-primary" onClick={handleRenameFolder} disabled={!newFolderName.trim()}>
                  Rename
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Trash Confirm Dialog */}
      {
        showTrashConfirmDialog && (
          <div className="dialog-overlay" onClick={() => setShowTrashConfirmDialog(false)}>
            <div className="dialog trash-confirm-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="dialog-header">
                <div className="dialog-title">
                  <div className="title-icon-wrapper danger">
                    <Trash2 size={26} />
                  </div>
                  <h3>Move to Trash</h3>
                </div>
                <button className="btn-icon" onClick={() => setShowTrashConfirmDialog(false)}>
                  <X size={20} />
                </button>
              </div>

              <div className="dialog-content">
                <p className="dialog-message">
                  Are you sure you want to move <strong>{selectedFiles.size}</strong> item{selectedFiles.size !== 1 ? 's' : ''} to the trash?
                </p>
                <div className="dialog-info-box">
                  <Info size={16} />
                  <span>Files can be restored from the trash later if needed.</span>
                </div>
              </div>

              <div className="dialog-actions">
                <button className="btn btn-ghost" onClick={() => setShowTrashConfirmDialog(false)}>
                  Cancel
                </button>
                <button className="btn btn-danger btn-large" onClick={handleMoveToTrash}>
                  <Trash2 size={18} />
                  <span>Move to Trash</span>
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Settings Panel */}
      {
        showSettingsPanel && (
          <div className="panel-overlay" onClick={() => setShowSettingsPanel(false)}>
            <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
              <div className="panel-header">
                <h2><Settings size={20} /> {t('Settings')}</h2>
                <button className="btn-icon" onClick={() => setShowSettingsPanel(false)}>
                  <X size={20} />
                </button>
              </div>

              {/* Settings Tabs */}
              <div className="settings-tabs">
                <button
                  className={`settings-tab ${settingsTab === 'general' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('general')}
                >
                  {t('General')}
                </button>
                <button
                  className={`settings-tab ${settingsTab === 'guide' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('guide')}
                >
                  {t('User Guide')}
                </button>
              </div>

              <div className="panel-content">
                {settingsTab === 'general' && (
                  <div className="settings-grid-layout">
                    {/* Left Column: AI Grouping */}
                    <div className="settings-column">
                      <div className="settings-section compact">
                        <h3>{t('AI Grouping')}</h3>

                        <div className="setting-item compact">
                          <div className="setting-label-row">
                            <label>{t('Similarity')}</label>
                            <span className="setting-value">{settings.similarityThreshold}%</span>
                          </div>
                          <input
                            type="range"
                            className="compact-slider"
                            min="50"
                            max="100"
                            value={settings.similarityThreshold}
                            onChange={(e) => setSettings({ ...settings, similarityThreshold: parseInt(e.target.value) })}
                          />
                        </div>

                        <div className="setting-item compact">
                          <div className="setting-label-row">
                            <label>{t('Time Window')}</label>
                            <span className="setting-value">{settings.timeWindowHours}h</span>
                          </div>
                          <input
                            type="range"
                            className="compact-slider"
                            min="1"
                            max="168"
                            value={settings.timeWindowHours}
                            onChange={(e) => setSettings({ ...settings, timeWindowHours: parseInt(e.target.value) })}
                          />
                        </div>

                        <div className="setting-item compact">
                          <div className="setting-label-row">
                            <label>{t('Min Group Size')}</label>
                            <span className="setting-value">{settings.minGroupSize}</span>
                          </div>
                          <input
                            type="range"
                            className="compact-slider"
                            min="2"
                            max="20"
                            value={settings.minGroupSize}
                            onChange={(e) => setSettings({ ...settings, minGroupSize: parseInt(e.target.value) })}
                          />
                        </div>

                        {/* Gemini API Key Input */}
                        <div className="setting-item compact" style={{ marginTop: '20px' }}>
                          <div className="setting-label-row">
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>{t('Gemini API Key')}</span>
                              <span
                                className="get-key-link"
                                style={{
                                  fontSize: '11px',
                                  color: 'var(--color-primary)',
                                  cursor: 'pointer',
                                  textDecoration: 'underline'
                                }}
                                onClick={() => window.open('https://aistudio.google.com/app/apikey', '_blank')}
                              >
                                (Get Key →)
                              </span>
                            </label>
                            {settings.geminiApiKey && settings.geminiApiKey.length > 10 && (
                              <span className="setting-value" style={{ color: 'var(--color-success)', fontSize: '11px' }}>
                                ✓ Configured
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                            <input
                              type="password"
                              className="dialog-input"
                              placeholder="Enter your Gemini API Key"
                              value={settings.geminiApiKey || ''}
                              onChange={(e) => setSettings({ ...settings, geminiApiKey: e.target.value })}
                              style={{ flex: 1, fontSize: '12px' }}
                            />
                            <button
                              className="btn btn-sm btn-secondary"
                              onClick={async () => {
                                const { TestGeminiConnection } = await import('./wailsjs/go/main/App')
                                try {
                                  const result = await TestGeminiConnection(settings.geminiApiKey || '')
                                  showToast(`✓ ${result}`)
                                } catch (err) {
                                  showToast(`✗ Connection failed: ${err}`)
                                }
                              }}
                              disabled={!settings.geminiApiKey}
                            >
                              Test
                            </button>
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '6px', lineHeight: '1.4' }}>
                            💡 <strong>Free API Available:</strong> Google Gemini offers a generous free tier with 1,500 requests/day.
                            <br />
                            🔑 Click "Get Key" to create your free API key at Google AI Studio.
                            <br />
                            🎯 Without API key, groups will be named "Group 1, Group 2, etc." (smart categorization requires API key).
                          </div>
                        </div>

                      </div>
                    </div>

                    {/* Right Column: Display & Files */}
                    <div className="settings-column">
                      <div className="settings-section compact">
                        <h3>{t('Scratch Disk')}</h3>
                        <div className="setting-item compact">
                          <label>{t('Cache Location')}</label>
                          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                            <input
                              type="text"
                              className="dialog-input"
                              placeholder="Default (AppData)"
                              value={settings.cachePath || ''}
                              readOnly
                              style={{ flex: 1, fontSize: '11px', opacity: 0.8 }}
                            />
                            <button
                              className="btn btn-sm btn-secondary"
                              onClick={async () => {
                                try {
                                  const folder = await SelectFolder()
                                  if (folder) {
                                    setSettings({ ...settings, cachePath: folder })
                                  }
                                } catch (err) {
                                  console.error('Failed to select folder:', err)
                                }
                              }}
                            >
                              Browse
                            </button>
                          </div>
                          <p style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '6px' }}>
                            {settings.cachePath
                              ? `Temporary data will be stored in: ${settings.cachePath}`
                              : "Temporary data and thumbnails will be stored here to save space on C: drive."}
                          </p>
                        </div>
                        <div className="highlighted-setting-box">
                          <div className="toggle-switch-row">
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                className="toggle-switch-input"
                                checked={settings.autoCleanupThumbnails !== false}
                                onChange={(e) => setSettings({ ...settings, autoCleanupThumbnails: e.target.checked })}
                              />
                              <span className="toggle-switch-slider"></span>
                              <span className="toggle-switch-label">Auto-delete cache on exit</span>
                            </label>
                          </div>
                          <p style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '8px', lineHeight: '1.4' }}>
                            Automatically clear all cached thumbnails and previews when switching folders or closing the application.
                            <strong> Cache files are temporary data</strong> used to speed up image loading and can be safely deleted.
                          </p>
                          <button
                            className="btn btn-xs btn-secondary"
                            style={{ marginTop: '12px' }}
                            onClick={async () => {
                              try {
                                await CleanupThumbnails()
                                showToast('✓ Cache cleared successfully')
                              } catch (err) {
                                showToast(`✗ Failed to clear cache: ${err}`)
                              }
                            }}
                          >
                            <Trash2 size={12} style={{ marginRight: '4px' }} />
                            Clear Cache Now
                          </button>
                        </div>
                      </div>

                      <div className="settings-section compact">
                        <h3>{t('Display')}</h3>
                        <div className="setting-item compact">
                          <label>{t('Theme')}</label>
                          <div className="segmented-control">
                            <button
                              className={`segment-btn ${settings.theme === 'dark' ? 'active' : ''}`}
                              onClick={() => {
                                setSettings({ ...settings, theme: 'dark' })
                                setTheme('dark')
                              }}
                            >Dark</button>
                            <button
                              className={`segment-btn ${settings.theme === 'light' ? 'active' : ''}`}
                              onClick={() => {
                                setSettings({ ...settings, theme: 'light' })
                                setTheme('light')
                              }}
                            >Light</button>
                            <button
                              className={`segment-btn ${settings.theme === 'green' ? 'active' : ''}`}
                              onClick={() => {
                                setSettings({ ...settings, theme: 'green' })
                                setTheme('green')
                              }}
                            >Green</button>
                          </div>
                        </div>
                      </div>

                      <div className="settings-section compact">
                        <h3>{t('Grouping & Metadata')}</h3>
                        <div className="highlighted-setting-box" style={{ padding: '12px', marginTop: '12px' }}>
                          <div className="toggle-switch-row" style={{ marginBottom: '10px' }}>
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                className="toggle-switch-input"
                                checked={settings.showGroupPreviews !== false}
                                onChange={(e) => setSettings({ ...settings, showGroupPreviews: e.target.checked })}
                              />
                              <span className="toggle-switch-slider"></span>
                              <span className="toggle-switch-label">Show thumbnails in group headers</span>
                            </label>
                          </div>
                          <div className="toggle-switch-row">
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                className="toggle-switch-input"
                                checked={settings.showDateGroupThumbnails !== false}
                                onChange={(e) => setSettings({ ...settings, showDateGroupThumbnails: e.target.checked })}
                              />
                              <span className="toggle-switch-slider"></span>
                              <span className="toggle-switch-label">Show thumbnails in date grouping</span>
                            </label>
                          </div>
                          <p style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '8px', lineHeight: '1.4' }}>
                            Show a representative preview thumbnail next to the group header label.
                          </p>
                        </div>
                      </div>

                      <div className="settings-section compact">
                        <h3>{t('File Extensions')}</h3>
                        <div className="file-extensions-grid">
                          {/* Images */}
                          {['JPG', 'PNG', 'HEIC', 'GIF', 'MP4', 'MOV', 'MKV', 'MP3', 'WAV', 'PDF', 'TXT', 'DOC', 'JS', 'PY', 'GO', 'ZIP', 'RAR'].map(ext => (
                            <div
                              key={ext}
                              className={`ext-tag ${settings.activeExtensions?.[ext] !== false ? 'active' : ''}`}
                              onClick={() => {
                                const newActive = { ...settings.activeExtensions }
                                newActive[ext] = !newActive[ext]
                                setSettings({ ...settings, activeExtensions: newActive })
                              }}
                            >
                              {ext}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {settingsTab === 'guide' && (
                  <UserGuide />
                )}
              </div>

              <div className="panel-footer settings-footer-dense">
                <button className="btn-minimal btn-minimal-danger" onClick={() => {
                  /* Reset Logic */
                  setSettings({
                    similarityThreshold: 80,
                    timeWindowHours: 24,
                    minGroupSize: 2,
                    theme: 'dark',
                    defaultView: 'grid',
                    thumbnailSize: 150,
                    sidebarWidth: 260,
                    sidebarCollapsed: false,
                    interfaceFont: 'system',
                    showImages: true,
                    showVideos: true,
                    showAudio: true,
                    showDocuments: true,
                    showCode: true,
                    showArchives: true,
                    activeExtensions: {
                      'JPG': true, 'PNG': true, 'HEIC': true, 'GIF': true,
                      'MP4': true, 'MOV': true, 'MKV': true,
                      'MP3': true, 'WAV': true,
                      'PDF': true, 'TXT': true, 'DOC': true,
                      'JS': true, 'PY': true, 'GO': true,
                      'ZIP': true, 'RAR': true
                    }
                  })
                  document.documentElement.setAttribute('data-font', 'system')
                  setTheme('dark')
                }}>
                  {t('Reset to Default')}
                </button>
                <div className="footer-actions-right">
                  <button className="btn-minimal" onClick={() => setShowSettingsPanel(false)}>
                    {t('Cancel')}
                  </button>
                  <button className="btn-minimal btn-minimal-primary" onClick={handleSaveSettings}>
                    {t('Save Settings')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {/* Enhanced Preview Modal - Modern Gallery Viewer */}
      {
        showPreviewModal && previewFile && (
          <div
            className="preview-overlay"
            onClick={closePreview}
            onWheel={(e) => {
              // Mouse wheel zoom
              e.preventDefault()
              e.stopPropagation()
              const delta = e.deltaY > 0 ? -10 : 10
              setPreviewZoom(prev => {
                const newZoom = Math.max(50, Math.min(400, prev + delta))
                if (newZoom > 100) {
                  setPreviewFitToWindow(false)
                }
                return newZoom
              })
            }}
          >
            {/* Layer 1: Backdrop - handled by preview-overlay */}

            {/* Layer 3: Top Header Bar */}
            <div className="preview-header-bar" onClick={(e) => { if (e.target === e.currentTarget) closePreview() }}>
              <div className="preview-header-left">
                <h3 className="preview-filename" title={previewFile.name}>
                  {previewFile.name}
                  <span className="preview-filesize">{formatBytes(previewFile.size)}</span>
                </h3>
              </div>
              <div className="preview-header-right">
                <span className="preview-counter">
                  Image {previewFileIndex + 1} of {previewNavigationFiles.length || displayedFiles.length}
                </span>
                <button
                  className="preview-header-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    closePreview()
                  }}
                  title="Close (Esc)"
                >
                  <X size={28} />
                </button>
              </div>
            </div>

            {/* Layer 2: Image Container - Centered with Pan Support */}
            <div
              className="preview-image-wrapper"
              ref={previewRef}
              onClick={handlePreviewClick}
            >
              {/* Navigation Arrows - Auto-hide on idle */}
              <div
                className={`preview-nav-arrow preview-nav-prev ${!navArrowsVisible ? 'hidden' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  navigatePreview(-1)
                }}
                title="Previous (←)"
              >
                <ChevronLeft size={24} />
              </div>

              <div
                className={`preview-image-center ${isDragging ? 'grabbing' : ''} ${previewZoom > 100 && !previewFitToWindow ? 'pannable' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  // Toggle focus zoom on double click
                  if (!previewFitToWindow) {
                    setPreviewFitToWindow(true)
                    setPanOffset({ x: 0, y: 0 })
                  } else {
                    setPreviewFitToWindow(false)
                    setPreviewZoom(110)
                    setPanOffset({ x: 0, y: 0 })
                  }
                }}
                onMouseDown={(e) => {
                  // Only allow panning when zoomed in
                  if (previewZoom > 100 && !previewFitToWindow) {
                    e.preventDefault()
                    setIsDragging(true)
                    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y })
                  }
                }}
                onMouseMove={(e) => {
                  if (isDragging && previewZoom > 100 && !previewFitToWindow) {
                    e.preventDefault()
                    setPanOffset({
                      x: e.clientX - dragStart.x,
                      y: e.clientY - dragStart.y
                    })
                  }
                }}
                onMouseUp={() => {
                  setIsDragging(false)
                }}
                onMouseLeave={() => {
                  setIsDragging(false)
                }}
              >
                {/* Loading overlay only for rotation operations */}
                {previewLoading && (
                  <div className="preview-loading-overlay">
                    <Loader2 size={32} className="spinner" />
                    <span>Processing...</span>
                  </div>
                )}
                <img
                  src={previewImageUrl || previewFile.thumbnailUrl}
                  alt={previewFile.name}
                  className={`preview-image ${previewFitToWindow ? 'fit-window' : 'original-size'}`}
                  style={{
                    transform: previewFitToWindow
                      ? `rotate(${previewRotation}deg)`
                      : `translate(${panOffset.x}px, ${panOffset.y}px) scale(${previewZoom / 100}) rotate(${previewRotation}deg)`,
                    transformOrigin: 'center center',
                    cursor: previewZoom > 100 && !previewFitToWindow ? (isDragging ? 'grabbing' : 'grab') : 'default'
                  }}
                  draggable={false}
                />
                {/* Show HD loading indicator when loading HD image but not during rotation */}
                {!previewLoading && !previewImageUrl && previewFile.thumbnailUrl && (
                  <div className="preview-hd-loading">
                    <Loader2 size={16} className="spinner" />
                    <span>Loading HD...</span>
                  </div>
                )}
              </div>

              <div
                className={`preview-nav-arrow preview-nav-next ${!navArrowsVisible ? 'hidden' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  navigatePreview(1)
                }}
                title="Next (→)"
              >
                <ChevronRight size={24} />
              </div>
            </div>

            {/* Layer 3: Bottom Floating Toolbar (Glassmorphism) */}
            <div className="preview-toolbar" onClick={(e) => { if (e.target === e.currentTarget) closePreview() }}>
              <div className="preview-toolbar-group">
                <button
                  className="preview-toolbar-btn"
                  onClick={() => {
                    setPreviewZoom(prev => Math.max(20, prev - 20))
                    setPreviewFitToWindow(false)
                  }}
                  title="Zoom Out (-)"
                >
                  <ZoomOut size={26} />
                </button>
                <span className="preview-zoom-value">{previewZoom}%</span>
                <button
                  className="preview-toolbar-btn"
                  onClick={() => {
                    setPreviewZoom(prev => Math.min(400, prev + 20))
                    setPreviewFitToWindow(false)
                  }}
                  title="Zoom In (+)"
                >
                  <ZoomIn size={26} />
                </button>
              </div>

              <div className="preview-toolbar-divider" />

              <div className="preview-toolbar-group">
                <button
                  className="preview-toolbar-btn"
                  onClick={() => {
                    setPreviewZoom(90)
                    setPreviewFitToWindow(false)
                    setPanOffset({ x: 0, y: 0 })
                  }}
                  title="Actual Size (1:1)"
                >
                  <span style={{ fontSize: '11px', fontWeight: 600 }}>1:1</span>
                </button>
                <button
                  className="preview-toolbar-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    const ext = previewFile?.extension.toLowerCase()
                    if (ext === '.gif' || ext === '.heic' || ext === '.heif') {
                      showToast('Rotation is not supported for this file format')
                      return
                    }
                    handleRotate(90)
                  }}
                  title="Rotate Left (L)"
                >
                  <RotateCcw size={26} />
                </button>
                <button
                  className="preview-toolbar-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    const ext = previewFile?.extension.toLowerCase()
                    if (ext === '.gif' || ext === '.heic' || ext === '.heif') {
                      showToast('Rotation is not supported for this file format')
                      return
                    }
                    handleRotate(-90)
                  }}
                  title="Rotate Right (R)"
                >
                  <RotateCw size={26} />
                </button>
              </div>

              <div className="preview-toolbar-divider" />

              <div className="preview-toolbar-group">

                <button
                  className="preview-toolbar-btn preview-toolbar-danger"
                  onClick={handleDeletePreviewFile}
                  title="Delete (B)"
                >
                  <Trash2 size={26} />
                </button>
                <button
                  className={`preview-toolbar-btn ${showInfoPanel ? 'active' : ''}`}
                  onClick={() => setShowInfoPanel(prev => !prev)}
                  title="Info (Space)"
                >
                  <Info size={26} />
                </button>
              </div>
            </div>

            {/* Layer 3: Info Sidebar - Slide-in */}
            <div className={`preview-sidebar ${showInfoPanel ? 'open' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) closePreview() }}>
              <div className="preview-sidebar-header">
                <h4>File Information</h4>
              </div>
              <div className="preview-sidebar-content">
                <div className="preview-info-row">
                  <span className="preview-info-label">File Name</span>
                  <span className="preview-info-value" title={previewFile.name}>{previewFile.name}</span>
                </div>
                <div className="preview-info-row">
                  <span className="preview-info-label">File Type</span>
                  <span className="preview-info-value">{previewFile.fileType.toUpperCase()}</span>
                </div>
                <div className="preview-info-row">
                  <span className="preview-info-label">File Size</span>
                  <span className="preview-info-value">{formatBytes(previewFile.size)}</span>
                </div>
                <div className="preview-info-row">
                  <span className="preview-info-label">Modified</span>
                  <span className="preview-info-value">{new Date(previewFile.modifiedAt).toLocaleString()}</span>
                </div>
                <div className="preview-info-row">
                  <span className="preview-info-label">Full Path</span>
                  <span className="preview-info-value preview-info-path" title={previewFile.path}>{previewFile.path}</span>
                </div>
              </div>

            </div>

            {/* Folder Navigation Overlay - Bottom Left */}
            {
              previewFolderOptions.length > 0 && (
                <div className="preview-folder-nav" onClick={(e) => { if (e.target === e.currentTarget) closePreview() }}>
                  <div className="preview-folder-nav-tiles">
                    {previewFolderOptions.map((folder, index) => (
                      <button
                        key={folder.id}
                        className={`preview-folder-tile ${selectedFolder === folder.path ? 'active' : ''}`}
                        onClick={() => {
                          moveCurrentPreviewFileToFolder(folder.path)
                        }}
                        title={`${folder.name} (Press ${index + 1})`}
                      >
                        <span className="folder-number">{index + 1}</span>
                        <span className="folder-name">{folder.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            }
          </div >
        )
      }



      {/* Batch Rename Dialog */}
      {
        showBatchRenameDialog && (
          <div className="dialog-overlay" onClick={() => setShowBatchRenameDialog(false)}>
            <div className="dialog-content" onClick={(e) => e.stopPropagation()} style={{ width: '360px' }}>
              <div className="dialog-header">
                <h3>Batch Rename</h3>
              </div>

              <div className="dialog-body">
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
                  {selectedFiles.size} file{selectedFiles.size !== 1 ? 's' : ''} selected
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '10px', marginBottom: '6px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Pattern
                  </label>
                  <input
                    type="text"
                    className="dialog-input"
                    placeholder="image_{n}"
                    value={batchRenamePattern}
                    onChange={(e) => setBatchRenamePattern(e.target.value)}
                  />
                  <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                    Use {'{n}'} for number
                  </div>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '10px', marginBottom: '6px', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Start
                  </label>
                  <input
                    type="number"
                    className="dialog-input"
                    style={{ width: '80px', textAlign: 'center' }}
                    min="1"
                    max="9999"
                    value={batchRenameStartNumber}
                    onChange={(e) => setBatchRenameStartNumber(parseInt(e.target.value) || 1)}
                  />
                </div>

                {selectedFiles.size > 0 && (
                  <div style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    padding: '10px 12px',
                    borderRadius: '6px',
                    marginTop: '8px'
                  }}>
                    <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Preview
                    </div>
                    {files
                      .filter(f => selectedFiles.has(f.id))
                      .slice(0, 3)
                      .map((file, idx) => {
                        const newName = batchRenamePattern.replace(/\{n\}/g, (batchRenameStartNumber + idx).toString().padStart(3, '0'))
                        return (
                          <div key={file.id} style={{ fontSize: '11px', marginBottom: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            <span style={{ color: 'var(--color-text-muted)', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                            <span style={{ color: 'var(--color-primary)' }}>→</span>
                            <span style={{ color: 'var(--color-text-primary)', fontWeight: '500' }}>{newName}{file.extension}</span>
                          </div>
                        )
                      })}
                    {selectedFiles.size > 3 && (
                      <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                        +{selectedFiles.size - 3} more
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="dialog-footer">
                <button className="btn btn-sm btn-secondary" onClick={() => setShowBatchRenameDialog(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleBatchRename}
                  disabled={!batchRenamePattern.trim()}
                >
                  Rename
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Trash Panel */}
      <TrashPanel
        isOpen={showTrashPanel}
        onClose={() => setShowTrashPanel(false)}
        trashItems={trashItems}
        onRestore={handleRestoreFromTrash}
        onRestoreAll={handleRestoreAllTrash}
        onEmptyTrash={handleEmptyTrash}
        onScanFolder={ScanFolder}
        t={t}
      />

      {/* Context Menu */}


      {/* Toast Notification */}
      {
        toast.visible && (
          <div className="toast-notification">
            <span className="toast-message">{toast.message}</span>
          </div>
        )
      }
    </div >
  )
}

export default App
