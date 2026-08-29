import React, { useEffect, useRef } from 'react'
import { Settings, RefreshCw, Info } from 'lucide-react'
import './ContextMenu.css'

interface ContextMenuProps {
    x: number
    y: number
    onClose: () => void
    onOptionSelect: (option: string) => void
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, onOptionSelect }) => {
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose()
            }
        }

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose()
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        document.addEventListener('keydown', handleEscape)

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
            document.removeEventListener('keydown', handleEscape)
        }
    }, [onClose])

    const handleSelect = (option: string) => {
        onOptionSelect(option)
        onClose()
    }

    return (
        <div
            ref={menuRef}
            className="context-menu"
            style={{ left: `${x}px`, top: `${y}px` }}
            onContextMenu={(e) => e.preventDefault()}
        >
            <div className="context-menu-item" onClick={() => handleSelect('settings')}>
                <Settings size={14} />
                <span>Options</span>
            </div>
            <div className="context-menu-item" onClick={() => handleSelect('refresh')}>
                <RefreshCw size={14} />
                <span>Refresh View</span>
            </div>
            <div className="context-menu-divider" />
            <div className="context-menu-item" onClick={() => handleSelect('about')}>
                <Info size={14} />
                <span>About PhotoSort</span>
            </div>
        </div>
    )
}

export default ContextMenu
