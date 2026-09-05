package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// CreateFolder creates a new folder
func (a *App) CreateFolder(basePath string, folderName string) (FolderInfo, error) {
	folderPath := filepath.Join(basePath, folderName)

	// Check if folder already exists
	if _, err := os.Stat(folderPath); err == nil {
		return FolderInfo{}, fmt.Errorf("folder already exists")
	}

	// Create folder
	err := os.MkdirAll(folderPath, 0755)
	if err != nil {
		return FolderInfo{}, err
	}

	folder := FolderInfo{
		ID:        generateFolderID(folderPath),
		Name:      folderName,
		Path:      folderPath,
		FileCount: 0,
		TotalSize: 0,
	}

	return folder, nil
}

// RenameFolder renames a folder
func (a *App) RenameFolder(oldPath string, newName string) error {
	dir := filepath.Dir(oldPath)
	newPath := filepath.Join(dir, newName)

	// Check if new path already exists
	if _, err := os.Stat(newPath); err == nil {
		return fmt.Errorf("folder with this name already exists")
	}

	return os.Rename(oldPath, newPath)
}

// DeleteFolder deletes a folder
func (a *App) DeleteFolder(folderPath string) error {
	return os.RemoveAll(folderPath)
}

// MoveFolder moves a folder to a new parent location
func (a *App) MoveFolder(folderPath string, newParentPath string) error {
	// Check if source exists
	info, err := os.Stat(folderPath)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("path is not a folder")
	}

	folderName := filepath.Base(folderPath)
	destPath := filepath.Join(newParentPath, folderName)

	// Check if destination already exists
	if _, err := os.Stat(destPath); err == nil {
		return fmt.Errorf("a folder with the same name already exists in the destination")
	}

	// Try simple rename first
	err = os.Rename(folderPath, destPath)
	if err != nil {
		// Rename failed (likely cross-drive), use copy-then-delete
		err = copyFolder(folderPath, destPath)
		if err != nil {
			return fmt.Errorf("failed to move folder (copy stage): %w", err)
		}
		// Delete source recursively
		err = os.RemoveAll(folderPath)
		if err != nil {
			return fmt.Errorf("failed to remove source folder after copy: %w", err)
		}
	}

	return nil
}

// GetFolderStats returns folder statistics
func (a *App) GetFolderStats(folderPath string) (FolderInfo, error) {
	var fileCount int
	var totalSize int64
	var hasSubfolders bool

	entries, err := os.ReadDir(folderPath)
	if err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				hasSubfolders = true
				break
			}
		}
	}

	err = filepath.Walk(folderPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			fileCount++
			totalSize += info.Size()
		}
		return nil
	})

	if err != nil {
		return FolderInfo{}, err
	}

	folder := FolderInfo{
		ID:            generateFolderID(folderPath),
		Path:          folderPath,
		Name:          filepath.Base(folderPath),
		FileCount:     fileCount,
		TotalSize:     totalSize,
		HasSubfolders: hasSubfolders,
	}

	return folder, nil
}

// MoveFiles moves files to destination folder
// Handles cross-drive moves by copying then deleting when necessary
func (a *App) MoveFiles(filePaths []string, destFolder string) error {
	for _, filePath := range filePaths {
		fileName := filepath.Base(filePath)
		destPath := filepath.Join(destFolder, fileName)

		// Check if destination exists
		if _, err := os.Stat(destPath); err == nil {
			// File exists, add number suffix
			ext := filepath.Ext(fileName)
			nameWithoutExt := fileName[:len(fileName)-len(ext)]
			counter := 1
			for {
				newName := fmt.Sprintf("%s_%d%s", nameWithoutExt, counter, ext)
				destPath = filepath.Join(destFolder, newName)
				if _, err := os.Stat(destPath); os.IsNotExist(err) {
					break
				}
				counter++
			}
		}

		// Try rename first (fast, works on same drive)
		err := os.Rename(filePath, destPath)
		if err != nil {
			// Rename failed - likely cross-drive move
			// Fall back to copy-then-delete
			err = copyFile(filePath, destPath)
			if err != nil {
				return fmt.Errorf("failed to copy file %s: %w", fileName, err)
			}
			// Delete original after successful copy
			err = os.Remove(filePath)
			if err != nil {
				// Cleanup partial copy
				os.Remove(destPath)
				return fmt.Errorf("failed to remove original file %s after copying: %w", fileName, err)
			}
		}
	}

	return nil
}

// CopyFiles copies files to destination folder
func (a *App) CopyFiles(filePaths []string, destFolder string) error {
	for _, filePath := range filePaths {
		fileName := filepath.Base(filePath)
		destPath := filepath.Join(destFolder, fileName)

		// Check if destination exists
		if _, err := os.Stat(destPath); err == nil {
			// File exists, add number suffix
			ext := filepath.Ext(fileName)
			nameWithoutExt := fileName[:len(fileName)-len(ext)]
			counter := 1
			for {
				newName := fmt.Sprintf("%s_%d%s", nameWithoutExt, counter, ext)
				destPath = filepath.Join(destFolder, newName)
				if _, err := os.Stat(destPath); os.IsNotExist(err) {
					break
				}
				counter++
			}
		}

		// Use copyFile helper from trash.go (if exported or accessible)
		// Since copyFile is in trash.go and this is the same package 'main', it's accessible.
		err := copyFile(filePath, destPath)
		if err != nil {
			return fmt.Errorf("failed to copy file %s: %w", fileName, err)
		}
	}

	return nil
}

// DeleteFiles deletes files (moves to recycle bin on Windows)
func (a *App) DeleteFiles(filePaths []string) error {
	for _, filePath := range filePaths {
		err := os.Remove(filePath)
		if err != nil {
			return err
		}
	}
	return nil
}

// BatchRenameFiles renames multiple files with incremental suffixes
// newBaseName is the new name without extension and without suffix (e.g. "Vacation")
// Results in "Vacation (1).jpg", "Vacation (2).jpg", etc.
func (a *App) BatchRenameFiles(filePaths []string, newBaseName string) error {
	for i, filePath := range filePaths {
		dir := filepath.Dir(filePath)
		ext := filepath.Ext(filePath)

		// Create new name
		var newName string
		if len(filePaths) == 1 {
			newName = newBaseName + ext
		} else {
			// Create new name with index: Base (1).ext
			newName = fmt.Sprintf("%s (%d)%s", newBaseName, i+1, ext)
		}
		newPath := filepath.Join(dir, newName)

		// Check if destination exists
		if _, err := os.Stat(newPath); err == nil {
			// If exists, try to find a unique name
			counter := 1
			for {
				if len(filePaths) == 1 {
					newName = fmt.Sprintf("%s_%d%s", newBaseName, counter, ext)
				} else {
					newName = fmt.Sprintf("%s (%d)_%d%s", newBaseName, i+1, counter, ext)
				}
				newPath = filepath.Join(dir, newName)
				if _, err := os.Stat(newPath); os.IsNotExist(err) {
					break
				}
				counter++
			}
		}

		err := os.Rename(filePath, newPath)
		if err != nil {
			return fmt.Errorf("failed to rename %s: %w", filepath.Base(filePath), err)
		}
	}

	return nil
}

// generateFolderID creates a unique ID for a folder based on its path
// Uses timestamp + path hash to ensure uniqueness even for same-named folders
func generateFolderID(folderPath string) string {
	// Generate hash from path
	pathHash := hashString(folderPath)
	// Combine with timestamp for uniqueness
	return fmt.Sprintf("folder_%d_%s", time.Now().UnixNano(), pathHash)
}
