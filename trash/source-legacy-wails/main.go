package main

import (
	"embed"
	"io"
	"log"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Ensure AppData/PhotoSort directory exists for logging
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = os.Getenv("LOCALAPPDATA")
	}
	logPath := filepath.Join(appData, "PhotoSort", "debug.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0755); err == nil {
		// Open log file
		f, err := os.OpenFile(logPath, os.O_RDWR|os.O_CREATE|os.O_APPEND, 0666)
		if err == nil {
			// Write to both file and stdout
			mw := io.MultiWriter(os.Stdout, f)
			log.SetOutput(mw)
			log.Printf("PhotoSort started. Logging to %s", logPath)
		}
	}

	// Create application instance
	app := NewApp()

	if err := wails.Run(&options.App{
		Title:            "PhotoSort - AI-Powered File Organizer",
		Width:            1400,
		Height:           900,
		MinWidth:         1024,
		MinHeight:        768,
		BackgroundColour: &options.RGBA{R: 15, G: 23, B: 42, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			DisableWindowIcon:    false,
		},
		Frameless: false, // Enable native window controls
	}); err != nil {
		log.Fatal(err)
	}
}
