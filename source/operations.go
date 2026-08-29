package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ===== UNDO/REDO OPERATIONS =====

// CanUndo returns true if there are operations that can be undone
func (a *App) CanUndo() bool {
	return len(a.undoStack) > 0
}

// CanRedo returns true if there are operations that can be redone
func (a *App) CanRedo() bool {
	return len(a.redoStack) > 0
}

// Undo performs the last undoable operation
func (a *App) Undo() error {
	if !a.CanUndo() {
		return fmt.Errorf("nothing to undo")
	}

	// Pop the last operation from undo stack
	op := a.undoStack[len(a.undoStack)-1]
	a.undoStack = a.undoStack[:len(a.undoStack)-1]

	// Perform reverse operation
	var reverseOp Operation
	var err error

	switch op.Type {
	case "move":
		// Reverse move: move files back to source
		reverseOp, err = a.undoMove(op)
	case "trash":
		// Reverse trash: move files back from trash
		reverseOp, err = a.undoTrash(op)
	case "delete":
		// Cannot undo delete (file is gone)
		err = fmt.Errorf("cannot undo delete operation")
	case "create_folder":
		// Reverse: delete the created folder
		reverseOp, err = a.undoCreateFolder(op)
	case "rename", "rename_folder":
		// Reverse: rename back to old name
		reverseOp, err = a.undoRenameFolder(op)
	default:
		err = fmt.Errorf("unknown operation type: %s", op.Type)
	}

	if err != nil {
		// Put the operation back if undo failed
		a.undoStack = append(a.undoStack, op)
		return err
	}

	// Push the reverse operation to redo stack
	a.redoStack = append(a.redoStack, reverseOp)

	return nil
}

// Redo performs the last undone operation
func (a *App) Redo() error {
	if !a.CanRedo() {
		return fmt.Errorf("nothing to redo")
	}

	// Pop from redo stack
	op := a.redoStack[len(a.redoStack)-1]
	a.redoStack = a.redoStack[:len(a.redoStack)-1]

	// Perform the operation
	var newOp Operation
	var err error

	switch op.Type {
	case "move":
		newOp, err = a.redoMove(op)
	case "trash":
		newOp, err = a.redoTrash(op)
	case "delete":
		err = fmt.Errorf("cannot redo delete operation")
	case "create_folder":
		newOp, err = a.redoCreateFolder(op)
	case "rename", "rename_folder":
		newOp, err = a.redoRenameFolder(op)
	default:
		err = fmt.Errorf("unknown operation type: %s", op.Type)
	}

	if err != nil {
		// Put the operation back if redo failed
		a.redoStack = append(a.redoStack, op)
		return err
	}

	// Push the new operation to undo stack
	a.undoStack = append(a.undoStack, newOp)

	return nil
}

// PerformUndo performs a specific operation undo
func (a *App) PerformUndo(op Operation) error {
	var err error
	switch op.Type {
	case "move":
		_, err = a.undoMove(op)
	case "trash":
		_, err = a.undoTrash(op)
	case "create_folder":
		_, err = a.undoCreateFolder(op)
	case "rename", "rename_folder":
		_, err = a.undoRenameFolder(op)
	default:
		err = fmt.Errorf("unknown operation type: %s", op.Type)
	}
	return err
}

// PerformRedo performs a specific operation redo
func (a *App) PerformRedo(op Operation) error {
	var err error
	switch op.Type {
	case "move":
		_, err = a.redoMove(op)
	case "trash":
		_, err = a.redoTrash(op)
	case "create_folder":
		_, err = a.redoCreateFolder(op)
	case "rename", "rename_folder":
		_, err = a.redoRenameFolder(op)
	default:
		err = fmt.Errorf("unknown operation type: %s", op.Type)
	}
	return err
}

// ClearUndoRedo clears both undo and redo stacks
func (a *App) ClearUndoRedo() {
	a.undoStack = make([]Operation, 0)
	a.redoStack = make([]Operation, 0)
}

// GetUndoStack returns the current undo stack (for debugging)
func (a *App) GetUndoStack() []Operation {
	return a.undoStack
}

// GetRedoStack returns the current redo stack (for debugging)
func (a *App) GetRedoStack() []Operation {
	return a.redoStack
}

// ===== OPERATION HANDLERS =====

func (a *App) undoMove(op Operation) (Operation, error) {
	// Move files back to their original locations
	sourcePaths := op.Payload.SourcePaths
	destFolder := op.Payload.DestinationPath

	for _, originalPath := range sourcePaths {
		fileName := filepath.Base(originalPath)
		currentPath := filepath.Join(destFolder, fileName)

		// Check if file exists at current path (moved folder)
		if _, err := os.Stat(currentPath); os.IsNotExist(err) {
			// Try to find it in the destination folder if it was renamed
			continue
		}

		// Move back to original location
		err := os.Rename(currentPath, originalPath)
		if err != nil {
			// Fallback to copy
			err = copyFile(currentPath, originalPath)
			if err == nil {
				os.Remove(currentPath)
			}
		}
	}

	return Operation{
		Type:      "move",
		Timestamp: time.Now().Unix(),
		Payload:   op.Payload,
	}, nil
}

func (a *App) redoMove(op Operation) (Operation, error) {
	// Re-perform the move operation
	err := a.MoveFiles(op.Payload.SourcePaths, op.Payload.DestinationPath)
	if err != nil {
		return Operation{}, err
	}

	return Operation{
		Type:      "move",
		Timestamp: time.Now().Unix(),
		Payload:   op.Payload,
	}, nil
}

func (a *App) undoTrash(op Operation) (Operation, error) {
	// Move files back from trash
	if len(op.Payload.TrashItems) > 0 {
		for _, item := range op.Payload.TrashItems {
			err := a.RestoreFromTrash(item.ID, item.OriginalPath)
			if err != nil {
				// Log error but continue with others
				fmt.Printf("Error restoring %s from trash: %v\n", item.Name, err)
			}
		}
	}

	return Operation{
		Type:      "trash",
		Timestamp: time.Now().Unix(),
		Payload:   op.Payload,
	}, nil
}

func (a *App) redoTrash(op Operation) (Operation, error) {
	_, err := a.MoveFilesToTrash(op.Payload.SourcePaths)
	if err != nil {
		return Operation{}, err
	}

	return Operation{
		Type:      "trash",
		Timestamp: time.Now().Unix(),
		Payload:   op.Payload,
	}, nil
}

func (a *App) undoCreateFolder(op Operation) (Operation, error) {
	// Delete the created folder
	err := os.RemoveAll(op.Payload.FolderPath)
	if err != nil {
		return Operation{}, err
	}

	return Operation{
		Type:      "delete_folder",
		Timestamp: time.Now().Unix(),
		Payload:   op.Payload,
	}, nil
}

func (a *App) redoCreateFolder(op Operation) (Operation, error) {
	// Re-create the folder
	err := os.MkdirAll(op.Payload.FolderPath, 0755)
	if err != nil {
		return Operation{}, err
	}

	return Operation{
		Type:      "create_folder",
		Timestamp: time.Now().Unix(),
		Payload:   op.Payload,
	}, nil
}

func (a *App) undoRenameFolder(op Operation) (Operation, error) {
	// Rename back to old name
	oldPath := filepath.Join(filepath.Dir(op.Payload.FolderPath), op.Payload.OldName)
	err := os.Rename(op.Payload.FolderPath, oldPath)
	if err != nil {
		return Operation{}, err
	}

	return Operation{
		Type:      "rename_folder",
		Timestamp: time.Now().Unix(),
		Payload: OperationPayload{
			FolderPath: oldPath,
			OldName:    op.Payload.NewName,
			NewName:    op.Payload.OldName,
		},
	}, nil
}

func (a *App) redoRenameFolder(op Operation) (Operation, error) {
	// Re-perform the rename
	newPath := filepath.Join(filepath.Dir(op.Payload.FolderPath), op.Payload.NewName)
	err := os.Rename(op.Payload.FolderPath, newPath)
	if err != nil {
		return Operation{}, err
	}

	return Operation{
		Type:      "rename_folder",
		Timestamp: time.Now().Unix(),
		Payload:   op.Payload,
	}, nil
}

// ===== PROJECT MANAGEMENT =====

// SaveProject saves the current session as a project
func (a *App) SaveProject(name string, files []FileInfo, folders []FolderInfo, groups []FileGroup) (Project, error) {
	if a.currentProject == nil {
		// Create new project
		a.currentProject = &Project{
			ID:         generateProjectID(),
			Name:       name,
			CreatedAt:  time.Now().Unix(),
			ModifiedAt: time.Now().Unix(),
		}
	}

	// Update project data
	a.currentProject.Name = name
	a.currentProject.Files = files
	a.currentProject.Folders = folders
	a.currentProject.Groups = groups
	a.currentProject.Settings = a.settings
	a.currentProject.ModifiedAt = time.Now().Unix()

	// Get projects directory
	projectsDir, err := a.getProjectsDir()
	if err != nil {
		return Project{}, err
	}

	// Save to file
	projectPath := filepath.Join(projectsDir, a.currentProject.ID+".json")
	data, err := json.MarshalIndent(a.currentProject, "", "  ")
	if err != nil {
		return Project{}, fmt.Errorf("failed to marshal project: %w", err)
	}

	err = os.WriteFile(projectPath, data, 0644)
	if err != nil {
		return Project{}, fmt.Errorf("failed to write project: %w", err)
	}

	return *a.currentProject, nil
}

// LoadProject loads a project by ID
func (a *App) LoadProject(projectID string) (Project, error) {
	// Get projects directory
	projectsDir, err := a.getProjectsDir()
	if err != nil {
		return Project{}, err
	}

	// Read project file
	projectPath := filepath.Join(projectsDir, projectID+".json")
	data, err := os.ReadFile(projectPath)
	if err != nil {
		return Project{}, fmt.Errorf("failed to read project: %w", err)
	}

	// Unmarshal project
	var project Project
	err = json.Unmarshal(data, &project)
	if err != nil {
		return Project{}, fmt.Errorf("failed to unmarshal project: %w", err)
	}

	// Set as current project
	a.currentProject = &project

	return project, nil
}

// GetProjects returns a list of all saved projects
func (a *App) GetProjects() ([]Project, error) {
	projectsDir, err := a.getProjectsDir()
	if err != nil {
		return nil, err
	}

	// Read directory
	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []Project{}, nil
		}
		return nil, err
	}

	var projects []Project
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		// Read and parse project
		projectPath := filepath.Join(projectsDir, entry.Name())
		data, err := os.ReadFile(projectPath)
		if err != nil {
			continue
		}

		var project Project
		if err := json.Unmarshal(data, &project); err != nil {
			continue
		}

		projects = append(projects, project)
	}

	return projects, nil
}

// DeleteProject deletes a project by ID
func (a *App) DeleteProject(projectID string) error {
	projectsDir, err := a.getProjectsDir()
	if err != nil {
		return err
	}

	projectPath := filepath.Join(projectsDir, projectID+".json")
	return os.Remove(projectPath)
}

// ExportProject exports a project to a user-selected location
func (a *App) ExportProject(projectID string) (string, error) {
	project, err := a.LoadProject(projectID)
	if err != nil {
		return "", err
	}

	// Ask user for save location
	savePath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Export Project",
		DefaultFilename:  project.Name + ".json",
		DefaultDirectory: "",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON Files", Pattern: "*.json"},
		},
	})
	if err != nil {
		return "", err
	}

	if savePath == "" {
		return "", fmt.Errorf("export cancelled")
	}

	// Export project data
	data, err := json.MarshalIndent(project, "", "  ")
	if err != nil {
		return "", err
	}

	err = os.WriteFile(savePath, data, 0644)
	if err != nil {
		return "", err
	}

	return savePath, nil
}

// ImportProject imports a project from a file
func (a *App) ImportProject() (Project, error) {
	// Ask user to select file
	openPath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Import Project",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON Files", Pattern: "*.json"},
		},
	})
	if err != nil {
		return Project{}, err
	}

	if openPath == "" {
		return Project{}, fmt.Errorf("import cancelled")
	}

	// Read file
	data, err := os.ReadFile(openPath)
	if err != nil {
		return Project{}, err
	}

	// Parse project
	var project Project
	if err := json.Unmarshal(data, &project); err != nil {
		return Project{}, err
	}

	// Generate new ID and save
	project.ID = generateProjectID()
	project.CreatedAt = time.Now().Unix()
	project.ModifiedAt = time.Now().Unix()

	projectsDir, err := a.getProjectsDir()
	if err != nil {
		return Project{}, err
	}

	projectPath := filepath.Join(projectsDir, project.ID+".json")
	data, err = json.MarshalIndent(project, "", "  ")
	if err != nil {
		return Project{}, err
	}

	err = os.WriteFile(projectPath, data, 0644)
	if err != nil {
		return Project{}, err
	}

	a.currentProject = &project
	return project, nil
}

// ===== UTILITY FUNCTIONS =====

func (a *App) getProjectsDir() (string, error) {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = os.Getenv("LOCALAPPDATA")
	}
	if appData == "" {
		return "", fmt.Errorf("could not determine app data directory")
	}

	projectsDir := filepath.Join(appData, "PhotoSort", "projects")
	err := os.MkdirAll(projectsDir, 0755)
	if err != nil {
		return "", err
	}

	return projectsDir, nil
}

func generateProjectID() string {
	return fmt.Sprintf("proj_%d", time.Now().UnixNano())
}
