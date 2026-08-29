# PhotoSort Enhancement - Product Requirements Document (PRD)

**Version:** 2.0  
**Date:** February 3, 2026  
**Status:** Planning Phase  
**Author:** Development Team

---

## Executive Summary

This PRD outlines comprehensive enhancements to the PhotoSort desktop application, addressing critical bugs, implementing new UI/UX features, and expanding functionality to improve user experience and productivity. The enhancements focus on interface customization, keyboard shortcuts, folder management reliability, and settings expansion.

---

## Current State Analysis

### Application Overview
- **Tech Stack:** Wails v2 (Go backend + React/TypeScript frontend)
- **Current Version:** 1.0.0 (Production Ready - 95% complete)
- **TypeScript Status:** ✅ Already installed and configured (v5.2.2)
- **Build Tool:** Vite 5.1.4

### Identified Issues

#### 🐛 Critical Bugs
1. **Folder Duplication Issue**
   - When moving images via shortcuts (1-9) or drag-and-drop, folders get duplicated
   - Deleted folders remain visible in sidebar
   - Root cause: Folder state management and refresh logic issues

2. **Trash Functionality**
   - Trash button exists but restoration feature is not implemented
   - Backend has `GetTrashItems()` and `RestoreFromTrash()` but no UI integration

3. **Folder Deletion Logic**
   - Inconsistent folder removal from state
   - No proper cleanup after folder operations

#### 🎨 UI/UX Gaps
1. No sidebar resize or hide functionality
2. No image preview size controls
3. Folder hover effects need improvement
4. Missing user guide in Settings

---

## Requirements

### 1. UI/UX Enhancements

#### 1.1 Resizable & Collapsible Sidebar

**User Story:**  
*As a user, I want to resize or hide the sidebar to maximize my workspace for viewing images.*

**Requirements:**
- [ ] Add draggable resize handle between sidebar and main content
- [ ] Implement collapse/expand toggle button in sidebar header
- [ ] Persist sidebar width in user settings
- [ ] Minimum width: 200px, Maximum width: 500px
- [ ] Smooth animation for collapse/expand (200ms)
- [ ] Icon indicator for collapsed state

**Technical Specifications:**
- Use CSS `resize` property with custom handle
- Store `sidebarWidth` and `sidebarCollapsed` in `AppSettings`
- Add `ResizablePanel` component with drag handlers
- Update `App.css` with responsive grid layout

**Acceptance Criteria:**
- ✓ User can drag sidebar edge to resize
- ✓ Click icon to collapse sidebar to 50px width
- ✓ Sidebar state persists across sessions
- ✓ Smooth transitions without layout jank

---

#### 1.2 Image Preview Size Slider

**User Story:**  
*As a user, I want to adjust thumbnail/preview sizes to see more or fewer images at once.*

**Requirements:**
- [ ] Add slider control in header toolbar
- [ ] Range: 100px - 400px (default: 200px)
- [ ] Real-time grid adjustment as slider moves
- [ ] Keyboard shortcuts: `Ctrl+Plus` (increase), `Ctrl+Minus` (decrease)
- [ ] Visual feedback showing current size (e.g., "200px")
- [ ] Persist size preference in settings

**Technical Specifications:**
- Add `<input type="range">` with custom styling
- Update CSS grid `grid-template-columns` dynamically
- Debounce slider changes (100ms) for performance
- Increment/decrement by 20px per keyboard shortcut

**Acceptance Criteria:**
- ✓ Slider adjusts thumbnail size in real-time
- ✓ Keyboard shortcuts work as expected
- ✓ Grid layout responds smoothly
- ✓ Size preference saved to settings

---

### 2. Trash & Restoration Feature

**User Story:**  
*As a user, I want to view deleted items and restore them if needed.*

**Requirements:**
- [ ] Add "Trash" button in sidebar (below folders section)
- [ ] Show trash item count badge
- [ ] Implement trash panel/modal showing deleted items
- [ ] Display item name, deletion date, original path
- [ ] Add "Restore" button for each item
- [ ] Add "Empty Trash" button with confirmation
- [ ] Show preview thumbnails for deleted images

**Technical Specifications:**
- Use existing backend methods:
  - `GetTrashItems()` - fetch trash contents
  - `RestoreFromTrash(trashID, restorePath)` - restore item
  - `EmptyTrash()` - permanently delete all
- Create `TrashPanel` component
- Add trash icon with count badge in sidebar
- Implement restore confirmation dialog

**Acceptance Criteria:**
- ✓ Trash panel opens showing all deleted items
- ✓ User can restore individual items
- ✓ Restored items appear back in original location
- ✓ Empty trash permanently deletes all items
- ✓ Trash count updates in real-time

---

### 3. Keyboard Shortcuts Enhancement

**User Story:**  
*As a power user, I want comprehensive keyboard shortcuts for efficient workflow.*

#### 3.1 New Shortcuts

| Shortcut | Action | Status |
|----------|--------|--------|
| `Ctrl+X` | Exit/Close application | ❌ New |
| `Ctrl+Plus` / `Ctrl+=` | Increase preview size | ❌ New |
| `Ctrl+Minus` / `Ctrl+-` | Decrease preview size | ❌ New |
| `O` | Open Options/Settings | ❌ New |
| `Ctrl+H` | Toggle sidebar visibility | ❌ New |
| `T` | Open Trash panel | ❌ New |

#### 3.2 Existing Shortcuts (Keep)
- `Ctrl+O` - Open/Scan folder
- `Ctrl+N` - Create new folder
- `Ctrl+G` - AI Group files
- `Ctrl+S` - Save project
- `Ctrl+Z` - Undo
- `Ctrl+Y` - Redo
- `1-9` - Move to folder
- `Space` - Preview image
- `Delete` / `B` - Move to trash

**Technical Specifications:**
- Update keyboard event handler in `App.tsx`
- Add `Ctrl+X` to call Wails `runtime.Quit()`
- Implement zoom shortcuts with bounds checking
- Add `O` key to toggle settings panel
- Create shortcuts help modal (`?` key)

**Acceptance Criteria:**
- ✓ All new shortcuts work as documented
- ✓ No conflicts with existing shortcuts
- ✓ Shortcuts work in all application states
- ✓ Help modal shows all available shortcuts

---

### 4. Folder Management Improvements

**User Story:**  
*As a user, I want reliable folder management without duplicates or ghost folders.*

#### 4.1 Bug Fixes

**Issue:** Folder duplication when moving files via shortcuts/drag-drop

**Root Cause Analysis:**
- `CreateFolder` generates non-unique IDs using `os.Getpid()`
- Folder state not properly synchronized after operations
- `refreshFolderStats()` may create duplicate entries

**Solution:**
- [ ] Fix folder ID generation to use UUID or timestamp-based unique IDs
- [ ] Implement proper folder deduplication in state updates
- [ ] Add folder existence check before adding to state
- [ ] Ensure `refreshFolderStats()` updates existing folders, not creates new ones

**Technical Changes:**
```go
// folder.go - Line 25
ID: fmt.Sprintf("folder_%d_%s", time.Now().UnixNano(), hashString(folderPath))
```

```typescript
// App.tsx - refreshFolderStats()
// Use Map to deduplicate by path
const folderMap = new Map(folders.map(f => [f.path, f]))
updatedFolders.forEach(f => folderMap.set(f.path, f))
setFolders(Array.from(folderMap.values()))
```

#### 4.2 Folder Deletion Improvements

**Requirements:**
- [ ] Immediately remove folder from UI state after deletion
- [ ] Clear any references in `folderOrder` array
- [ ] Update shortcuts for remaining folders
- [ ] Show confirmation with file count
- [ ] Prevent deletion of folders with files (optional setting)

**Acceptance Criteria:**
- ✓ Deleted folders disappear immediately from sidebar
- ✓ No ghost folders remain after deletion
- ✓ Folder shortcuts renumber correctly
- ✓ Undo restores folder properly

---

### 5. Enhanced Folder Hover Effects

**User Story:**  
*As a user, I want clear visual feedback when hovering over folders.*

**Current State:**
```css
.folder-item:hover {
  background: rgba(255, 255, 255, 0.05);
}
```

**Enhanced Design:**
```css
.folder-item {
  transition: all 0.2s ease;
}

.folder-item:hover {
  background: rgba(255, 255, 255, 0.12);
  transform: translateX(4px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.folder-item:hover .folder-name {
  color: #fff;
  font-weight: 500;
}
```

**Requirements:**
- [ ] Increase background brightness on hover
- [ ] Add subtle slide animation (4px right)
- [ ] Add shadow for depth
- [ ] Brighten folder name text
- [ ] Smooth 200ms transition

**Acceptance Criteria:**
- ✓ Hovered folder is clearly distinguishable
- ✓ Animation is smooth and not jarring
- ✓ Works in both light and dark themes

---

### 6. Settings Panel Upgrade

**User Story:**  
*As a user, I want to customize my interface font and access comprehensive settings easily.*

#### 6.1 Font Selection

**Requirements:**
- [ ] Add "Interface Font" section in Settings
- [ ] Provide exactly 3 font options:
  1. **System Default** (Segoe UI / San Francisco)
  2. **Inter** (Modern, clean)
  3. **Roboto Mono** (Monospace, technical)
- [ ] Apply font globally to entire application
- [ ] Persist font choice in settings

**Technical Implementation:**
```typescript
// Add to AppSettings
interface AppSettings {
  // ... existing
  interfaceFont: 'system' | 'inter' | 'roboto-mono'
}

// CSS
:root[data-font="system"] { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
:root[data-font="inter"] { font-family: 'Inter', sans-serif; }
:root[data-font="roboto-mono"] { font-family: 'Roboto Mono', monospace; }
```

**Font Loading:**
```html
<!-- index.html -->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
```

#### 6.2 Settings Access Shortcuts

**Requirements:**
- [ ] Keyboard shortcut: `O` key opens Settings
- [ ] Right-click context menu anywhere in app
- [ ] Context menu shows "Options" item
- [ ] Existing `Ctrl+,` shortcut remains

**Context Menu Items:**
- Options (Settings)
- Refresh View
- About PhotoSort

**Technical Implementation:**
- Add `onContextMenu` handler to main app container
- Create `ContextMenu` component
- Position menu at cursor coordinates

---

### 7. User Guide Integration

**User Story:**  
*As a new user, I want an in-app guide to learn features quickly.*

**Requirements:**
- [ ] Add "User Guide" tab in Settings panel
- [ ] Include sections:
  - **Getting Started** - Quick start workflow
  - **Keyboard Shortcuts** - Complete shortcut list
  - **AI Grouping** - How it works
  - **Tips & Tricks** - Power user features
  - **Troubleshooting** - Common issues
- [ ] Searchable content
- [ ] Copy-friendly code snippets
- [ ] Video tutorials (optional, future)

**Content Structure:**
```markdown
# User Guide

## Getting Started
1. Scan a folder (Ctrl+O)
2. Create folders (Ctrl+N)
3. Sort files using shortcuts (1-9)
...

## Keyboard Shortcuts
[Interactive table with search]

## AI Grouping
[Explanation with examples]
```

**Technical Implementation:**
- Create `UserGuide.tsx` component
- Use markdown renderer (e.g., `react-markdown`)
- Add search functionality with fuzzy matching
- Collapsible sections for better navigation

---

## Recommended Additional Features

### 8.1 🎯 Smart Filters & Search

**Priority:** High  
**Effort:** Medium

**Features:**
- Filter by file type (images, videos, documents)
- Filter by date range
- Filter by file size
- Advanced search with regex support
- Save custom filter presets

**Business Value:**
- Faster file location
- Better organization for large libraries
- Reduced manual sorting time

---

### 8.2 📊 Batch Operations

**Priority:** High  
**Effort:** Medium

**Features:**
- Batch rename with advanced patterns (date, sequence, metadata)
- Batch resize images
- Batch convert formats
- Batch EXIF data editing
- Batch tag assignment

**Business Value:**
- Massive time savings for bulk operations
- Professional workflow support
- Competitive advantage

---

### 8.3 🔄 Auto-Sort Rules

**Priority:** Medium  
**Effort:** High

**Features:**
- Create rules: "If filename contains X, move to folder Y"
- Date-based auto-sorting
- File size-based rules
- AI-suggested rules based on patterns
- Rule templates library

**Business Value:**
- Automation reduces manual work
- Consistent organization
- Learning curve reduction

---

### 8.4 🎨 Theme Customization

**Priority:** Low  
**Effort:** Low

**Features:**
- Custom color schemes
- Accent color picker
- Light/Dark/Auto mode
- High contrast mode
- Preset themes (Nord, Dracula, Solarized)

**Business Value:**
- Personalization increases engagement
- Accessibility improvements
- Brand differentiation

---

### 8.5 📱 Cloud Sync & Backup

**Priority:** Medium  
**Effort:** Very High

**Features:**
- Auto-backup projects to cloud (Google Drive, Dropbox)
- Sync settings across devices
- Collaborative sorting (multi-user)
- Version history for projects

**Business Value:**
- Data safety
- Cross-device workflow
- Team collaboration potential
- Subscription revenue opportunity

---

### 8.6 🔍 Duplicate Detection

**Priority:** High  
**Effort:** Medium

**Features:**
- Visual duplicate detection (perceptual hash)
- Exact duplicate detection (MD5/SHA)
- Similar image grouping
- One-click duplicate removal
- Keep best quality option

**Business Value:**
- Saves storage space
- Cleans up libraries
- Highly requested feature

---

### 8.7 📈 Analytics Dashboard

**Priority:** Low  
**Effort:** Medium

**Features:**
- Files sorted statistics
- Time saved metrics
- Storage space recovered
- Most used folders
- Sorting speed over time

**Business Value:**
- User engagement through gamification
- Demonstrates value proposition
- Marketing material

---

### 8.8 🎬 Video Preview Support

**Priority:** Medium  
**Effort:** Medium

**Features:**
- Video thumbnail generation
- Hover to play preview
- Full video player in preview modal
- Frame extraction
- Video metadata display

**Business Value:**
- Expands use cases beyond photos
- Competitive feature
- User retention

---

### 8.9 🏷️ Tagging System

**Priority:** Medium  
**Effort:** Medium

**Features:**
- Add custom tags to files
- Tag-based filtering
- Tag autocomplete
- Tag color coding
- Tag hierarchy (parent/child tags)

**Business Value:**
- Flexible organization beyond folders
- Power user feature
- Better search capabilities

---

### 8.10 ⚡ Performance Optimizations

**Priority:** High  
**Effort:** Medium

**Features:**
- Virtual scrolling for 10,000+ files
- Lazy loading thumbnails
- Web Workers for AI processing
- Thumbnail caching improvements
- Database indexing for faster search

**Business Value:**
- Handles larger libraries
- Smoother user experience
- Competitive advantage

---

## Implementation Phases

### Phase 1: Critical Bugs & Core UX (Week 1-2)
**Priority:** P0 - Must Have

- [ ] Fix folder duplication bug
- [ ] Fix folder deletion logic
- [ ] Implement resizable sidebar
- [ ] Add image preview size slider
- [ ] Add keyboard shortcuts (Ctrl+X, Ctrl+Plus/Minus, O)
- [ ] Improve folder hover effects

**Success Metrics:**
- Zero folder duplication reports
- 100% folder deletion success rate
- Sidebar resize works smoothly

---

### Phase 2: Trash & Settings (Week 3)
**Priority:** P1 - Should Have

- [ ] Implement trash panel UI
- [ ] Connect trash restoration backend
- [ ] Add font selection to Settings
- [ ] Create user guide content
- [ ] Implement context menu (right-click)

**Success Metrics:**
- Users can restore deleted files
- Settings panel has all requested features
- User guide covers all features

---

### Phase 3: Polish & Testing (Week 4)
**Priority:** P2 - Nice to Have

- [ ] Comprehensive testing of all features
- [ ] Performance optimization
- [ ] Bug fixes from testing
- [ ] Documentation updates
- [ ] User acceptance testing

**Success Metrics:**
- All tests passing
- No critical bugs
- User feedback positive

---

### Phase 4: Additional Features (Future)
**Priority:** P3 - Future Enhancements

- [ ] Duplicate detection
- [ ] Batch operations expansion
- [ ] Auto-sort rules
- [ ] Video preview support
- [ ] Cloud sync

**Success Metrics:**
- Feature adoption rate > 40%
- User retention increase
- Positive reviews

---

## Technical Specifications

### Frontend Changes

#### New Components
1. **ResizableSidebar.tsx** - Draggable sidebar with collapse
2. **ImageSizeSlider.tsx** - Preview size control
3. **TrashPanel.tsx** - Trash management UI
4. **ContextMenu.tsx** - Right-click menu
5. **UserGuide.tsx** - In-app documentation
6. **FontSelector.tsx** - Font picker component

#### State Management Updates
```typescript
interface AppSettings {
  // Existing...
  sidebarWidth: number          // 200-500px
  sidebarCollapsed: boolean     // true/false
  thumbnailSize: number         // 100-400px
  interfaceFont: 'system' | 'inter' | 'roboto-mono'
}
```

#### CSS Enhancements
- Add CSS custom properties for dynamic sizing
- Implement smooth transitions
- Responsive grid layouts
- Theme-aware hover states

---

### Backend Changes

#### Go Files to Modify

**folder.go**
```go
// Fix ID generation (Line 25)
ID: fmt.Sprintf("folder_%d_%s", time.Now().UnixNano(), hashString(folderPath))

// Add folder deduplication helper
func deduplicateFolders(folders []FolderInfo) []FolderInfo {
    seen := make(map[string]bool)
    result := []FolderInfo{}
    for _, f := range folders {
        if !seen[f.Path] {
            seen[f.Path] = true
            result = append(result, f)
        }
    }
    return result
}
```

**app.go**
```go
// Add new settings fields
type AppSettings struct {
    // ... existing fields
    SidebarWidth     int    `json:"sidebarWidth"`
    SidebarCollapsed bool   `json:"sidebarCollapsed"`
    ThumbnailSize    int    `json:"thumbnailSize"`
    InterfaceFont    string `json:"interfaceFont"`
}

// Update defaults
func DefaultSettings() AppSettings {
    return AppSettings{
        // ... existing
        SidebarWidth:     280,
        SidebarCollapsed: false,
        ThumbnailSize:    200,
        InterfaceFont:    "system",
    }
}
```

**main.go**
```go
// Add Quit method for Ctrl+X
func (a *App) QuitApplication() {
    runtime.Quit(a.ctx)
}
```

---

## Testing Strategy

### Unit Tests
- [ ] Folder ID generation uniqueness
- [ ] Folder deduplication logic
- [ ] Settings persistence
- [ ] Keyboard shortcut handlers

### Integration Tests
- [ ] Folder create → move files → delete workflow
- [ ] Trash → restore workflow
- [ ] Settings save → reload → verify
- [ ] Sidebar resize → persist → reload

### User Acceptance Tests
- [ ] All keyboard shortcuts work
- [ ] Folder operations don't duplicate
- [ ] Trash restoration works correctly
- [ ] UI is responsive and smooth

### Performance Tests
- [ ] 1000+ files: grid rendering < 1s
- [ ] Sidebar resize: no lag
- [ ] Settings save: < 100ms
- [ ] Thumbnail loading: progressive

---

## Success Metrics

### Quantitative
- **Bug Resolution:** 0 folder duplication incidents
- **Feature Adoption:** 80%+ users use sidebar resize
- **Performance:** < 2s app startup time
- **User Satisfaction:** 4.5+ star rating

### Qualitative
- Users report smoother workflow
- Positive feedback on keyboard shortcuts
- Reduced support tickets for folder issues
- Increased daily active usage

---

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Folder state sync issues | High | Medium | Comprehensive testing, state audit logs |
| Performance degradation | Medium | Low | Virtual scrolling, lazy loading |
| Keyboard shortcut conflicts | Low | Medium | Configurable shortcuts (future) |
| Settings migration issues | Medium | Low | Version-aware settings loader |
| TypeScript build errors | Low | Low | Already installed, tested |

---

## Dependencies

### External Libraries (New)
- `react-markdown` - User guide rendering
- `react-resizable-panels` - Sidebar resize (optional)

### System Requirements
- Windows 10/11
- WebView2 Runtime
- 4GB RAM minimum
- 100MB disk space

---

## Appendix

### A. Keyboard Shortcuts Reference

| Category | Shortcut | Action |
|----------|----------|--------|
| **File Operations** | | |
| | Ctrl+O | Open/Scan folder |
| | Ctrl+S | Save project |
| | Delete / B | Move to trash |
| | Space | Preview image |
| **Folder Management** | | |
| | Ctrl+N | Create new folder |
| | Ctrl+R | Rename folder |
| | 1-9 | Move to folder |
| **View Controls** | | |
| | Ctrl+Plus | Increase preview size |
| | Ctrl+Minus | Decrease preview size |
| | Ctrl+H | Toggle sidebar |
| **AI & Tools** | | |
| | Ctrl+G | AI Group files |
| | Ctrl+Z | Undo |
| | Ctrl+Y | Redo |
| **Settings** | | |
| | O | Open Options |
| | Ctrl+, | Open Settings |
| | T | Open Trash |
| **Application** | | |
| | Ctrl+X | Exit application |
| | Escape | Close dialogs |

---

### B. Font Specifications

**System Default**
- Windows: Segoe UI
- macOS: San Francisco
- Fallback: Arial, sans-serif

**Inter**
- Weights: 400, 500, 600
- Source: Google Fonts
- License: OFL

**Roboto Mono**
- Weights: 400, 500
- Source: Google Fonts
- License: Apache 2.0

---

### C. Color Palette (Enhanced Hover)

**Dark Theme**
```css
--folder-bg: rgba(255, 255, 255, 0.03)
--folder-hover-bg: rgba(255, 255, 255, 0.12)
--folder-active-bg: rgba(59, 130, 246, 0.2)
--folder-text: rgba(255, 255, 255, 0.7)
--folder-hover-text: rgba(255, 255, 255, 1)
```

**Light Theme**
```css
--folder-bg: rgba(0, 0, 0, 0.02)
--folder-hover-bg: rgba(0, 0, 0, 0.08)
--folder-active-bg: rgba(59, 130, 246, 0.15)
--folder-text: rgba(0, 0, 0, 0.7)
--folder-hover-text: rgba(0, 0, 0, 0.95)
```

---

## Conclusion

This PRD outlines a comprehensive enhancement plan for PhotoSort that addresses critical bugs, implements highly requested features, and positions the application for future growth. The phased approach ensures stable delivery while maintaining development velocity.

**Next Steps:**
1. ✅ Review and approve PRD
2. Create detailed implementation plan
3. Set up development environment
4. Begin Phase 1 implementation

---

**Document Status:** ✅ Ready for Review  
**Estimated Timeline:** 4 weeks for Phases 1-3  
**Team Required:** 1 Full-stack Developer  
**Budget Impact:** Minimal (no new licenses required)
