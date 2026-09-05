package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/leaanthony/go-trash"
)

// TrashItem represents an item in the trash
type TrashItem struct {
	ID           string    `json:"id"`
	OriginalPath string    `json:"originalPath"`
	TrashPath    string    `json:"trashPath"`
	Name         string    `json:"name"`
	Type         string    `json:"type"` // "file" or "folder"
	Size         int64     `json:"size"`
	FileCount    int       `json:"fileCount"`
	DeletedAt    time.Time `json:"deletedAt"`
	ThumbnailURL string    `json:"thumbnailUrl,omitempty"`
}

// TrashStats represents statistics about trash contents
type TrashStats struct {
	Count     int   `json:"count"`
	TotalSize int64 `json:"totalSize"`
}

// getTrashDir returns the trash directory path
func (a *App) getTrashDir() (string, error) {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = os.Getenv("LOCALAPPDATA")
	}
	if appData == "" {
		return "", fmt.Errorf("could not determine app data directory")
	}

	trashDir := filepath.Join(appData, "PhotoSort", "trash")
	err := os.MkdirAll(trashDir, 0755)
	if err != nil {
		return "", err
	}

	return trashDir, nil
}

// getTrashMetadataPath returns the path to trash metadata file
func (a *App) getTrashMetadataPath() (string, error) {
	trashDir, err := a.getTrashDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(trashDir, "trash.json"), nil
}

// MoveFilesToTrash moves files to trash instead of permanently deleting them
// Handles cross-drive moves by copying then deleting
func (a *App) MoveFilesToTrash(filePaths []string) ([]TrashItem, error) {
	trashDir, err := a.getTrashDir()
	if err != nil {
		return nil, err
	}

	var trashItems []TrashItem

	for _, filePath := range filePaths {
		// Check if file exists
		info, err := os.Stat(filePath)
		if err != nil {
			continue
		}

		// Generate unique trash ID
		trashID := fmt.Sprintf("trash_%d_%s", time.Now().UnixNano(), filepath.Base(filePath))
		trashPath := filepath.Join(trashDir, trashID)

		// Try rename first (fast, works on same drive)
		err = os.Rename(filePath, trashPath)
		if err != nil {
			// Rename failed - likely cross-drive, use copy-then-delete
			err = copyFile(filePath, trashPath)
			if err != nil {
				continue // Skip this file if copy fails
			}
			// Delete original after successful copy
			err = os.Remove(filePath)
			if err != nil {
				// Cleanup partial trash copy
				os.Remove(trashPath)
				continue
			}
		}

		trashItem := TrashItem{
			ID:           trashID,
			OriginalPath: filePath,
			TrashPath:    trashPath,
			Name:         info.Name(),
			Type:         "file",
			Size:         info.Size(),
			DeletedAt:    time.Now(),
		}

		trashItems = append(trashItems, trashItem)
	}

	// Save metadata
	if len(trashItems) > 0 {
		err = a.saveTrashMetadata(trashItems)
		if err != nil {
			fmt.Printf("Warning: failed to save trash metadata: %v\n", err)
		}
	}

	return trashItems, nil
}

// MoveFolderToTrash moves a folder to trash instead of permanently deleting
// Handles cross-drive moves by copying then deleting
func (a *App) MoveFolderToTrash(folderPath string) (*TrashItem, error) {
	trashDir, err := a.getTrashDir()
	if err != nil {
		return nil, err
	}

	// Check if folder exists
	info, err := os.Stat(folderPath)
	if err != nil {
		return nil, err
	}

	if !info.IsDir() {
		return nil, fmt.Errorf("path is not a folder")
	}

	// Generate unique trash ID
	folderName := filepath.Base(folderPath)
	trashID := fmt.Sprintf("trash_folder_%d_%s", time.Now().UnixNano(), folderName)
	trashPath := filepath.Join(trashDir, trashID)

	// Get folder stats before moving (to have metadata in trash)
	stats, _ := a.GetFolderStats(folderPath)

	// Try simple rename first (fastest, works on same drive)
	err = os.Rename(folderPath, trashPath)
	if err != nil {
		// Rename failed - likely cross-drive move
		// Fall back to copy-then-delete
		err = copyFolder(folderPath, trashPath)
		if err != nil {
			return nil, fmt.Errorf("failed to copy folder to trash: %w", err)
		}
		// Delete original after successful copy
		err = os.RemoveAll(folderPath)
		if err != nil {
			// Try to cleanup partial trash copy
			os.RemoveAll(trashPath)
			return nil, fmt.Errorf("failed to remove original folder after copying: %w", err)
		}
	}

	trashItem := TrashItem{
		ID:           trashID,
		OriginalPath: folderPath,
		TrashPath:    trashPath,
		Name:         folderName,
		Type:         "folder",
		Size:         stats.TotalSize,
		FileCount:    stats.FileCount,
		DeletedAt:    time.Now(),
	}

	// Save metadata
	err = a.saveTrashMetadata([]TrashItem{trashItem})
	if err != nil {
		fmt.Printf("Warning: failed to save trash metadata for folder: %v\n", err)
	}

	return &trashItem, nil
}

// copyFolder recursively copies a folder and its contents
func copyFolder(src, dst string) error {
	// Create destination folder
	err := os.MkdirAll(dst, 0755)
	if err != nil {
		return err
	}

	// Read source directory
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if entry.IsDir() {
			// Recursively copy subdirectories
			err = copyFolder(srcPath, dstPath)
			if err != nil {
				return err
			}
		} else {
			// Copy file
			err = copyFile(srcPath, dstPath)
			if err != nil {
				return err
			}
		}
	}

	return nil
}

// copyFile copies a single file from src to dst
func copyFile(src, dst string) error {
	// Read source file
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}

	// Write to destination
	err = os.WriteFile(dst, data, 0644)
	if err != nil {
		return err
	}

	return nil
}

// GetTrashItems returns all items currently in trash
func (a *App) GetTrashItems() ([]TrashItem, error) {
	trashDir, err := a.getTrashDir()
	if err != nil {
		return nil, err
	}

	// Load metadata
	metadata, err := a.loadTrashMetadata()
	if err != nil {
		// If metadata doesn't exist, fall back to directory scan
		metadata = make(map[string]TrashItem)
	}

	entries, err := os.ReadDir(trashDir)
	if err != nil {
		return nil, err
	}

	trashItems := make([]TrashItem, 0)
	for _, entry := range entries {
		if entry.Name() == "trash.json" {
			continue
		}

		var item TrashItem
		exists := false

		// Check if we have metadata for this item
		if metaItem, metaExists := metadata[entry.Name()]; metaExists {
			item = metaItem
			exists = true
		} else {
			// Fallback: create item without original path
			info, err := entry.Info()
			if err != nil {
				continue
			}

			itemType := "file"
			if info.IsDir() {
				itemType = "folder"
			}

			item = TrashItem{
				ID:           entry.Name(),
				OriginalPath: "",
				TrashPath:    filepath.Join(trashDir, entry.Name()),
				Name:         info.Name(),
				Type:         itemType,
				Size:         info.Size(),
				DeletedAt:    info.ModTime(),
			}
			exists = true
		}

		if exists {
			trashItems = append(trashItems, item)
		}
	}

	return trashItems, nil
}

// GetTrashThumbnail returns the base64 thumbnail for a trash item
func (a *App) GetTrashThumbnail(trashPath string) (string, error) {
	// Generate thumbnail (this will return cached path if exists)
	thumbnailPath, err := GenerateThumbnail(trashPath, a.settings.CachePath)
	if err != nil {
		return "", err
	}

	// Read thumbnail file
	data, err := os.ReadFile(thumbnailPath)
	if err != nil {
		return "", err
	}

	// Create base64 URI
	base64Data := base64.StdEncoding.EncodeToString(data)
	return fmt.Sprintf("data:image/jpeg;base64,%s", base64Data), nil
}

// saveTrashMetadata saves trash metadata to disk
func (a *App) saveTrashMetadata(items []TrashItem) error {
	metadataPath, err := a.getTrashMetadataPath()
	if err != nil {
		return err
	}

	// Load existing metadata
	existing, _ := a.loadTrashMetadata()
	if existing == nil {
		existing = make(map[string]TrashItem)
	}

	// Add new items
	for _, item := range items {
		existing[item.ID] = item
	}

	// Save to file
	data, err := json.MarshalIndent(existing, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(metadataPath, data, 0644)
}

// loadTrashMetadata loads trash metadata from disk
func (a *App) loadTrashMetadata() (map[string]TrashItem, error) {
	metadataPath, err := a.getTrashMetadataPath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(metadataPath)
	if err != nil {
		if os.IsNotExist(err) {
			return make(map[string]TrashItem), nil
		}
		return nil, err
	}

	var metadata map[string]TrashItem
	err = json.Unmarshal(data, &metadata)
	if err != nil {
		return nil, err
	}

	return metadata, nil
}

// RestoreFromTrash restores an item from trash to its original location or a new location
func (a *App) RestoreFromTrash(trashID string, restorePath string) error {
	trashDir, err := a.getTrashDir()
	if err != nil {
		return err
	}

	trashPath := filepath.Join(trashDir, trashID)

	// Check if item exists in trash
	_, err = os.Stat(trashPath)
	if err != nil {
		return fmt.Errorf("item not found in trash")
	}

	// Check if destination exists
	if _, err := os.Stat(restorePath); err == nil {
		// Destination exists, add number suffix
		dir := filepath.Dir(restorePath)
		base := filepath.Base(restorePath)
		ext := filepath.Ext(base)
		nameWithoutExt := base[:len(base)-len(ext)]

		counter := 1
		for {
			newName := fmt.Sprintf("%s_restored_%d%s", nameWithoutExt, counter, ext)
			restorePath = filepath.Join(dir, newName)
			if _, err := os.Stat(restorePath); os.IsNotExist(err) {
				break
			}
			counter++
		}
	}

	// Move from trash to restore location
	// Try rename first (fast, works on same drive)
	err = os.Rename(trashPath, restorePath)
	if err != nil {
		// Rename failed - likely cross-drive move (e.g. C: to D:)
		// Fall back to copy-then-delete
		info, err := os.Stat(trashPath)
		if err != nil {
			return err
		}

		if info.IsDir() {
			err = copyFolder(trashPath, restorePath)
		} else {
			err = copyFile(trashPath, restorePath)
		}

		if err != nil {
			return fmt.Errorf("failed to copy item for restore: %w", err)
		}

		// Delete from trash after successful copy
		if info.IsDir() {
			os.RemoveAll(trashPath)
		} else {
			os.Remove(trashPath)
		}
	}

	// Remove from metadata
	metadata, _ := a.loadTrashMetadata()
	if metadata != nil {
		delete(metadata, trashID)
		metadataPath, _ := a.getTrashMetadataPath()
		if metadataPath != "" {
			data, _ := json.MarshalIndent(metadata, "", "  ")
			os.WriteFile(metadataPath, data, 0644)
		}
	}

	return nil
}

// EmptyTrash moves all items in app trash to the system Recycle Bin
func (a *App) EmptyTrash() error {
	trashDir, err := a.getTrashDir()
	if err != nil {
		return err
	}

	entries, err := os.ReadDir(trashDir)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if entry.Name() == "trash.json" {
			continue
		}

		itemPath := filepath.Join(trashDir, entry.Name())
		// Move to OS Recycle Bin instead of permanent deletion
		_, err := trash.MoveToTrash(itemPath)
		if err != nil {
			// Fallback to permanent deletion if trash fails (e.g. drive issues)
			if entry.IsDir() {
				os.RemoveAll(itemPath)
			} else {
				os.Remove(itemPath)
			}
		}
	}

	// Also clear the metadata file
	metadataPath, _ := a.getTrashMetadataPath()
	if metadataPath != "" {
		os.WriteFile(metadataPath, []byte("{}"), 0644)
	}

	return nil
}

// GetTrashStats returns statistics about trash contents
func (a *App) GetTrashStats() (TrashStats, error) {
	items, err := a.GetTrashItems()
	if err != nil {
		return TrashStats{}, err
	}

	var totalSize int64
	for _, item := range items {
		totalSize += item.Size
	}

	return TrashStats{
		Count:     len(items),
		TotalSize: totalSize,
	}, nil
}
