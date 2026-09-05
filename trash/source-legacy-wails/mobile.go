package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows"
)

type MobileDevice struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	DeviceType  string `json:"deviceType"`
	DriveLetter string `json:"driveLetter"`
	Path        string `json:"path"`
}

type MobileFolder struct {
	ID     string       `json:"id"`
	Name   string       `json:"name"`
	Path   string       `json:"path"`
	Files  []MobileFile `json:"files"`
	IsRoot bool         `json:"isRoot"`
}

type MobileFile struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	Modified string `json:"modified"`
}

type MobileImportResult struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	FilesImported int    `json:"filesImported"`
	FilesSkipped  int    `json:"filesSkipped"`
}

const (
	DRIVE_REMOVABLE = 2
	DRIVE_FIXED     = 3
	DRIVE_CDROM     = 5
	DRIVE_REMOTE    = 4
	DRIVE_RAMDISK   = 6
)

var (
	modkernel32 = windows.NewLazySystemDLL("kernel32.dll")
)

func GetLogicalDriveStrings() ([]string, error) {
	buffer := make([]byte, 256)
	n, _, err := modkernel32.NewProc("GetLogicalDriveStringsW").Call(uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)))
	if n == 0 {
		if err != nil {
			return nil, fmt.Errorf("GetLogicalDriveStringsW failed: %w", err)
		}
		return nil, nil
	}

	drives := []string{}
	idx := 0
	for idx < int(n) {
		if buffer[idx] == 0 {
			break
		}
		drive := ""
		for buffer[idx] != 0 {
			drive += string(buffer[idx])
			idx++
		}
		if drive != "" {
			drives = append(drives, drive)
		}
		idx++
	}

	return drives, nil
}

func GetDriveType(drive string) uintptr {
	drivePtr, _ := syscall.UTF16PtrFromString(drive)
	dt, _, _ := modkernel32.NewProc("GetDriveTypeW").Call(uintptr(unsafe.Pointer(drivePtr)))
	return dt
}

func GetDeviceName(drive string) string {
	var volumeName [256]uint16
	namePtr, _ := syscall.UTF16PtrFromString(drive[:len(drive)-1])
	modkernel32.NewProc("GetVolumeInformationW").Call(
		uintptr(unsafe.Pointer(namePtr)),
		uintptr(unsafe.Pointer(&volumeName[0])),
		uintptr(len(volumeName)), 0, 0, 0, 0, 0)

	name := windows.UTF16ToString(volumeName[:])
	if name == "" {
		return drive[:len(drive)-1]
	}
	return name
}

func QueryDosDevice(driveLetter string) (string, error) {
	deviceName := driveLetter + ":"
	deviceNamePtr, _ := syscall.UTF16PtrFromString(deviceName)

	var buffer [1024]uint16
	n, _, err := modkernel32.NewProc("QueryDosDeviceW").Call(
		uintptr(unsafe.Pointer(deviceNamePtr)),
		uintptr(unsafe.Pointer(&buffer[0])),
		uintptr(len(buffer)),
	)

	if n == 0 {
		return "", fmt.Errorf("QueryDosDeviceW failed: %w", err)
	}

	return windows.UTF16ToString(buffer[:]), nil
}

func IsMobileDevice(drive string) bool {
	driveType := GetDriveType(drive)
	if driveType == DRIVE_REMOVABLE {
		driveLetter := drive[:1]
		targetPath, err := QueryDosDevice(driveLetter)
		if err == nil {
			lowerPath := strings.ToLower(targetPath)
			if strings.Contains(lowerPath, "usb") ||
				strings.Contains(lowerPath, "mtp") ||
				strings.Contains(lowerPath, "portable") {
				return true
			}
		}
	}
	return false
}

func (a *App) GetConnectedMobileDevices() ([]MobileDevice, error) {
	devices := []MobileDevice{}

	drives, err := GetLogicalDriveStrings()
	if err != nil {
		return nil, err
	}

	for _, drive := range drives {
		drivePath := filepath.Join(drive, "\\")
		driveType := GetDriveType(drivePath)

		if driveType == DRIVE_REMOVABLE {
			volumeName := GetDeviceName(drivePath)

			device := MobileDevice{
				ID:          fmt.Sprintf("mobile_%s", strings.ToLower(strings.ReplaceAll(volumeName, " ", "_"))),
				Name:        fmt.Sprintf("%s (%s)", volumeName, drive[:1]),
				DeviceType:  "USB Device",
				DriveLetter: drive[:1],
				Path:        drivePath,
			}

			devices = append(devices, device)
		}
	}

	if len(devices) == 0 {
		devices = append(devices, MobileDevice{
			ID:         "no_device",
			Name:       "No mobile device connected",
			DeviceType: "placeholder",
			Path:       "",
		})
	}

	return devices, nil
}

func (a *App) GetMobileDeviceFolders(deviceID string) ([]MobileFolder, error) {
	driveLetter := ""
	for _, char := range deviceID {
		if char >= 'A' && char <= 'Z' {
			driveLetter = string(char)
			break
		}
	}

	if driveLetter == "" && len(deviceID) > 0 {
		driveLetter = string(deviceID[0])
	}

	rootPath := driveLetter + ":\\"

	entries, err := os.ReadDir(rootPath)
	if err != nil {
		return nil, fmt.Errorf("failed to access device: %w", err)
	}

	folders := []MobileFolder{}

	for _, entry := range entries {
		if entry.IsDir() {
			path := filepath.Join(rootPath, entry.Name())

			folder := MobileFolder{
				ID:     fmt.Sprintf("folder_%s", entry.Name()),
				Name:   entry.Name(),
				Path:   path,
				IsRoot: false,
			}

			subFiles, _ := a.GetMobileDeviceFiles(path)
			folder.Files = subFiles

			folders = append(folders, folder)
		}
	}

	return folders, nil
}

func (a *App) GetMobileDeviceFiles(folderPath string) ([]MobileFile, error) {
	files := []MobileFile{}

	entries, err := os.ReadDir(folderPath)
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			info, err := entry.Info()
			if err != nil {
				continue
			}

			ext := filepath.Ext(entry.Name())
			fileType := GetFileType(ext)

			if fileType == "image" || fileType == "video" {
				file := MobileFile{
					ID:       fmt.Sprintf("file_%d", len(files)),
					Name:     entry.Name(),
					Path:     filepath.Join(folderPath, entry.Name()),
					Size:     info.Size(),
					Modified: info.ModTime().Format("2006-01-02 15:04:05"),
				}

				files = append(files, file)
			}
		}
	}

	return files, nil
}

func (a *App) GetMobileDeviceContent(deviceID string) (map[string]interface{}, error) {
	folders, err := a.GetMobileDeviceFolders(deviceID)
	if err != nil {
		return nil, err
	}

	result := map[string]interface{}{
		"deviceID": deviceID,
		"folders":  folders,
	}

	return result, nil
}

func (a *App) SelectMobileFolder(deviceID string) (string, error) {
	selectedPath, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Folder from Mobile Device",
	})
	if err != nil {
		return "", err
	}

	return selectedPath, nil
}

func (a *App) ImportFromMobileDevice(sourcePath string, destinationPath string) (MobileImportResult, error) {
	files, err := os.ReadDir(sourcePath)
	if err != nil {
		return MobileImportResult{}, fmt.Errorf("failed to read source path: %w", err)
	}

	copied := 0
	skipped := 0

	for _, file := range files {
		if file.IsDir() {
			continue
		}

		ext := filepath.Ext(file.Name())
		fileType := GetFileType(ext)

		if fileType == "image" || fileType == "video" {
			sourceFile := filepath.Join(sourcePath, file.Name())
			destFile := filepath.Join(destinationPath, file.Name())

			_, err := os.Stat(destFile)
			if err == nil {
				skipped++
				continue
			}

			err = copyFile(sourceFile, destFile)
			if err != nil {
				return MobileImportResult{}, fmt.Errorf("failed to copy %s: %w", file.Name(), err)
			}
			copied++
		}
	}

	return MobileImportResult{
		Success:       true,
		Message:       fmt.Sprintf("Imported %d files from mobile device", copied),
		FilesImported: copied,
		FilesSkipped:  skipped,
	}, nil
}

func (a *App) ScanMobileFolder(folderPath string) (FolderContent, error) {
	var content FolderContent
	content.Files = []FileInfo{}
	content.Subfolders = []FolderInfo{}

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
			subfolder := FolderInfo{
				ID:        generateFileID(path),
				Name:      info.Name(),
				Path:      path,
				FileCount: 0,
			}
			content.Subfolders = append(content.Subfolders, subfolder)
		} else {
			fileInfo := FileInfo{
				ID:         generateFileID(path),
				Path:       path,
				Name:       info.Name(),
				Extension:  filepath.Ext(path),
				Size:       info.Size(),
				CreatedAt:  info.ModTime(),
				ModifiedAt: info.ModTime(),
				FileType:   GetFileType(filepath.Ext(path)),
			}

			if a.shouldShowFileType(fileInfo.FileType) {
				content.Files = append(content.Files, fileInfo)
			}
		}
	}

	return content, nil
}

func OpenMobileDeviceInExplorer(devicePath string) error {
	if devicePath == "" {
		return fmt.Errorf("device path is empty")
	}

	cleanPath := filepath.Clean(devicePath)
	windowsPath := strings.ReplaceAll(cleanPath, "/", "\\")
	cmd := exec.Command("explorer", "/select,", windowsPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}
