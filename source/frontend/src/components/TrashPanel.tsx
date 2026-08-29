import React from 'react'
import { X, Trash2, RotateCcw, AlertTriangle, ChevronLeft } from 'lucide-react'
import './TrashPanel.css'

interface TrashItem {
    id: string
    name: string
    path: string
    originalPath: string
    deletedAt: string
    size: number
    fileCount?: number
    thumbnailUrl?: string
    type: 'file' | 'folder'
    trashPath?: string
}

interface TrashPanelProps {
    isOpen: boolean
    onClose: () => void
    trashItems: TrashItem[]
    onRestore: (trashID: string, originalPath: string) => void
    onRestoreAll: () => void
    onEmptyTrash: () => void
    onScanFolder?: (path: string) => Promise<any>
    t: (key: string) => string  // Translation function
}

const TrashItemThumbnail = ({ item, isInsideFolder, onRestore }: { item: TrashItem, isInsideFolder: boolean, onRestore: (id: string, path: string) => void }) => {
    const [thumbUrl, setThumbUrl] = React.useState<string | null>(item.thumbnailUrl || null)

    React.useEffect(() => {
        if (!item.thumbnailUrl && item.type === 'file' && /\.(jpg|jpeg|png|gif|webp|bmp|tiff|svg)$/i.test(item.name)) {
            const loadThumb = async () => {
                try {
                    // Dynamic import to avoid build issues if function missing in types yet
                    const { GetTrashThumbnail } = await import('../wailsjs/go/main/App')
                    const url = await GetTrashThumbnail(item.trashPath || '')
                    setThumbUrl(url)
                } catch (e) {
                    // console.error("Failed to load thumb", e)
                }
            }
            loadThumb()
        }
    }, [item])

    return (
        <div className="trash-item-thumbnail">
            {thumbUrl ? (
                <img src={thumbUrl} alt={item.name} loading="lazy" />
            ) : (
                <div className="trash-item-placeholder">
                    {item.type === 'folder' ? '📁' : <Trash2 size={24} />}
                </div>
            )}
            {!isInsideFolder && (
                <button
                    className="trash-restore-overlay-btn"
                    onClick={(e) => {
                        e.stopPropagation()
                        onRestore(item.id, item.originalPath)
                    }}
                    title="Restore"
                >
                    <RotateCcw size={16} />
                </button>
            )}
        </div>
    )
}

const TrashPanel: React.FC<TrashPanelProps> = ({
    isOpen,
    onClose,
    trashItems: initialTrashItems,
    onRestore,
    onRestoreAll,
    onEmptyTrash,
    onScanFolder,
    t
}) => {
    const [viewStack, setViewStack] = React.useState<{ name: string, path: string, items: TrashItem[] }[]>([])
    const [currentItems, setCurrentItems] = React.useState<TrashItem[]>(initialTrashItems)

    React.useEffect(() => {
        if (!isOpen) {
            setViewStack([])
        }
    }, [isOpen])

    React.useEffect(() => {
        if (viewStack.length === 0) {
            setCurrentItems(initialTrashItems)
        }
    }, [initialTrashItems, viewStack.length])

    if (!isOpen) return null

    const handleFolderDoubleClick = async (item: TrashItem) => {
        if (item.type !== 'folder' || !item.trashPath || !onScanFolder) return

        try {
            const content = await onScanFolder(item.trashPath)
            const newView = {
                name: item.name,
                path: item.trashPath,
                items: content.files.map((f: any) => ({
                    ...f,
                    type: 'file',
                    originalPath: f.path, // In this context, originalPath isn't strictly used for restore of inner files yet
                    id: f.id || f.path
                }))
            }
            setViewStack(prev => [...prev, newView])
            setCurrentItems(newView.items)
        } catch (error) {
            console.error('Failed to enter folder:', error)
        }
    }

    const handleBack = () => {
        setViewStack(prev => {
            const nextStack = prev.slice(0, -1)
            if (nextStack.length === 0) {
                setCurrentItems(initialTrashItems)
            } else {
                setCurrentItems(nextStack[nextStack.length - 1].items)
            }
            return nextStack
        })
    }

    const formatDate = (dateStr: string) => {
        if (!dateStr) return ''
        const date = new Date(dateStr)
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
    }

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 Bytes'
        const k = 1024
        const sizes = ['Bytes', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
    }

    const isInsideFolder = viewStack.length > 0
    const currentFolderName = isInsideFolder ? viewStack[viewStack.length - 1].name : null

    return (
        <div className="trash-panel-overlay" onClick={onClose}>
            <div className="trash-panel" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="trash-panel-header">
                    <div className="trash-panel-title">
                        {isInsideFolder ? (
                            <button className="btn-icon btn-back" onClick={handleBack} title="Back to main Trash">
                                <ChevronLeft size={20} />
                            </button>
                        ) : (
                            <Trash2 size={20} className="trash-header-icon" />
                        )}
                        <h2>
                            {isInsideFolder ? currentFolderName : t('labels.trash')}
                            {!isInsideFolder && <span className="trash-count-badge">({initialTrashItems?.length || 0})</span>}
                        </h2>
                    </div>
                    <button className="btn-icon" onClick={onClose} title="Close (ESC)">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="trash-panel-content">
                    {!currentItems || currentItems.length === 0 ? (
                        <div className="trash-empty-state">
                            <div className="trash-empty-icon-container">
                                <Trash2 size={64} className="trash-empty-icon" />
                                <div className="trash-empty-icon-ring"></div>
                            </div>
                            <h3>No items here</h3>
                            <p>{isInsideFolder ? 'This folder is empty' : 'Deleted files and folders will appear here'}</p>
                        </div>
                    ) : (
                        <>
                            <div className="trash-actions-bar">
                                <span className="trash-info">
                                    {isInsideFolder ? (
                                        `Viewing contents of ${currentFolderName}`
                                    ) : (
                                        `${initialTrashItems?.length || 0} item${initialTrashItems?.length !== 1 ? 's' : ''}`
                                    )}
                                </span>
                                {!isInsideFolder && initialTrashItems?.length > 0 && (
                                    <div className="trash-actions-group">
                                        <button
                                            className="btn btn-primary"
                                            onClick={onRestoreAll}
                                            title={t('buttons.restoreAll')}
                                        >
                                            <RotateCcw size={16} />
                                            {t('buttons.restoreAll')}
                                        </button>
                                        <button
                                            className="btn btn-danger"
                                            onClick={onEmptyTrash}
                                            title={t('buttons.emptyTrash')}
                                        >
                                            <AlertTriangle size={16} />
                                            {t('buttons.emptyTrash')}
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Trash Items Grid */}
                            <div className="trash-items-grid">
                                {currentItems.map((item) => (
                                    <div
                                        key={item.id}
                                        className={`trash-item ${item.type === 'folder' ? 'trash-item-folder' : ''}`}
                                        onDoubleClick={() => handleFolderDoubleClick(item)}
                                    >
                                        <TrashItemThumbnail
                                            item={item}
                                            isInsideFolder={isInsideFolder}
                                            onRestore={onRestore}
                                        />

                                        <div className="trash-item-info">
                                            <div className="trash-item-name-row">
                                                <div className="trash-item-name" title={item.name}>
                                                    {item.name}
                                                </div>
                                            </div>
                                            <div className="trash-item-meta">
                                                <span className="trash-item-size">{formatBytes(item.size)}</span>
                                                {item.type === 'folder' && item.fileCount !== undefined && (
                                                    <>
                                                        <span className="folder-divider-dot">•</span>
                                                        <span className="trash-item-count">{item.fileCount} files</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

export default TrashPanel
