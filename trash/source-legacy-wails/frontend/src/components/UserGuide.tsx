import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Sparkles, Zap, Trash2, Layout, Sliders, ShieldCheck, Heart } from 'lucide-react'
import './UserGuide.css'
import specialImage from '../assets/1.jpeg'

const UserGuide: React.FC = () => {
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['getting-started', 'ai-features']))
    const [password, setPassword] = useState('')
    const [showSecret, setShowSecret] = useState(false)

    const toggleSection = (sectionId: string) => {
        const newExpanded = new Set(expandedSections)
        if (newExpanded.has(sectionId)) {
            newExpanded.delete(sectionId)
        } else {
            newExpanded.add(sectionId)
        }
        setExpandedSections(newExpanded)
    }

    const checkPassword = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value
        setPassword(val)
        if (val.toLowerCase() === 'intanku' || val === '25052025') {
            setShowSecret(true)
        }
    }

    const shortcuts = [
        {
            category: 'File Operations', items: [
                { key: 'Ctrl+O', action: 'Open/Scan folder' },
                { key: 'Delete / B', action: 'Move to trash' },
                { key: 'Space', action: 'Preview image' },
                { key: 'Shift+R', action: 'Batch rename' },
            ]
        },
        {
            category: 'Folder Management', items: [
                { key: 'Ctrl+N', action: 'Create new folder' },
                { key: '1-9', action: 'Move to folder (follows sidebar order)' },
                { key: '`', action: 'Move back to root' },
                { key: 'Alt + Drag', action: 'Reorder sidebar folders' },
            ]
        },
        {
            category: 'View Controls', items: [
                { key: 'Ctrl+H', action: 'Toggle sidebar' },
                { key: 'Ctrl++ / Ctrl+=', action: 'Increase thumb size' },
                { key: 'Ctrl+-', action: 'Decrease thumb size' },
                { key: '[', action: 'Switch to Grid view' },
                { key: ']', action: 'Switch to List view' },
                { key: 'Ctrl+,', action: 'Open Settings' },
                { key: 'T', action: 'Toggle Trash panel' },
                { key: 'F', action: 'Toggle Fullscreen' },
            ]
        },
        {
            category: 'AI Grouping', items: [
                { key: 'Ctrl+G', action: 'AI Group files by content' },
            ]
        },
        {
            category: 'Preview Mode', items: [
                { key: 'V', action: 'Toggle Fit to Window' },
                { key: 'L / R', action: 'Rotate image' },
                { key: '+ / -', action: 'Zoom In/Out' },
                { key: '0', action: 'Reset Zoom/Rotation' },
                { key: '1:1', action: 'Zoom to 90%' },
                { key: 'Space', action: 'Toggle Info panel' },
                { key: 'Esc', action: 'Close preview' },
            ]
        },
        {
            category: 'Selection Tools', items: [
                { key: 'Ctrl+A', action: 'Select all' },
                { key: 'Shift+V', action: 'Selection mode' },
                { key: 'V', action: 'Toggle focus item' },
                { key: 'Arrows', action: 'Navigate focused item' },
                { key: 'X', action: 'Clear selection' },
            ]
        },
        {
            category: 'Global & Undo', items: [
                { key: 'Ctrl+Z', action: 'Undo last action' },
                { key: 'Ctrl+Shift+Z', action: 'Redo action' },
                { key: 'Shift+Alt+T', action: 'Restore all trash' },
                { key: 'Shift+T', action: 'Empty trash' },
                { key: 'Alt+X', action: 'Exit application' },
            ]
        },
    ]

    return (
        <div className="user-guide">
            <div className="guide-header">
                <h2>User Guide <span className="version-badge">v4.7.1</span></h2>
                <p>Master PhotoSort for professional image organization</p>
            </div>

            <div className="guide-sections">
                {/* Getting Started */}
                <div className="guide-section">
                    <div className="section-header" onClick={() => toggleSection('getting-started')}>
                        {expandedSections.has('getting-started') ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <Layout size={16} style={{ color: 'var(--color-primary)' }} />
                        <h3>Getting Started</h3>
                    </div>
                    {expandedSections.has('getting-started') && (
                        <div className="section-content">
                            <ol>
                                <li>
                                    <strong>Scan a folder:</strong> Press <code>Ctrl+O</code> to select a directory. PhotoSort handles thousands of files with ease.
                                </li>
                                <li>
                                    <strong>Create folders:</strong> Press <code>Ctrl+N</code> to build your destination hierarchy in the sidebar.
                                </li>
                                <li>
                                    <strong>Rapid Sorting:</strong> Select files and press <code>1-9</code>. Files move instantly to the folder at that sidebar position.
                                </li>
                                <li>
                                    <strong>Smart Previews:</strong> Press <code>Space</code> for high-definition previews. Use <code>1:1</code> for a detailed 90% zoom check.
                                </li>
                            </ol>
                        </div>
                    )}
                </div>

                {/* AI Features */}
                <div className="guide-section ai-section">
                    <div className="section-header" onClick={() => toggleSection('ai-features')}>
                        {expandedSections.has('ai-features') ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <Sparkles size={16} style={{ color: '#8b5cf6' }} />
                        <h3>AI Power</h3>
                    </div>
                    {expandedSections.has('ai-features') && (
                        <div className="section-content">
                            <p>PhotoSort uses visual similarity to understand your photos and group them logically.</p>
                            <h4>AI Grouping (Ctrl+G):</h4>
                            <p>Once triggered, the AI analyzes visual similarity to categorize images into groups in the sidebar.</p>
                            <ul>
                                <li><strong>How it works:</strong> Click "AI Group" button or press Ctrl+G to automatically scan all images and group them by content.</li>
                                <li><strong>Smart Naming:</strong> Groups are automatically named based on their order (e.g., "Grup (1)", "Grup (2)").</li>
                            </ul>
                        </div>
                    )}
                </div>

                {/* Performance & Cache */}
                <div className="guide-section">
                    <div className="section-header" onClick={() => toggleSection('performance')}>
                        {expandedSections.has('performance') ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <Zap size={16} style={{ color: '#eab308' }} />
                        <h3>Performance & Storage</h3>
                    </div>
                    {expandedSections.has('performance') && (
                        <div className="section-content">
                            <p>PhotoSort generates high-speed thumbnails to allow lag-free scrolling through large collections.</p>
                            <ul>
                                <li><strong>Scratch Disk:</strong> Change the cache location in Settings if your main drive is full.</li>
                                <li><strong>Auto-Cleanup:</strong> Enable "Auto-delete thumbnails on exit" in Settings to automatically free storage when you finish working.</li>
                            </ul>
                        </div>
                    )}
                </div>

                {/* Keyboard Shortcuts */}
                <div className="guide-section">
                    <div className="section-header" onClick={() => toggleSection('shortcuts')}>
                        {expandedSections.has('shortcuts') ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <Sliders size={16} />
                        <h3>Pro Keyboard Shortcuts</h3>
                    </div>
                    {expandedSections.has('shortcuts') && (
                        <div className="section-content">
                            {shortcuts.map((category) => (
                                <div key={category.category} className="shortcut-category">
                                    <h4>{category.category}</h4>
                                    <table className="shortcuts-table">
                                        <tbody>
                                            {category.items.map((item, idx) => (
                                                <tr key={idx}>
                                                    <td className="shortcut-key"><code>{item.key}</code></td>
                                                    <td className="shortcut-action">{item.action}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Safety & Undo */}
                <div className="guide-section">
                    <div className="section-header" onClick={() => toggleSection('safety')}>
                        {expandedSections.has('safety') ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <ShieldCheck size={16} style={{ color: '#22c55e' }} />
                        <h3>Safety First</h3>
                    </div>
                    {expandedSections.has('safety') && (
                        <div className="section-content">
                            <p>Your original files are always protected:</p>
                            <ul>
                                <li><strong>Trash Support:</strong> Deleted files move to an internal Trash panel (Press <code>T</code>).</li>
                                <li><strong>Global Undo (Ctrl+Z):</strong> Accidentally moved a file? Undo it instantly.</li>
                                <li><strong>Non-Destructive AI:</strong> AI suggestions never move files without your confirmation.</li>
                            </ul>
                        </div>
                    )}
                </div>

                {/* Secret Section */}
                <div className="guide-section secret-section">
                    <div className="section-header" onClick={() => toggleSection('secret')}>
                        {expandedSections.has('secret') ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <Heart size={16} style={{ color: '#ec4899' }} />
                        <h3>Special For You</h3>
                    </div>
                    {expandedSections.has('secret') && (
                        <div className="section-content">
                            {!showSecret ? (
                                <div className="password-box">
                                    <p>Masukin sandi dulu ya sayang: </p>
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={checkPassword}
                                        placeholder="..."
                                        style={{
                                            background: 'var(--bg-tertiary)',
                                            border: '1px solid var(--border-color)',
                                            color: 'var(--text-primary)',
                                            padding: '4px 8px',
                                            borderRadius: '4px',
                                            marginTop: '8px'
                                        }}
                                    />
                                </div>
                            ) : (
                                <div className="secret-message" style={{
                                    display: 'flex',
                                    gap: '24px',
                                    alignItems: 'center',
                                    animation: 'fadeIn 1s ease',
                                    padding: '16px',
                                    background: 'rgba(236, 72, 153, 0.05)',
                                    borderRadius: '12px'
                                }}>
                                    <img
                                        src={specialImage}
                                        alt="Special"
                                        style={{
                                            width: '180px',
                                            height: '180px',
                                            objectFit: 'cover',
                                            borderRadius: '50%',
                                            boxShadow: '0 10px 30px rgba(236, 72, 153, 0.2)',
                                            border: '4px solid white'
                                        }}
                                    />
                                    <div className="message-text" style={{ flex: 1, textAlign: 'left' }}>
                                        <p style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--text-primary)', margin: 0 }}>
                                            Hai hai, my love... a.k.a Intan Sriwedari! ❤️<br /><br />
                                            Aplikasi ini aku bikin khusus buat kamu… biar foto-foto yang bejibun itu nggak bikin pusing lagi. Jadi semuanya rapi, cantik, dan teratur - kayak kamu di hidup aku. [haha]<br /><br />
                                            Semoga tiap kali kamu pakai ini, kamu keinget kalau ada aku yang selalu siap bantuin kamu (dan nemenin kamu juga 😉). Hope you like it, bebe ✨
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default UserGuide
