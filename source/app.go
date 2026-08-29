package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/disintegration/imaging"

	"github.com/google/generative-ai-go/genai"
	"github.com/jdeng/goheif"
	"github.com/rwcarlsen/goexif/exif"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"google.golang.org/api/option"
)

// App struct
type App struct {
	ctx context.Context
	// Settings
	settings AppSettings
	// Undo/Redo stacks
	undoStack []Operation
	redoStack []Operation
	// Current project
	currentProject *Project
}

// Operation represents a file operation for undo/redo
type Operation struct {
	Type      string           `json:"type"` // "move", "delete", "create_folder", "rename_folder"
	Timestamp int64            `json:"timestamp"`
	Payload   OperationPayload `json:"payload"`
}

type OperationPayload struct {
	SourcePaths     []string    `json:"sourcePaths,omitempty"`
	DestinationPath string      `json:"destinationPath,omitempty"`
	FolderPath      string      `json:"folderPath,omitempty"`
	OldName         string      `json:"oldName,omitempty"`
	NewName         string      `json:"newName,omitempty"`
	Files           []FileInfo  `json:"files,omitempty"`
	TrashItems      []TrashItem `json:"trashItems,omitempty"`
}

// AppSettings holds application settings
type AppSettings struct {
	// AI Grouping settings
	SimilarityThreshold int     `json:"similarityThreshold"`
	TimeWindowHours     float64 `json:"timeWindowHours"`
	MinGroupSize        int     `json:"minGroupSize"`
	// UI settings
	Theme            string `json:"theme"`
	DefaultView      string `json:"defaultView"`
	ThumbnailSize    int    `json:"thumbnailSize"`
	SidebarWidth     int    `json:"sidebarWidth"`
	SidebarCollapsed bool   `json:"sidebarCollapsed"`
	InterfaceFont    string `json:"interfaceFont"`
	// File type filters
	ShowImages    bool   `json:"showImages"`
	ShowVideos    bool   `json:"showVideos"`
	ShowAudio     bool   `json:"showAudio"`
	ShowDocuments bool   `json:"showDocuments"`
	ShowCode      bool   `json:"showCode"`
	ShowArchives  bool   `json:"showArchives"`
	GeminiAPIKey  string `json:"geminiApiKey"`
	CachePath     string `json:"cachePath"`
	// Auto cleanup settings
	AutoCleanupThumbnails bool `json:"autoCleanupThumbnails"`
}

// Project represents a saved sorting session
type Project struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	SourceFolder string       `json:"sourceFolder"`
	CreatedAt    int64        `json:"createdAt"`
	ModifiedAt   int64        `json:"modifiedAt"`
	Files        []FileInfo   `json:"files"`
	Folders      []FolderInfo `json:"folders"`
	Groups       []FileGroup  `json:"groups"`
	Settings     AppSettings  `json:"settings"`
}

// AIMessage represents a message in the chat history
type AIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// AIAttachment represents a multimodal attachment (image/audio)
type AIAttachment struct {
	MimeType string `json:"mimeType"`
	Data     string `json:"data"` // base64
}

// DefaultSettings returns default application settings
func DefaultSettings() AppSettings {
	return AppSettings{
		SimilarityThreshold:   80,
		TimeWindowHours:       1.0,
		MinGroupSize:          2,
		Theme:                 "dark",
		DefaultView:           "grid",
		ThumbnailSize:         200,
		SidebarWidth:          280,
		SidebarCollapsed:      false,
		InterfaceFont:         "system",
		ShowImages:            true,
		ShowVideos:            true,
		ShowAudio:             true,
		ShowDocuments:         true,
		ShowCode:              true,
		ShowArchives:          true,
		AutoCleanupThumbnails: true,
		CachePath:             `D:\PhotoSort_Cache`,
	}
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		settings:  DefaultSettings(),
		undoStack: make([]Operation, 0),
		redoStack: make([]Operation, 0),
	}
}

// startup is called when the app starts
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// Load settings on startup
	a.LoadSettings()
}

// shutdown is called when the app is closing
func (a *App) shutdown(ctx context.Context) {
	// Clean up all cache files on app exit to free storage space
	// Thumbnails and previews are temporary data used only during the application session
	if a.settings.AutoCleanupThumbnails {
		if err := a.CleanupAllCaches(); err != nil {
			log.Printf("Failed to clean up caches on shutdown: %v", err)
		}
	}
}

// GetSettings returns current application settings
func (a *App) GetSettings() AppSettings {
	return a.settings
}

// SaveSettings saves application settings
func (a *App) SaveSettings(settings AppSettings) error {
	a.settings = settings

	// Get settings file path
	settingsPath, err := a.getSettingsPath()
	if err != nil {
		return err
	}

	// Marshal settings to JSON
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal settings: %w", err)
	}

	// Write to file
	err = os.WriteFile(settingsPath, data, 0644)
	if err != nil {
		return fmt.Errorf("failed to write settings: %w", err)
	}

	return nil
}

// LoadSettings loads application settings from file
func (a *App) LoadSettings() error {
	settingsPath, err := a.getSettingsPath()
	if err != nil {
		return err
	}

	// Check if settings file exists
	if _, err := os.Stat(settingsPath); os.IsNotExist(err) {
		// Create default settings
		a.settings = DefaultSettings()
		return a.SaveSettings(a.settings)
	}

	// Read settings file
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		return fmt.Errorf("failed to read settings: %w", err)
	}

	// Unmarshal settings
	var settings AppSettings
	err = json.Unmarshal(data, &settings)
	if err != nil {
		return fmt.Errorf("failed to unmarshal settings: %w", err)
	}

	// Helper: Apply defaults for new fields if they are missing (zero values)
	if settings.CachePath == "" {
		settings.CachePath = `D:\PhotoSort_Cache`
	}
	// Ensure boolean defaults that should be true are not false due to omitempty/missing
	// (However, JSON unmarshal sets booleans to false by default. Functional fields like ShowImages defaults to true in DefaultSettings
	//  but here we can't easily distinguish "user set to false" vs "missing from file".
	//  For CachePath, "empty" is invalid so we can safely default it.)

	a.settings = settings
	return nil
}

// getSettingsPath returns the path to the settings file
func (a *App) getSettingsPath() (string, error) {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = os.Getenv("LOCALAPPDATA")
	}
	if appData == "" {
		return "", fmt.Errorf("could not determine app data directory")
	}

	configDir := filepath.Join(appData, "PhotoSort")
	err := os.MkdirAll(configDir, 0755)
	if err != nil {
		return "", err
	}

	return filepath.Join(configDir, "settings.json"), nil
}

// ResetSettings resets settings to defaults
func (a *App) ResetSettings() error {
	a.settings = DefaultSettings()
	return a.SaveSettings(a.settings)
}

// FileInfo represents file metadata
type FileInfo struct {
	ID           string    `json:"id"`
	Path         string    `json:"path"`
	Name         string    `json:"name"`
	Extension    string    `json:"extension"`
	Size         int64     `json:"size"`
	CreatedAt    time.Time `json:"createdAt"`
	ModifiedAt   time.Time `json:"modifiedAt"`
	DateTaken    time.Time `json:"dateTaken"`
	ThumbnailURL string    `json:"thumbnailUrl"`
	FileType     string    `json:"fileType"`
	GroupID      string    `json:"groupId"`
}

// FolderInfo represents folder metadata
type FolderInfo struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Path          string `json:"path"`
	Color         string `json:"color"`
	Shortcut      string `json:"shortcut"`
	FileCount     int    `json:"fileCount"`
	TotalSize     int64  `json:"totalSize"`
	HasSubfolders bool   `json:"hasSubfolders"`
}

// SelectFolder opens a folder selection dialog
func (a *App) SelectFolder() (string, error) {
	folder, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Folder to Scan",
	})
	if err != nil {
		return "", err
	}
	return folder, nil
}

// FolderContent represents the contents of a folder
type FolderContent struct {
	Files      []FileInfo   `json:"files"`
	Subfolders []FolderInfo `json:"subfolders"`
}

// CleanupAllCaches removes all thumbnail and preview cache files
func (a *App) CleanupAllCaches() error {
	var errs []error

	thumbDir, err1 := GetThumbnailCacheDir(a.settings.CachePath)
	if err1 == nil {
		if err := os.RemoveAll(thumbDir); err != nil {
			errs = append(errs, fmt.Errorf("thumbnails: %w", err))
		}
	}

	previewDir, err2 := GetPreviewCacheDir(a.settings.CachePath)
	if err2 == nil {
		if err := os.RemoveAll(previewDir); err != nil {
			errs = append(errs, fmt.Errorf("previews: %w", err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("errors during cleanup: %v", errs)
	}
	return nil
}

// CleanupThumbnails is kept for backward compatibility, delegates to CleanupAllCaches
func (a *App) CleanupThumbnails() error {
	return a.CleanupAllCaches()
}

// ScanFolder scans a folder and returns file list and subfolders
func (a *App) ScanFolder(folderPath string) (FolderContent, error) {
	var content FolderContent
	content.Files = []FileInfo{}
	content.Subfolders = []FolderInfo{}

	// NOTE: Removed automatic cache clearing as it causes major performance issues
	// with large folders. Cache is now only cleared manually via settings.

	// Read directory entries
	entries, err := os.ReadDir(folderPath)
	if err != nil {
		return content, err
	}

	for _, entry := range entries {
		path := filepath.Join(folderPath, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}

		if entry.IsDir() {
			// It's a subdirectory, get its stats
			stats, err := a.GetFolderStats(path)
			if err == nil {
				content.Subfolders = append(content.Subfolders, stats)
			}
		} else {
			// It's a file
			fileInfo := FileInfo{
				ID:         generateFileID(path),
				Path:       path,
				Name:       info.Name(),
				Extension:  filepath.Ext(path),
				Size:       info.Size(),
				CreatedAt:  info.ModTime(),
				ModifiedAt: info.ModTime(),
				DateTaken:  a.extractDateTaken(path, info.ModTime()), // Use helper
				FileType:   GetFileType(filepath.Ext(path)),
			}

			// Filter by file type based on settings
			if a.shouldShowFileType(fileInfo.FileType) {
				content.Files = append(content.Files, fileInfo)
			}
		}
	}

	return content, nil
}

// extractDateTaken attempts to get the date taken from EXIF, falls back to fallbackTime
func (a *App) extractDateTaken(path string, fallbackTime time.Time) time.Time {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".jpg" && ext != ".jpeg" && ext != ".tiff" && ext != ".tif" {
		return fallbackTime
	}

	f, err := os.Open(path)
	if err != nil {
		return fallbackTime
	}
	defer f.Close()

	x, err := exif.Decode(f)
	if err != nil {
		return fallbackTime
	}

	tm, err := x.DateTime()
	if err != nil {
		return fallbackTime
	}

	return tm
}

// generateFileID generates a unique, deterministic ID for a file (using the full path)
func generateFileID(path string) string {
	return path
}

// hashString creates a simple hash of a string
func hashString(s string) string {
	var hash int64
	for _, c := range s {
		hash = hash*31 + int64(c)
	}
	if hash < 0 {
		hash = -hash
	}
	return fmt.Sprintf("%x", hash)
}

// shouldShowFileType checks if a file type should be shown based on settings
func (a *App) shouldShowFileType(fileType string) bool {
	switch fileType {
	case "image":
		return a.settings.ShowImages
	case "video":
		return a.settings.ShowVideos
	case "audio":
		return a.settings.ShowAudio
	case "document":
		return a.settings.ShowDocuments
	case "code":
		return a.settings.ShowCode
	case "archive":
		return a.settings.ShowArchives
	default:
		return true
	}
}

// GetSupportedExtensions returns list of supported file extensions
func (a *App) GetSupportedExtensions() map[string][]string {
	return map[string][]string{
		"photos":               {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp", ".tiff", ".svg"},
		"videos":               {".mp4", ".mkv", ".mov", ".avi", ".webm", ".flv", ".wmv"},
		"audio":                {".mp3", ".wav", ".flac", ".aac", ".m4a", ".ogg"},
		"software_photoshop":   {".psd", ".psdt"},
		"software_illustrator": {".ai", ".eps", ".ait"},
		"software_video":       {".prproj", ".aep"},
		"documents":            {".pdf", ".indd"},
		"executables":          {".exe", ".msi", ".bat", ".sh"},
		"compressed":           {".zip", ".rar", ".7z", ".iso"},
		"code":                 {".php", ".go", ".js", ".py", ".html", ".css"},
	}
}

// GetFilePreview returns a full-size preview of an image file with caching
func (a *App) GetFilePreview(filePath string) (string, error) {
	// Check if file exists
	fileInfo, err := os.Stat(filePath)
	if os.IsNotExist(err) {
		return "", fmt.Errorf("file does not exist")
	}

	// Check if it's an image
	if GetFileType(filepath.Ext(filePath)) != "image" {
		return "", fmt.Errorf("file is not an image")
	}

	// Get preview cache directory
	cacheDir, err := GetPreviewCacheDir(a.settings.CachePath)
	if err != nil {
		return a.generatePreviewWithoutCache(filePath)
	}

	// Generate cache key based on file path and modification time
	cacheKey := generatePreviewCacheKey(filePath, fileInfo.ModTime())
	cachePath := filepath.Join(cacheDir, cacheKey+".jpg")

	// Check if cached preview exists and is valid
	if cachedInfo, err := os.Stat(cachePath); err == nil {
		if cachedInfo.ModTime().After(fileInfo.ModTime()) {
			data, err := os.ReadFile(cachePath)
			if err == nil {
				base64Data := base64.StdEncoding.EncodeToString(data)
				return fmt.Sprintf("data:image/jpeg;base64,%s", base64Data), nil
			}
		}
	}

	// Generate preview and cache it
	return a.generateAndCachePreview(filePath, cachePath)
}

// generatePreviewWithoutCache generates a preview without caching (fallback)
func (a *App) generatePreviewWithoutCache(filePath string) (string, error) {
	ext := strings.ToLower(filepath.Ext(filePath))
	fileInfo, _ := os.Stat(filePath)

	// For smaller files (< 10MB) that are not HEIC, just read and return
	if fileInfo != nil && fileInfo.Size() < 10*1024*1024 && !(ext == ".heic" || ext == ".heif") {
		data, err := os.ReadFile(filePath)
		if err != nil {
			return "", fmt.Errorf("failed to read file: %w", err)
		}

		contentType := "image/jpeg"
		switch ext {
		case ".png":
			contentType = "image/png"
		case ".gif":
			contentType = "image/gif"
		case ".webp":
			contentType = "image/webp"
		case ".bmp":
			contentType = "image/bmp"
		}

		base64Data := base64.StdEncoding.EncodeToString(data)
		return fmt.Sprintf("data:%s;base64,%s", contentType, base64Data), nil
	}

	src, err := a.loadImage(filePath)
	if err != nil {
		return "", err
	}

	src = a.resizeForPreview(src)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, src, &jpeg.Options{Quality: 85}); err != nil {
		return "", fmt.Errorf("failed to encode preview: %w", err)
	}

	base64Data := base64.StdEncoding.EncodeToString(buf.Bytes())
	return fmt.Sprintf("data:image/jpeg;base64,%s", base64Data), nil
}

// generateAndCachePreview generates a preview and saves it to cache
func (a *App) generateAndCachePreview(filePath string, cachePath string) (string, error) {
	src, err := a.loadImage(filePath)
	if err != nil {
		return "", err
	}

	src = a.resizeForPreview(src)

	// Save to cache
	if err := imaging.Save(src, cachePath, imaging.JPEGQuality(85)); err != nil {
		// If caching fails, still return the preview
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, src, &jpeg.Options{Quality: 85}); err != nil {
			return "", fmt.Errorf("failed to encode preview: %w", err)
		}
		base64Data := base64.StdEncoding.EncodeToString(buf.Bytes())
		return fmt.Sprintf("data:image/jpeg;base64,%s", base64Data), nil
	}

	// Read from cache and return
	data, err := os.ReadFile(cachePath)
	if err != nil {
		return "", fmt.Errorf("failed to read cached preview: %w", err)
	}

	base64Data := base64.StdEncoding.EncodeToString(data)
	return fmt.Sprintf("data:image/jpeg;base64,%s", base64Data), nil
}

// loadImage loads an image file, handling HEIC format
func (a *App) loadImage(filePath string) (image.Image, error) {
	ext := strings.ToLower(filepath.Ext(filePath))

	if ext == ".heic" || ext == ".heif" {
		file, err := os.Open(filePath)
		if err != nil {
			return nil, fmt.Errorf("failed to open heic file: %w", err)
		}
		defer file.Close()

		src, err := goheif.Decode(file)
		if err != nil {
			return nil, fmt.Errorf("failed to decode heic: %w", err)
		}
		return src, nil
	}

	src, err := imaging.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open image: %w", err)
	}
	return src, nil
}

// resizeForPreview resizes image for preview display (max 1920x1080)
func (a *App) resizeForPreview(src image.Image) image.Image {
	bounds := src.Bounds()
	if bounds.Dx() > 1920 || bounds.Dy() > 1080 {
		return imaging.Fit(src, 1920, 1080, imaging.Linear)
	}
	return src
}

// GetPreviewCacheDir returns the directory for preview cache
func GetPreviewCacheDir(overridePath string) (string, error) {
	if overridePath != "" {
		cacheDir := filepath.Join(overridePath, "PhotoSort", "previews")
		if err := os.MkdirAll(cacheDir, 0755); err != nil {
			return "", err
		}
		return cacheDir, nil
	}

	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = os.Getenv("LOCALAPPDATA")
	}
	if appData == "" {
		return "", fmt.Errorf("could not determine app data directory")
	}

	cacheDir := filepath.Join(appData, "PhotoSort", "previews")
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return "", err
	}

	return cacheDir, nil
}

// ClearPreviewCache removes all cached previews
func ClearPreviewCache(overridePath string) error {
	cacheDir, err := GetPreviewCacheDir(overridePath)
	if err != nil {
		return err
	}
	return os.RemoveAll(cacheDir)
}

// generatePreviewCacheKey generates a unique cache key for preview images
func generatePreviewCacheKey(filePath string, modTime time.Time) string {
	h := md5.New()
	h.Write([]byte(filePath))
	h.Write([]byte(modTime.String()))
	return hex.EncodeToString(h.Sum(nil))
}

// GetThumbnail returns a base64 encoded thumbnail of an image file
func (a *App) GetThumbnail(filePath string) (string, error) {
	thumbnailPath, err := GenerateThumbnail(filePath, a.settings.CachePath)
	if err != nil {
		return "", err
	}

	thumbnailData, err := os.ReadFile(thumbnailPath)
	if err != nil {
		return "", fmt.Errorf("failed to read thumbnail: %w", err)
	}

	base64Thumbnail := base64.StdEncoding.EncodeToString(thumbnailData)
	return "data:image/jpeg;base64," + base64Thumbnail, nil
}

// Greet returns a greeting for testing
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, Welcome to PhotoSort!", name)
}

// QuitApplication gracefully quits the application
func (a *App) QuitApplication() {
	runtime.Quit(a.ctx)
}

// ToggleFullscreen toggles between fullscreen and normal window state
func (a *App) ToggleFullscreen() {
	if runtime.WindowIsFullscreen(a.ctx) {
		runtime.WindowUnfullscreen(a.ctx)
	} else {
		runtime.WindowFullscreen(a.ctx)
	}
}

// ProcessAICommand uses Gemini to parse natural language commands with history and multimodal support
func (a *App) ProcessAICommand(query string, appStateJson string, historyJson string, attachmentsJson string) (map[string]interface{}, error) {
	apiKey := strings.TrimSpace(a.settings.GeminiAPIKey)
	if apiKey == "" {
		return nil, fmt.Errorf("Gemini API Key is missing. Please set it in Settings and click SAVE.")
	}

	ctx := context.Background()
	// Use default endpoint behavior which automatically points to v1beta for gemini-2.5-flash
	client, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		return nil, fmt.Errorf("failed to create Gemini client: %w", err)
	}
	defer client.Close()

	// Use gemini-2.0-flash for multimodal processing and reasoning
	model := client.GenerativeModel("gemini-2.0-flash")

	// Define tools (function calling)
	model.Tools = []*genai.Tool{
		{
			FunctionDeclarations: []*genai.FunctionDeclaration{
				{
					Name:        "merge_groups",
					Description: "Merge multiple AI groups into one. Requires at least 2 group IDs.",
					Parameters: &genai.Schema{
						Type: genai.TypeObject,
						Properties: map[string]*genai.Schema{
							"groupIds": {
								Type:        genai.TypeArray,
								Items:       &genai.Schema{Type: genai.TypeString},
								Description: "IDs of the groups to merge (e.g. ['1', '2'])",
							},
						},
						Required: []string{"groupIds"},
					},
				},
				{
					Name:        "set_theme",
					Description: "Change the application appearance theme.",
					Parameters: &genai.Schema{
						Type: genai.TypeObject,
						Properties: map[string]*genai.Schema{
							"theme": {
								Type:        genai.TypeString,
								Enum:        []string{"light", "dark"},
								Description: "The theme to apply",
							},
						},
						Required: []string{"theme"},
					},
				},
				{
					Name:        "navigate_to",
					Description: "Change current view or section of the app.",
					Parameters: &genai.Schema{
						Type: genai.TypeObject,
						Properties: map[string]*genai.Schema{
							"section": {
								Type:        genai.TypeString,
								Enum:        []string{"trash", "all", "groups"},
								Description: "Section to navigate to",
							},
						},
						Required: []string{"section"},
					},
				},
				{
					Name:        "filter_files",
					Description: "Search or filter files by name, type, or date.",
					Parameters: &genai.Schema{
						Type: genai.TypeObject,
						Properties: map[string]*genai.Schema{
							"query": {
								Type:        genai.TypeString,
								Description: "The search or filter term",
							},
						},
						Required: []string{"query"},
					},
				},
				{
					Name:        "create_group",
					Description: "Create a new AI group with specific files. Use this when the user asks to 'group' or 'create a group' with specific filters.",
					Parameters: &genai.Schema{
						Type: genai.TypeObject,
						Properties: map[string]*genai.Schema{
							"name": {
								Type:        genai.TypeString,
								Description: "Target name for the group",
							},
							"fileNames": {
								Type:        genai.TypeArray,
								Items:       &genai.Schema{Type: genai.TypeString},
								Description: "List of filenames to include in the group",
							},
						},
						Required: []string{"name", "fileNames"},
					},
				},
			},
		},
	}

	// Set system instructions
	model.SystemInstruction = &genai.Content{
		Parts: []genai.Part{
			genai.Text(fmt.Sprintf(`You are the PhotoSort Assistant. You process commands in English or Indonesian.
You ONLY execute tasks related to file management, groups, and UI themes.
Refuse harmful or unrelated requests politely.
Respond with Indonesian if the user uses Indonesian.
Current App State: %s`, appStateJson)),
		},
	}

	session := model.StartChat()

	// Load history
	if historyJson != "" {
		var history []AIMessage
		if err := json.Unmarshal([]byte(historyJson), &history); err == nil {
			for _, msg := range history {
				// Map frontend "user" role to Gemini "user" and "model" to "model"
				role := msg.Role
				if role == "assistant" || role == "ai" {
					role = "model"
				}
				session.History = append(session.History, &genai.Content{
					Role:  role,
					Parts: []genai.Part{genai.Text(msg.Content)},
				})
			}
		}
	}

	// Prepare parts (multimodal support)
	parts := []genai.Part{genai.Text(query)}
	if attachmentsJson != "" {
		var attachments []AIAttachment
		if err := json.Unmarshal([]byte(attachmentsJson), &attachments); err == nil {
			for _, att := range attachments {
				data, err := base64.StdEncoding.DecodeString(att.Data)
				if err == nil {
					parts = append(parts, genai.Blob{
						MIMEType: att.MimeType,
						Data:     data,
					})
				}
			}
		}
	}

	resp, err := session.SendMessage(ctx, parts...)
	if err != nil {
		return nil, fmt.Errorf("AI request failed: %w", err)
	}

	result := make(map[string]interface{})

	if len(resp.Candidates) > 0 && resp.Candidates[0].Content != nil {
		for _, part := range resp.Candidates[0].Content.Parts {
			switch p := part.(type) {
			case genai.FunctionCall:
				result["function"] = p.Name
				result["args"] = p.Args
			case genai.Text:
				result["message"] = string(p)
			}
		}
	}

	return result, nil
}

// TestGeminiConnection tests if the provided API key works
func (a *App) TestGeminiConnection(apiKey string) (string, error) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return "", fmt.Errorf("API Key is empty")
	}

	ctx := context.Background()
	// Use default endpoint behavior
	client, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		return "", fmt.Errorf("failed to create client: %w", err)
	}
	defer client.Close()

	model := client.GenerativeModel("gemini-2.5-flash")
	resp, err := model.GenerateContent(ctx, genai.Text("Say 'Connection Successful' if you can read this."))
	if err != nil {
		return "", fmt.Errorf("connection failed: %w", err)
	}

	if len(resp.Candidates) > 0 && resp.Candidates[0].Content != nil {
		for _, part := range resp.Candidates[0].Content.Parts {
			if text, ok := part.(genai.Text); ok {
				return string(text), nil
			}
		}
	}

	return "No response from model", nil
}

// RotateImage rotates an image file by the specified angle
// Returns the file path (unchanged since we don't convert formats)
func (a *App) RotateImage(path string, angle int) (string, error) {
	// Validate angle (must be multiple of 90)
	if angle%90 != 0 {
		return "", fmt.Errorf("angle must be a multiple of 90")
	}

	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".gif" {
		return "", fmt.Errorf("rotation is not supported for GIF files")
	}
	if ext == ".heic" || ext == ".heif" {
		return "", fmt.Errorf("rotation is not supported for HEIC/HEIF files")
	}

	// Load image
	src, err := a.loadImage(path)
	if err != nil {
		return "", fmt.Errorf("failed to open image: %w", err)
	}

	// Rotate
	rotated := imaging.Rotate(src, float64(angle), color.Transparent)

	// Save rotated image (same format)
	err = imaging.Save(rotated, path)
	if err != nil {
		return "", fmt.Errorf("failed to save rotated image: %w", err)
	}

	// Regenerate thumbnail
	_, err = GenerateThumbnailSync(path, a.settings.CachePath)
	if err != nil {
		log.Printf("Warning: Failed to regenerate thumbnail for %s: %v", path, err)
	}

	return path, nil
}
