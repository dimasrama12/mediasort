package main

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"
	"github.com/jdeng/goheif"
)

// ThumbnailSize is the size of generated thumbnails
const ThumbnailSize = 200

// GetThumbnailCacheDir returns the directory for thumbnail cache
func GetThumbnailCacheDir(overridePath string) (string, error) {
	if overridePath != "" {
		cacheDir := filepath.Join(overridePath, "PhotoSort", "thumbnails")
		err := os.MkdirAll(cacheDir, 0755)
		if err != nil {
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

	cacheDir := filepath.Join(appData, "PhotoSort", "thumbnails")
	err := os.MkdirAll(cacheDir, 0755)
	if err != nil {
		return "", err
	}

	return cacheDir, nil
}

// GetFileType returns the type of file based on extension
func GetFileType(extension string) string {
	ext := strings.ToLower(extension)

	imageExts := map[string]bool{
		".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
		".webp": true, ".bmp": true, ".tiff": true, ".svg": true,
		".heic": true, ".heif": true,
	}
	videoExts := map[string]bool{
		".mp4": true, ".mkv": true, ".mov": true, ".avi": true,
		".webm": true, ".flv": true, ".wmv": true,
	}
	audioExts := map[string]bool{
		".mp3": true, ".wav": true, ".flac": true, ".aac": true,
		".m4a": true, ".ogg": true,
	}
	documentExts := map[string]bool{
		".pdf": true, ".doc": true, ".docx": true, ".txt": true,
		".indd": true,
	}
	codeExts := map[string]bool{
		".php": true, ".go": true, ".js": true, ".py": true,
		".html": true, ".css": true, ".ts": true, ".tsx": true,
	}
	archiveExts := map[string]bool{
		".zip": true, ".rar": true, ".7z": true, ".iso": true,
	}

	if imageExts[ext] {
		return "image"
	}
	if videoExts[ext] {
		return "video"
	}
	if audioExts[ext] {
		return "audio"
	}
	if documentExts[ext] {
		return "document"
	}
	if codeExts[ext] {
		return "code"
	}
	if archiveExts[ext] {
		return "archive"
	}

	return "file"
}

type ThumbnailResult struct {
	Path string
	Err  error
}

type ThumbnailRequest struct {
	FilePath   string
	CachePath  string
	ResultChan chan ThumbnailResult
}

type ThumbnailQueue struct {
	requests   chan ThumbnailRequest
	semaphore  chan struct{}
	maxWorkers int
	activeJobs int32
}

// GlobalThumbnailQueue is the global queue for thumbnail generation
var GlobalThumbnailQueue = NewThumbnailQueue(3)

func NewThumbnailQueue(maxWorkers int) *ThumbnailQueue {
	queue := &ThumbnailQueue{
		requests:   make(chan ThumbnailRequest, 1000),
		semaphore:  make(chan struct{}, maxWorkers),
		maxWorkers: maxWorkers,
	}

	// Start workers
	for i := 0; i < maxWorkers; i++ {
		go queue.worker()
	}

	return queue
}

func (q *ThumbnailQueue) worker() {
	for req := range q.requests {
		q.semaphore <- struct{}{} // Acquire
		result := q.processRequest(req)
		req.ResultChan <- result
		<-q.semaphore // Release
	}
}

func (q *ThumbnailQueue) processRequest(req ThumbnailRequest) ThumbnailResult {
	path, err := GenerateThumbnailSync(req.FilePath, req.CachePath)
	return ThumbnailResult{Path: path, Err: err}
}

func (q *ThumbnailQueue) Enqueue(filePath, cachePath string) (string, error) {
	// Fast path: check if thumbnail already exists
	cacheDir, err := GetThumbnailCacheDir(cachePath)
	if err != nil {
		return "", err
	}

	hash := md5.Sum([]byte(filePath))
	cacheKey := hex.EncodeToString(hash[:])
	thumbnailPath := filepath.Join(cacheDir, cacheKey+".jpg")

	if info, err := os.Stat(thumbnailPath); err == nil {
		// Check if thumbnail is still valid (file hasn't been modified)
		if fileInfo, err := os.Stat(filePath); err == nil {
			if info.ModTime().After(fileInfo.ModTime()) {
				return thumbnailPath, nil
			}
		}
	}

	// Slow path: queue for generation
	resultChan := make(chan ThumbnailResult, 1)
	req := ThumbnailRequest{
		FilePath:   filePath,
		CachePath:  cachePath,
		ResultChan: resultChan,
	}

	select {
	case q.requests <- req:
		result := <-resultChan
		return result.Path, result.Err
	default:
		// Queue is full, generate synchronously
		return GenerateThumbnailSync(filePath, cachePath)
	}
}

// GenerateThumbnailSync creates a thumbnail synchronously
func GenerateThumbnailSync(filePath string, cachePath string) (string, error) {
	ext := filepath.Ext(filePath)
	fileType := GetFileType(ext)
	if fileType != "image" {
		// For non-image files, we'll return a generic icon based on type
		// but since GenerateThumbnail returns a path to a JPG, we should
		// really have static icons or generate a colored placeholder.
		// For now, let's just return a specific error or handle it in GetThumbnail.
		return "", fmt.Errorf("file is not an image")
	}

	// Generate cache key from file path
	hash := md5.Sum([]byte(filePath))
	cacheKey := hex.EncodeToString(hash[:])

	// Get cache directory
	cacheDir, err := GetThumbnailCacheDir(cachePath)
	if err != nil {
		return "", err
	}

	// Check if thumbnail already exists
	thumbnailPath := filepath.Join(cacheDir, cacheKey+".jpg")
	if info, err := os.Stat(thumbnailPath); err == nil {
		// Check if thumbnail is still valid
		if fileInfo, err := os.Stat(filePath); err == nil {
			if info.ModTime().After(fileInfo.ModTime()) {
				return thumbnailPath, nil
			}
		}
	}

	// Open source image
	var srcImage image.Image
	var errOpen error

	if strings.ToLower(ext) == ".heic" || strings.ToLower(ext) == ".heif" {
		file, err := os.Open(filePath)
		if err != nil {
			return "", fmt.Errorf("failed to open heic file: %w", err)
		}
		defer file.Close()

		srcImage, err = goheif.Decode(file)
		if err != nil {
			return "", fmt.Errorf("failed to decode heic: %w", err)
		}
	} else {
		srcImage, errOpen = imaging.Open(filePath)
		if errOpen != nil {
			return "", fmt.Errorf("failed to open image: %w", errOpen)
		}
	}

	// Generate thumbnail (200x200, maintain aspect ratio)
	thumbnail := imaging.Fit(srcImage, ThumbnailSize, ThumbnailSize, imaging.Lanczos)

	// Save thumbnail
	err = imaging.Save(thumbnail, thumbnailPath, imaging.JPEGQuality(85))
	if err != nil {
		return "", fmt.Errorf("failed to save thumbnail: %w", err)
	}

	return thumbnailPath, nil
}

// GenerateThumbnail creates a thumbnail for an image file (uses queue)
func GenerateThumbnail(filePath string, cachePath string) (string, error) {
	return GlobalThumbnailQueue.Enqueue(filePath, cachePath)
}

// ClearThumbnailCache removes all cached thumbnails
func ClearThumbnailCache(overridePath string) error {
	cacheDir, err := GetThumbnailCacheDir(overridePath)
	if err != nil {
		return err
	}

	return os.RemoveAll(cacheDir)
}
