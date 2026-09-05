package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

// PredefinedCategory represents one of the 50 predefined tags
type PredefinedCategory struct {
	Name        string   `json:"name"`
	Keywords    []string `json:"keywords"`
	Description string   `json:"description"`
}

// The 50 predefined categories/tags
var PredefinedCategories = []PredefinedCategory{
	{Name: "Anime/Manga", Keywords: []string{"anime", "manga", "cartoon", "animation", "japanese animation", "comic", "character", "senpai", "chan", "kun", "san", "pixiv", "danbooru", "gelbooru", "yandere", "tsundere", "moe", "shonen", "shojo", "seinen", "josei", "artstation", "deviantart", "illustration", "fanart", "otaku"}, Description: "Japanese animation and manga style artwork"},
	{Name: "Cartoon/Illustration", Keywords: []string{"cartoon", "illustration", "drawing", "artwork", "graphic", "vector", "comic style", "disney", "pixat", "nickelodeon", "animation", "character design"}, Description: "General cartoons and illustrations"},
	{Name: "Animal/Pet", Keywords: []string{"animal", "pet", "dog", "cat", "bird", "wildlife", "mammal", "creature", "zoo", "pup", "kitten", "hamster", "rabbit", "fish", "horse"}, Description: "Animals and pets"},
	{Name: "Scenery/Landscape", Keywords: []string{"landscape", "scenery", "nature", "view", "outdoor", "countryside", "field", "meadow", "panorama", "horizon", "landscape photography"}, Description: "Natural landscapes and scenery"},
	{Name: "Architecture/City", Keywords: []string{"building", "architecture", "city", "urban", "skyscraper", "structure", "construction", "house", "tower", "street", "road", "downtown", "metropolis", "bridge"}, Description: "Buildings, architecture, and cityscapes"},
	{Name: "People/Portrait", Keywords: []string{"person", "people", "portrait", "face", "human", "individual", "selfie", "headshot", "man", "woman", "girl", "boy", "model", "human silhouette"}, Description: "Portraits and photos of people"},
	{Name: "Group/Crowd", Keywords: []string{"group", "crowd", "team", "many people", "gathering", "audience", "multiple people", "party", "meeting", "protest", "concert crowd"}, Description: "Groups of people or crowds"},
	{Name: "Coding/Programming", Keywords: []string{"code", "programming", "developer", "software", "script", "terminal", "IDE", "editor", "syntax", "python", "javascript", "golang", "java", "github", "gitlab", "coding challenge", "source code", "vs code", "pycharm", "intellij", "sublime"}, Description: "Code, programming, and development"},
	{Name: "Web/App Design", Keywords: []string{"web design", "app design", "UI", "interface", "website", "mockup", "wireframe", "layout", "figma", "sketch", "adobe xd", "ux", "user experience", "design system", "dashboard"}, Description: "Web and application design"},
	{Name: "UI Screenshot", Keywords: []string{"screenshot", "UI", "interface", "desktop", "window", "application", "software", "menu", "dialog", "settings", "panel", "sidebar", "button", "input", "form", "sc", "ss", "scrn"}, Description: "Screenshots of user interfaces"},
	{Name: "Game Screenshot", Keywords: []string{"game", "gaming", "video game", "gameplay", "console", "rpg", "shooter", "adventure game", "steam", "epic", "ubisoft", "ea", "ps5", "xbox", "nintendo", "switch", "fps", "moba", "level", "hud", "inventory", "quest", "boss", "victory", "defeat"}, Description: "Video game screenshots"},
	{Name: "3D/CGI Render", Keywords: []string{"3d", "render", "CGI", "model", "blender", "maya", "3ds max", "cinematic", "digital art", "octane", "vray", "unreal engine", "unity", "zbrush", "low poly", "sculpt", "texturing"}, Description: "3D renders and CGI artwork"},
	{Name: "Food/Cuisine", Keywords: []string{"food", "meal", "dish", "cooking", "restaurant", "cuisine", "delicious", "plate", "gourmet", "breakfast", "lunch", "dinner", "snack", "dessert", "recipe", "chef"}, Description: "Food and cuisine"},
	{Name: "Drink/Beverage", Keywords: []string{"drink", "beverage", "coffee", "tea", "wine", "beer", "juice", "cocktail", "glass", "cup", "mug", "bottle", "bar", "cafe", "latte", "espresso"}, Description: "Drinks and beverages"},
	{Name: "Vehicle/Car", Keywords: []string{"car", "vehicle", "automobile", "truck", "motorcycle", "transportation", "driving", "road", "bike", "bicycle", "bus", "train", "plane", "airplane", "ship", "boat"}, Description: "Vehicles and transportation"},
	{Name: "Space/Astronomy", Keywords: []string{"space", "galaxy", "star", "planet", "universe", "astronomy", "cosmos", "nebula", "moon", "sun", "earth", "mars", "jupiter", "saturn", "black hole", "telescope", "astronaut", "nasa"}, Description: "Space and astronomy"},
	{Name: "Nature/Macro", Keywords: []string{"macro", "close-up", "detail", "flower", "insect", "leaf", "plant", "botanical", "micro", "pollen", "butterfly", "bee", "texture", "surface"}, Description: "Macro photography and nature details"},
	{Name: "Beach/Underwater", Keywords: []string{"beach", "ocean", "sea", "underwater", "diving", "coral", "marine", "sand", "coast", "waves", "shore", "island", "tropical", "snorkeling", "scuba"}, Description: "Beach and underwater scenes"},
	{Name: "Forest/Mountain", Keywords: []string{"forest", "mountain", "tree", "woods", "hiking", "peak", "valley", "nature trail", "park", "cliff", "hill", "pines", "alpine", "summit"}, Description: "Forests and mountains"},
	{Name: "Sky/Clouds", Keywords: []string{"sky", "cloud", "sunset", "sunrise", "blue sky", "weather", "storm", "rainbow", "heaven", "lightning", "thunder", "dusk", "dawn", "twilight"}, Description: "Sky and clouds"},
	{Name: "Night/Dark", Keywords: []string{"night", "dark", "evening", "midnight", "stars", "moonlight", "nighttime", "nocturnal", "shadow", "silhouette", "glow", "neon", "low light"}, Description: "Night and dark scenes"},
	{Name: "Technology/Gadget", Keywords: []string{"technology", "gadget", "device", "electronics", "smartphone", "laptop", "computer", "tech", "digital", "tablet", "monitor", "keyboard", "mouse", "camera", "lens", "headphones"}, Description: "Technology and gadgets"},
	{Name: "Interior/Room", Keywords: []string{"interior", "room", "indoor", "furniture", "home", "living room", "bedroom", "decor", "house", "kitchen", "bathroom", "office", "studio", "ceiling", "floor", "wall"}, Description: "Interior spaces and rooms"},
	{Name: "Fashion/Style", Keywords: []string{"fashion", "style", "clothing", "outfit", "dress", "apparel", "trend", "model", "designer", "jewelry", "bag", "shoes", "makeup", "beauty", "cosmetics"}, Description: "Fashion and style"},
	{Name: "Sport/Active", Keywords: []string{"sport", "active", "fitness", "exercise", "athletic", "running", "training", "workout", "game", "football", "basketball", "soccer", "tennis", "gym", "athlete", "competition"}, Description: "Sports and active lifestyle"},
	{Name: "Music/Recording", Keywords: []string{"music", "recording", "studio", "instrument", "concert", "performance", "band", "singer", "album", "guitar", "piano", "drums", "microphone", "audio", "sound"}, Description: "Music and recording"},
	{Name: "Movie/Cinematic", Keywords: []string{"movie", "film", "cinema", "cinematic", "hollywood", "actor", "scene", "production", "director", "frame", "movie shot", "theatre", "trailer", "poster", "netflix", "hulu", "disney plus", "subtitle", "subbed", "dubbed", "blu-ray", "4k", "hd"}, Description: "Movies and cinematic content"},
	{Name: "Document/Scan", Keywords: []string{"document", "scan", "paper", "text", "file", "receipt", "invoice", "letter", "form", "page", "book", "pdf", "word", "excel", "report", "official", "contract"}, Description: "Documents and scanned files"},
	{Name: "Drawing/Sketch", Keywords: []string{"drawing", "sketch", "doodle", "pencil", "hand drawn", "art", "illustration", "draft", "charcoal", "outline", "concept art"}, Description: "Drawings and sketches"},
	{Name: "Painting/Fine Art", Keywords: []string{"painting", "fine art", "artwork", "canvas", "oil painting", "watercolor", "acrylic", "gallery", "exhibition", "museum", "masterpiece", "brush stroke"}, Description: "Paintings and fine art"},
	{Name: "Sculpture/Craft", Keywords: []string{"sculpture", "craft", "handmade", "artisan", "pottery", "woodwork", "statue", "figure", "clay", "metalwork", "ceramics"}, Description: "Sculptures and crafts"},
	{Name: "Map/Data Viz", Keywords: []string{"map", "chart", "graph", "data", "visualization", "infographic", "diagram", "statistics", "atlas", "cartography", "topology", "demographic"}, Description: "Maps and data visualizations"},
	{Name: "Logo/Iconography", Keywords: []string{"logo", "icon", "symbol", "brand", "emblem", "badge", "trademark", "identity", "mark", "wordmark", "monogram"}, Description: "Logos and icons"},
	{Name: "Abstract/Texture", Keywords: []string{"abstract", "texture", "pattern", "background", "wallpaper", "gradient", "design", "art", "shapes", "colors", "blur", "bokeh", "geometric"}, Description: "Abstract art and textures"},
	{Name: "Black & White", Keywords: []string{"black and white", "monochrome", "grayscale", "bnw", "noir", "classic", "vintage photo", "contrast", "silvertone"}, Description: "Black and white photography"},
	{Name: "Vintage/Retro", Keywords: []string{"vintage", "retro", "old", "classic", "antique", "nostalgic", "sepia", "aged", "historic", "polaroid", "film photography", "80s", "90s", "old school"}, Description: "Vintage and retro style"},
	{Name: "Wedding/Ceremony", Keywords: []string{"wedding", "marriage", "ceremony", "bride", "groom", "celebration", "reception", "vows", "altar", "bouquet", "wedding dress", "rings"}, Description: "Weddings and ceremonies"},
	{Name: "Party/Celebration", Keywords: []string{"party", "celebration", "event", "birthday", "festival", "gathering", "festive", "fun", "balloons", "cake", "cheers", "dancing"}, Description: "Parties and celebrations"},
	{Name: "Stage/Concert", Keywords: []string{"stage", "concert", "performance", "live", "show", "theater", "venue", "spotlight", "lights", "stage lighting", "performance art"}, Description: "Stage performances and concerts"},
	{Name: "Medical/Lab", Keywords: []string{"medical", "health", "hospital", "doctor", "laboratory", "science", "biology", "medicine", "pill", "surgery", "exam", "clinical", "research"}, Description: "Medical and laboratory"},
	{Name: "Industrial/Work", Keywords: []string{"industrial", "factory", "manufacturing", "workshop", "machinery", "production", "industry", "construction site", "warehouse", "logistics"}, Description: "Industrial and work environments"},
	{Name: "Tool/Equipment", Keywords: []string{"tool", "equipment", "hardware", "instrument", "device", "gear", "machinery", "drill", "hammer", "wrench", "multimeter"}, Description: "Tools and equipment"},
	{Name: "Furniture/Object", Keywords: []string{"furniture", "object", "chair", "table", "lamp", "decor", "item", "product", "couch", "sofa", "shelf", "desk"}, Description: "Furniture and objects"},
	{Name: "Toy/Collectible", Keywords: []string{"toy", "collectible", "figure", "action figure", "doll", "plush", "hobby", "collection", "lego", "model kit", "miniature"}, Description: "Toys and collectibles"},
	{Name: "Book/Magazine", Keywords: []string{"book", "magazine", "publication", "reading", "literature", "novel", "comic book", "cover", "journal", "library", "textbook", "author"}, Description: "Books and magazines"},
	{Name: "Social Media/Meme", Keywords: []string{"meme", "social media", "viral", "funny", "internet", "trending", "reaction", "emoji", "twitter", "instagram", "facebook", "tiktok", "shitpost", "reddit"}, Description: "Social media and memes"},
	{Name: "Workout/Gym", Keywords: []string{"workout", "gym", "fitness", "exercise", "bodybuilding", "weights", "training", "health", "dumbbells", "cardio", "stretching", "yoga"}, Description: "Workout and gym"},
	{Name: "Travel/Adventure", Keywords: []string{"travel", "adventure", "tourism", "vacation", "trip", "journey", "explore", "destination", "passport", "suitcase", "map", "tour"}, Description: "Travel and adventure"},
	{Name: "Shopping/Product", Keywords: []string{"shopping", "product", "retail", "store", "ecommerce", "merchandise", "item", "catalog", "cart", "bag", "label", "price tag"}, Description: "Shopping and products"},
	{Name: "Grup", Keywords: []string{"grup", "group", "other", "various", "mixed", "unknown", "uncategorized", "misc", "rest"}, Description: "General group for mixed content"},
}

// EnhancedGroupConfig holds enhanced AI grouping configuration
type EnhancedGroupConfig struct {
	SimilarityThreshold int     `json:"similarityThreshold"`
	TimeWindowHours     float64 `json:"timeWindowHours"`
	MinGroupSize        int     `json:"minGroupSize"`
	UseAIClassification bool    `json:"useAIClassification"`
	ConfidenceThreshold float64 `json:"confidenceThreshold"`
}

// ClassifiedGroup represents a group with AI classification
type ClassifiedGroup struct {
	FileGroup
	Category    string  `json:"category"`
	Confidence  float64 `json:"confidence"`
	Description string  `json:"description"`
}

// AnalyzeImageWithGemini analyzes an image using Gemini AI and returns the best matching category
func (a *App) AnalyzeImageWithGemini(imagePath string) (string, float64, error) {
	apiKey := strings.TrimSpace(a.settings.GeminiAPIKey)
	if apiKey == "" {
		log.Printf("[AnalyzeImage] Error: Gemini API Key not configured")
		return "Grup", 0.0, fmt.Errorf("Gemini API Key not configured")
	}

	// Read and encode image
	imageData, err := os.ReadFile(imagePath)
	if err != nil {
		log.Printf("[AnalyzeImage] Failed to read image %s: %v", imagePath, err)
		return "Grup", 0.0, fmt.Errorf("failed to read image: %w", err)
	}

	// Check file size (Gemini has limits)
	if len(imageData) > 20*1024*1024 { // 20MB limit
		log.Printf("[AnalyzeImage] Image too large: %s (%d bytes)", imagePath, len(imageData))
		return "Grup", 0.0, fmt.Errorf("image too large")
	}

	ctx := context.Background()
	client, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		log.Printf("[AnalyzeImage] Failed to create Gemini client: %v", err)
		return "Grup", 0.0, fmt.Errorf("failed to create Gemini client: %w", err)
	}
	defer client.Close()

	// Use gemini-2.0-flash for fast image analysis
	modelName := "gemini-2.0-flash"
	model := client.GenerativeModel(modelName)
	log.Printf("[AnalyzeImage] Using model: %s", modelName)

	// Set temperature to get more consistent results
	model.SetTemperature(0.1)

	// Build category list for prompt
	var categoryNames []string
	for _, cat := range PredefinedCategories {
		if cat.Name != "Grup" && cat.Name != "Miscellaneous" {
			categoryNames = append(categoryNames, cat.Name)
		}
	}
	categoriesJSON, _ := json.Marshal(categoryNames)

	// Create detailed prompt with improved instructions
	prompt := fmt.Sprintf(`Analyze this image and classify it into EXACTLY ONE of these categories:
%s

INSTRUCTIONS:
1. Choose the MOST SPECIFIC category that matches the main subject of the image
2. If you see code/IDE/terminal → use "Coding/Programming"
3. If you see anime/cartoon characters → use "Anime/Manga"
4. If you see movie/film frames → use "Movie/Cinematic"  
5. If you see UI/app interfaces → use "UI Screenshot" or "Web/App Design"
6. If you see food/dishes → use "Food/Cuisine"
7. If you see buildings/city → use "Architecture/City"
8. If you see fashion/clothing → use "Fashion/Style"
9. If you see people/portraits → use "People/Portrait"
10. DO NOT use "Grup" - always pick a specific category

Your response MUST be valid JSON in this exact format:
{"category":"Category Name","confidence":0.95}`, string(categoriesJSON))

	// Detect MIME type
	mimeType := "image/jpeg"
	ext := strings.ToLower(filepath.Ext(imagePath))
	switch ext {
	case ".png":
		mimeType = "image/png"
	case ".gif":
		mimeType = "image/gif"
	case ".webp":
		mimeType = "image/webp"
	case ".bmp":
		mimeType = "image/bmp"
	}

	// Generate content
	resp, err := model.GenerateContent(ctx,
		genai.Text(prompt),
		genai.Blob{
			MIMEType: mimeType,
			Data:     imageData,
		})

	if err != nil {
		log.Printf("[AnalyzeImage] Gemini API error for %s: %v", imagePath, err)
		// Try to extract category from error or fallback
		return "Grup", 0.0, nil
	}

	// Parse response
	if len(resp.Candidates) > 0 && resp.Candidates[0].Content != nil {
		for _, part := range resp.Candidates[0].Content.Parts {
			if text, ok := part.(genai.Text); ok {
				textStr := string(text)
				log.Printf("[AnalyzeImage] Raw response for %s: %s", filepath.Base(imagePath), textStr)

				// Try JSON parsing first
				result, err := parseGeminiResponse(textStr)
				if err == nil && result.Category != "" {
					// Validate and return
					if isValidCategory(result.Category) {
						log.Printf("[AnalyzeImage] Success: %s -> %s (%.2f)", filepath.Base(imagePath), result.Category, result.Confidence)
						return result.Category, result.Confidence, nil
					}
				}

				// JSON parsing failed, try extracting category from raw text
				log.Printf("[AnalyzeImage] JSON parse failed, trying text extraction for %s", filepath.Base(imagePath))

				// Try multiple extraction methods
				extractedCategory := extractCategoryFromText(textStr)
				if extractedCategory != "" && extractedCategory != "Grup" {
					log.Printf("[AnalyzeImage] Text extraction success: %s -> %s", filepath.Base(imagePath), extractedCategory)
					return extractedCategory, 0.6, nil
				}

				// Last resort: check if any category name appears in the text
				for _, cat := range PredefinedCategories {
					if cat.Name == "Grup" {
						continue
					}
					// Check exact match with quotes
					if strings.Contains(textStr, "\""+cat.Name+"\"") ||
						strings.Contains(textStr, "'"+cat.Name+"'") ||
						strings.Contains(textStr, cat.Name) {
						log.Printf("[AnalyzeImage] Direct match: %s -> %s", filepath.Base(imagePath), cat.Name)
						return cat.Name, 0.5, nil
					}
				}
			}
		}
	}

	log.Printf("[AnalyzeImage] Could not parse response for %s, using Grup", imagePath)
	return "Grup", 0.0, nil
}

// GeminiResponse represents the expected JSON response from Gemini
type GeminiResponse struct {
	Category   string  `json:"category"`
	Confidence float64 `json:"confidence"`
	Reasoning  string  `json:"reasoning"`
}

// parseGeminiResponse parses the JSON response from Gemini
func parseGeminiResponse(text string) (*GeminiResponse, error) {
	// Extract JSON from response (in case there's markdown or other text)
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start == -1 || end == -1 || end <= start {
		return nil, fmt.Errorf("no JSON found in response")
	}

	jsonStr := text[start : end+1]
	var result GeminiResponse
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		return nil, err
	}

	return &result, nil
}

// extractCategoryFromText attempts to extract a category name directly from text response
func extractCategoryFromText(text string) string {
	lowerText := strings.ToLower(text)
	for _, cat := range PredefinedCategories {
		if cat.Name == "Grup" || cat.Name == "Miscellaneous" {
			continue
		}
		if strings.Contains(lowerText, strings.ToLower(cat.Name)) {
			return cat.Name
		}
		for _, keyword := range cat.Keywords {
			if strings.Contains(lowerText, strings.ToLower(keyword)) {
				return cat.Name
			}
		}
	}
	return ""
}

// isValidCategory checks if a category name is in the predefined list
func isValidCategory(name string) bool {
	for _, cat := range PredefinedCategories {
		if cat.Name == name {
			return true
		}
	}
	return false
}

// BatchAnalyzeImages analyzes multiple images in parallel using Gemini
func (a *App) BatchAnalyzeImages(imagePaths []string) map[string]CategoryResult {
	results := make(map[string]CategoryResult)
	var mu sync.Mutex
	var wg sync.WaitGroup

	// Limit concurrent requests to avoid rate limiting
	semaphore := make(chan struct{}, 5)

	for _, path := range imagePaths {
		wg.Add(1)
		go func(p string) {
			defer wg.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			category, confidence, err := a.AnalyzeImageWithGemini(p)
			mu.Lock()
			if err != nil {
				results[p] = CategoryResult{
					Path:       p,
					Category:   "Grup",
					Confidence: 0.0,
					Error:      err.Error(),
				}
			} else {
				results[p] = CategoryResult{
					Path:       p,
					Category:   category,
					Confidence: confidence,
				}
			}
			mu.Unlock()
		}(path)
	}

	wg.Wait()

	// Log analysis summary
	successCount := 0
	failCount := 0
	for _, res := range results {
		if res.Category != "Grup" && res.Error == "" {
			successCount++
		} else {
			failCount++
		}
	}
	log.Printf("[BatchAnalyzeImages] Completed. Success: %d, Failed/Fallback: %d", successCount, failCount)

	return results
}

// CategoryResult holds the classification result for an image
type CategoryResult struct {
	Path       string  `json:"path"`
	Category   string  `json:"category"`
	Confidence float64 `json:"confidence"`
	Error      string  `json:"error,omitempty"`
}

// EnhancedAIGroupFiles performs AI grouping with Gemini-powered classification
func (a *App) EnhancedAIGroupFiles(files []FileInfo, config EnhancedGroupConfig) ([]ClassifiedGroup, error) {
	if len(files) == 0 {
		return []ClassifiedGroup{}, nil
	}

	// NEW LOGIC: Classify First, Then Group
	if config.UseAIClassification && a.settings.GeminiAPIKey != "" {
		// 1. Separate images and other files
		var imagePaths []string
		var imageFiles []FileInfo
		var otherFiles []FileInfo

		for _, f := range files {
			if f.FileType == "image" {
				imagePaths = append(imagePaths, f.Path)
				imageFiles = append(imageFiles, f)
			} else {
				otherFiles = append(otherFiles, f)
			}
		}

		// 2. Batch Analyze Images
		// This uses the semaphore-limited concurrent analyzer
		analysisResults := a.BatchAnalyzeImages(imagePaths)

		// 3. Check for High Failure Rate (Automatic Fallback)
		failCount := 0
		for _, res := range analysisResults {
			// Count as failure if there's an error OR if the result is "Grup" with 0 confidence (default failure return)
			if res.Error != "" || (res.Category == "Grup" && res.Confidence == 0.0) {
				failCount++
			}
		}

		failureRate := 0.0
		if len(imagePaths) > 0 {
			failureRate = float64(failCount) / float64(len(imagePaths))
		}

		// If failure rate is high (> 50%), use Category-First Keyword Fallback
		if failureRate > 0.5 {
			log.Printf("[EnhancedAIGroupFiles] High AI failure rate (%.1f%%). Using Category-First Keyword Grouping.", failureRate*100)

			categoryGroups := make(map[string][]FileInfo)
			for _, f := range imageFiles {
				// Use keyword classification for every file
				cat := classifyByKeywords(FileGroup{Files: []FileInfo{f}})
				categoryGroups[cat] = append(categoryGroups[cat], f)
			}

			classifiedGroups := []ClassifiedGroup{}

			for cat, groupFiles := range categoryGroups {
				// If a category group is very large, split it by time (1-hour window)
				if len(groupFiles) > 50 {
					subGroups := a.GroupByTime(groupFiles, 1.0)
					for i, subG := range subGroups {
						name := generateGroupName(cat, i, countCategoryUsage(classifiedGroups, cat))
						if len(subGroups) > 1 {
							name = fmt.Sprintf("%s - Part %d", name, i+1)
						}

						first := subG.Files[0].ModifiedAt
						last := subG.Files[len(subG.Files)-1].ModifiedAt
						timeSpan := fmt.Sprintf("%s - %s", first.Format("2006-01-02"), last.Format("2006-01-02"))

						classifiedGroups = append(classifiedGroups, ClassifiedGroup{
							FileGroup: FileGroup{
								ID:         fmt.Sprintf("fallback_cat_%s_%d", cat, i),
								Name:       name,
								Files:      subG.Files,
								Similarity: 0.0,
								TimeSpan:   timeSpan,
								GroupType:  "keyword_category",
								Suggested:  true,
							},
							Category:    cat,
							Confidence:  0.4,
							Description: getCategoryDescription(cat),
						})
					}
				} else {
					// Add as a single category group
					sort.Slice(groupFiles, func(i, j int) bool {
						return groupFiles[i].ModifiedAt.Before(groupFiles[j].ModifiedAt)
					})
					first := groupFiles[0].ModifiedAt
					last := groupFiles[len(groupFiles)-1].ModifiedAt
					timeSpan := fmt.Sprintf("%s - %s", first.Format("2006-01-02"), last.Format("2006-01-02"))

					classifiedGroups = append(classifiedGroups, ClassifiedGroup{
						FileGroup: FileGroup{
							ID:         fmt.Sprintf("fallback_cat_%s", cat),
							Name:       generateGroupName(cat, 0, countCategoryUsage(classifiedGroups, cat)),
							Files:      groupFiles,
							Similarity: 0.0,
							TimeSpan:   timeSpan,
							GroupType:  "keyword_category",
							Suggested:  true,
						},
						Category:    cat,
						Confidence:  0.4,
						Description: getCategoryDescription(cat),
					})
				}
			}

			// Add non-image files if any
			if len(otherFiles) > 0 {
				sort.Slice(otherFiles, func(i, j int) bool {
					return otherFiles[i].ModifiedAt.Before(otherFiles[j].ModifiedAt)
				})
				classifiedGroups = append(classifiedGroups, ClassifiedGroup{
					FileGroup: FileGroup{
						ID:        "other_files",
						Name:      "Other Files",
						Files:     otherFiles,
						GroupType: "other",
						Suggested: true,
					},
					Category: "Grup",
				})
			}

			sort.Slice(classifiedGroups, func(i, j int) bool {
				return classifiedGroups[i].Name < classifiedGroups[j].Name
			})

			return classifiedGroups, nil
		} else {
			// ALL AI SUCCESS PATH
			categoryGroups := make(map[string][]FileInfo)

			for _, f := range imageFiles {
				res, ok := analysisResults[f.Path]
				category := "Grup" // Default
				if ok && res.Category != "" {
					category = res.Category
				} else {
					category = classifyByKeywords(FileGroup{Files: []FileInfo{f}})
				}
				categoryGroups[category] = append(categoryGroups[category], f)
			}

			classifiedGroups := []ClassifiedGroup{}

			addGroup := func(cat string, groupFiles []FileInfo) {
				if len(groupFiles) == 0 {
					return
				}
				sort.Slice(groupFiles, func(i, j int) bool {
					return groupFiles[i].ModifiedAt.Before(groupFiles[j].ModifiedAt)
				})

				first := groupFiles[0].ModifiedAt
				last := groupFiles[len(groupFiles)-1].ModifiedAt
				timeSpan := fmt.Sprintf("%s - %s", first.Format("2006-01-02"), last.Format("2006-01-02"))

				avgConfidence := 0.0
				count := 0
				for _, f := range groupFiles {
					if res, ok := analysisResults[f.Path]; ok && res.Confidence > 0 {
						avgConfidence += res.Confidence
						count++
					}
				}
				if count > 0 {
					avgConfidence /= float64(count)
				} else {
					avgConfidence = 0.5
				}

				classifiedGroups = append(classifiedGroups, ClassifiedGroup{
					FileGroup: FileGroup{
						ID:         fmt.Sprintf("ai_cat_%s", cat),
						Name:       generateGroupName(cat, 0, countCategoryUsage(classifiedGroups, cat)),
						Files:      groupFiles,
						Similarity: 0.0,
						TimeSpan:   timeSpan,
						GroupType:  "ai_category",
						Suggested:  true,
					},
					Category:    cat,
					Confidence:  avgConfidence,
					Description: getCategoryDescription(cat),
				})
			}

			for cat, groupFiles := range categoryGroups {
				addGroup(cat, groupFiles)
			}

			if len(otherFiles) > 0 {
				found := false
				for i, g := range classifiedGroups {
					if g.Name == "Grup" {
						classifiedGroups[i].Files = append(classifiedGroups[i].Files, otherFiles...)
						sort.Slice(classifiedGroups[i].Files, func(x, y int) bool {
							return classifiedGroups[i].Files[x].ModifiedAt.Before(classifiedGroups[i].Files[y].ModifiedAt)
						})
						found = true
						break
					}
				}
				if !found {
					addGroup("Grup", otherFiles)
				}
			}

			sort.Slice(classifiedGroups, func(i, j int) bool {
				return classifiedGroups[i].Name < classifiedGroups[j].Name
			})

			return classifiedGroups, nil
		}
	}

	// FALLBACK (If AI Classification is Disabled entirely)
	rawGroups, err := a.performInitialGrouping(files, config)
	if err != nil {
		return nil, err
	}

	if len(rawGroups) == 0 {
		return []ClassifiedGroup{}, nil
	}

	// Step 2: Classify each group using AI (Representative image only)
	classifiedGroups := make([]ClassifiedGroup, 0, len(rawGroups))

	for i, group := range rawGroups {
		var category string
		var confidence float64

		// Note: We already checked UseAIClassification above, but this path is for when ONLY UseAIClassification is false
		// (which means this block shouldn't really be reached if we want AI?
		// Actually, config.UseAIClassification IS checked above. So this fallback is exclusively for OFF.
		// BUT wait, if key is missing, we fall here too.

		// So if Key is missing, we do Keyword classification on the GROUP.
		category = classifyByKeywords(group)
		confidence = 0.5

		// Generate proper name
		name := generateGroupName(category, i, countCategoryUsage(classifiedGroups, category))

		classifiedGroups = append(classifiedGroups, ClassifiedGroup{
			FileGroup: FileGroup{
				ID:         fmt.Sprintf("ai_group_%d", i+1),
				Name:       name,
				Files:      group.Files,
				Similarity: group.Similarity,
				TimeSpan:   group.TimeSpan,
				GroupType:  group.GroupType,
				Suggested:  true,
			},
			Category:    category,
			Confidence:  confidence,
			Description: getCategoryDescription(category),
		})
	}

	return classifiedGroups, nil
}

// performInitialGrouping groups files by visual similarity and temporal proximity
func (a *App) performInitialGrouping(files []FileInfo, config EnhancedGroupConfig) ([]FileGroup, error) {
	// Use existing grouping logic
	groupConfig := GroupConfig{
		SimilarityThreshold: config.SimilarityThreshold,
		TimeWindowHours:     config.TimeWindowHours,
		MinGroupSize:        config.MinGroupSize,
	}

	return a.AIGroupFiles(files, groupConfig)
}

// findRepresentativeImage finds the best representative image from a group
func findRepresentativeImage(files []FileInfo) *FileInfo {
	for _, f := range files {
		if f.FileType == "image" {
			return &f
		}
	}
	return nil
}

// classifyByKeywords performs basic keyword-based classification as fallback
func classifyByKeywords(group FileGroup) string {
	if len(group.Files) == 0 {
		return "Grup" // Changed from Miscellaneous
	}

	keywordCount := make(map[string]int)
	totalScore := make(map[string]float64)

	for _, file := range group.Files {
		nameLower := strings.ToLower(file.Name)
		ext := strings.ToLower(file.Extension)

		for _, cat := range PredefinedCategories {
			catScore := 0.0
			for _, keyword := range cat.Keywords {
				if strings.Contains(nameLower, strings.ToLower(keyword)) {
					keywordCount[cat.Name]++
					catScore += 1.0
				}
			}
			totalScore[cat.Name] += catScore
		}

		switch file.FileType {
		case "image":
			totalScore["Anime/Manga"] += 0.1
			totalScore["Cartoon/Illustration"] += 0.1
			totalScore["Animal/Pet"] += 0.1
			totalScore["Scenery/Landscape"] += 0.1
			totalScore["Architecture/City"] += 0.1
			totalScore["People/Portrait"] += 0.1
			totalScore["Food/Cuisine"] += 0.1
			totalScore["Nature/Macro"] += 0.1
		case "video":
			totalScore["Game Screenshot"] += 0.2
			totalScore["UI Screenshot"] += 0.2
			totalScore["Movie/Cinematic"] += 0.2
		case "document":
			totalScore["Document/Scan"] += 0.5
			totalScore["Book/Magazine"] += 0.3
		}

		if ext == ".pdf" {
			totalScore["Document/Scan"] += 0.3
		} else if ext == ".psd" || ext == ".ai" || ext == ".eps" {
			totalScore["Drawing/Sketch"] += 0.3
			totalScore["Painting/Fine Art"] += 0.3
		}
	}

	maxScore := 0.0
	bestCategory := "Grup" // Changed from Miscellaneous

	for cat, score := range totalScore {
		if score > maxScore {
			maxScore = score
			bestCategory = cat
		}
	}

	if bestCategory == "Grup" && maxScore > 0 {
		secondBestCategory := "Grup"
		secondBestScore := 0.0
		for cat, score := range totalScore {
			if cat != "Grup" && cat != "Miscellaneous" && score > secondBestScore {
				secondBestScore = score
				secondBestCategory = cat
			}
		}
		if secondBestScore > 0 {
			bestCategory = secondBestCategory
		}
	}

	return bestCategory
}

// countCategoryUsage counts how many times a category has been used
func countCategoryUsage(groups []ClassifiedGroup, category string) int {
	count := 0
	for _, g := range groups {
		if g.Category == category {
			count++
		}
	}
	return count
}

// generateGroupName generates a unique name for a group with consistent (X) indexing
func generateGroupName(category string, index int, existingCount int) string {
	return fmt.Sprintf("%s (%d)", category, existingCount+1)
}

// getCategoryDescription returns the description for a category
func getCategoryDescription(category string) string {
	for _, cat := range PredefinedCategories {
		if cat.Name == category {
			return cat.Description
		}
	}
	return ""
}

// ImageAnalysisResult is exported for Wails binding
type ImageAnalysisResult struct {
	Category   string  `json:"category"`
	Confidence float64 `json:"confidence"`
	Success    bool    `json:"success"`
	Error      string  `json:"error,omitempty"`
}

// AnalyzeSingleImage is an exported method for Wails binding
func (a *App) AnalyzeSingleImage(imagePath string) ImageAnalysisResult {
	category, confidence, err := a.AnalyzeImageWithGemini(imagePath)
	if err != nil {
		return ImageAnalysisResult{
			Category:   "Grup",
			Confidence: 0.0,
			Success:    false,
			Error:      err.Error(),
		}
	}

	return ImageAnalysisResult{
		Category:   category,
		Confidence: confidence,
		Success:    true,
	}
}

// GetPredefinedCategories returns all 50 predefined categories (exported for Wails)
func (a *App) GetPredefinedCategories() []PredefinedCategory {
	return PredefinedCategories
}

// AIAutoSortToFolders physically sorts files in the given folder into subfolders based on AI classification.
func (a *App) AIAutoSortToFolders(folderPath string) error {
	log.Printf("[AIAutoSort] Starting deep sort for: %s", folderPath)

	// 1. Get all files in the folder (no recursive scan for now to avoid complexity)
	content, err := a.ScanFolder(folderPath)
	if err != nil {
		return fmt.Errorf("failed to scan folder: %w", err)
	}

	if len(content.Files) == 0 {
		return fmt.Errorf("no files found in folder")
	}

	// 2. Identify images and non-images
	var imagePaths []string
	var imageFiles []FileInfo
	var otherFiles []FileInfo

	for _, f := range content.Files {
		if f.FileType == "image" {
			imagePaths = append(imagePaths, f.Path)
			imageFiles = append(imageFiles, f)
		} else {
			otherFiles = append(otherFiles, f)
		}
	}

	// 3. Analyze images using Gemini (with parallel processing)
	var analysisResults map[string]CategoryResult
	if a.settings.GeminiAPIKey != "" {
		analysisResults = a.BatchAnalyzeImages(imagePaths)
	} else {
		analysisResults = make(map[string]CategoryResult)
	}

	// 4. Map files to categories
	categoryToFiles := make(map[string][]string)
	for _, f := range imageFiles {
		res, ok := analysisResults[f.Path]
		category := "Grup" // Default fallback
		if ok && res.Category != "" && res.Category != "Grup" {
			category = res.Category
		} else {
			// Local keyword classification as fallback
			category = classifyByKeywords(FileGroup{Files: []FileInfo{f}})
		}
		categoryToFiles[category] = append(categoryToFiles[category], f.Path)
	}

	// 5. Create folders and move files
	groupCounter := 1

	// Get non-Grup categories and sort them for consistent folder naming
	categories := []string{}
	for cat := range categoryToFiles {
		if cat != "Grup" {
			categories = append(categories, cat)
		}
	}
	sort.Strings(categories)

	for _, cat := range categories {
		filesToMove := categoryToFiles[cat]
		if len(filesToMove) == 0 {
			continue
		}

		// Requirement: categorize into separate folders (Group 1, 2, 3, etc.)
		folderName := fmt.Sprintf("Group %d", groupCounter)

		destFolder := filepath.Join(folderPath, folderName)
		err := os.MkdirAll(destFolder, 0755)
		if err != nil {
			log.Printf("[AIAutoSort] Failed to create folder %s: %v", destFolder, err)
			continue
		}

		// Physically move files
		err = a.MoveFiles(filesToMove, destFolder)
		if err != nil {
			log.Printf("[AIAutoSort] Failed to move files to %s: %v", destFolder, err)
		} else {
			log.Printf("[AIAutoSort] Moved %d files to %s (AI Category: %s)", len(filesToMove), folderName, cat)
			groupCounter++
		}
	}

	// 6. Handle "Other" files (non-images + files that fell into default "Grup")
	otherFilesPaths := []string{}
	for _, f := range otherFiles {
		otherFilesPaths = append(otherFilesPaths, f.Path)
	}
	if failedImages, ok := categoryToFiles["Grup"]; ok {
		otherFilesPaths = append(otherFilesPaths, failedImages...)
	}

	if len(otherFilesPaths) > 0 {
		destFolder := filepath.Join(folderPath, "Other")
		os.MkdirAll(destFolder, 0755)
		err = a.MoveFiles(otherFilesPaths, destFolder)
		if err != nil {
			log.Printf("[AIAutoSort] Failed to move files to Other folder: %v", err)
		} else {
			log.Printf("[AIAutoSort] Moved %d files to Other folder", len(otherFilesPaths))
		}
	}

	return nil
}
