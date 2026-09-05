package main

import (
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"sort"

	"github.com/corona10/goimagehash"
)

// GroupConfig holds AI grouping configuration
type GroupConfig struct {
	SimilarityThreshold int     // 0-100, higher = more similar required
	TimeWindowHours     float64 // Hours within which files are considered temporal group
	MinGroupSize        int     // Minimum files to form a group
}

// FileGroup represents a group of similar files
type FileGroup struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Files      []FileInfo `json:"files"`
	Similarity float64    `json:"similarity"`
	TimeSpan   string     `json:"timeSpan"`
	GroupType  string     `json:"groupType"` // "visual", "temporal", "hybrid"
	Suggested  bool       `json:"suggested"`
}

// ComputeImageHash computes perceptual hash for an image
func ComputeImageHash(imagePath string) (*goimagehash.ImageHash, error) {
	file, err := os.Open(imagePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	img, _, err := image.Decode(file)
	if err != nil {
		return nil, err
	}

	hash, err := goimagehash.PerceptionHash(img)
	if err != nil {
		return nil, err
	}

	return hash, nil
}

// GroupByVisualSimilarity groups images by visual similarity using perceptual hashing
func (a *App) GroupByVisualSimilarity(files []FileInfo, threshold int) ([]FileGroup, error) {
	// Filter only images
	imageFiles := []FileInfo{}
	for _, f := range files {
		if f.FileType == "image" {
			imageFiles = append(imageFiles, f)
		}
	}

	if len(imageFiles) == 0 {
		return []FileGroup{}, nil
	}

	// Compute hashes for all images
	type ImageWithHash struct {
		File FileInfo
		Hash *goimagehash.ImageHash
	}

	imagesWithHashes := []ImageWithHash{}
	for _, file := range imageFiles {
		hash, err := ComputeImageHash(file.Path)
		if err != nil {
			// Skip files that can't be hashed
			continue
		}
		imagesWithHashes = append(imagesWithHashes, ImageWithHash{
			File: file,
			Hash: hash,
		})
	}

	// Group similar images
	groups := []FileGroup{}
	used := make(map[string]bool)

	for i, img1 := range imagesWithHashes {
		if used[img1.File.ID] {
			continue
		}

		group := FileGroup{
			ID:        fmt.Sprintf("visual_group_%d", len(groups)+1),
			Name:      fmt.Sprintf("Grup %d", len(groups)+1),
			Files:     []FileInfo{img1.File},
			GroupType: "visual",
			Suggested: true,
		}
		used[img1.File.ID] = true

		// Find similar images
		totalDistance := 0
		comparisons := 0

		for j := i + 1; j < len(imagesWithHashes); j++ {
			img2 := imagesWithHashes[j]
			if used[img2.File.ID] {
				continue
			}

			distance, err := img1.Hash.Distance(img2.Hash)
			if err != nil {
				continue
			}

			// Lower distance = more similar
			// Convert to similarity percentage (0-100)
			similarity := 100 - (distance * 100 / 64) // 64 is max hamming distance for perception hash

			if similarity >= threshold {
				group.Files = append(group.Files, img2.File)
				used[img2.File.ID] = true
				totalDistance += distance
				comparisons++
			}
		}

		// Only create group if it has more than 1 file
		if len(group.Files) > 1 {
			if comparisons > 0 {
				avgSimilarity := 100 - (float64(totalDistance)/float64(comparisons))*100/64
				group.Similarity = avgSimilarity
			}
			groups = append(groups, group)
		}
	}

	return groups, nil
}

// GroupByTime groups files by temporal proximity
func (a *App) GroupByTime(files []FileInfo, timeWindowHours float64) []FileGroup {
	if len(files) == 0 {
		return []FileGroup{}
	}

	// Sort files by modification time
	sortedFiles := make([]FileInfo, len(files))
	copy(sortedFiles, files)
	sort.Slice(sortedFiles, func(i, j int) bool {
		return sortedFiles[i].DateTaken.Before(sortedFiles[j].DateTaken)
	})

	groups := []FileGroup{}
	currentGroup := FileGroup{
		ID:        "temporal_group_1",
		Name:      "Grup (1)",
		Files:     []FileInfo{sortedFiles[0]},
		GroupType: "temporal",
		Suggested: true,
	}

	for i := 1; i < len(sortedFiles); i++ {
		prevTime := sortedFiles[i-1].DateTaken
		currTime := sortedFiles[i].DateTaken

		timeDiff := currTime.Sub(prevTime).Hours()

		if timeDiff <= timeWindowHours {
			// Add to current group
			currentGroup.Files = append(currentGroup.Files, sortedFiles[i])
		} else {
			// Save current group if it has more than 1 file
			if len(currentGroup.Files) > 1 {
				// Calculate time span
				firstTime := currentGroup.Files[0].DateTaken
				lastTime := currentGroup.Files[len(currentGroup.Files)-1].DateTaken
				currentGroup.TimeSpan = fmt.Sprintf("%s - %s",
					firstTime.Format("2006-01-02 15:04"),
					lastTime.Format("2006-01-02 15:04"))
				groups = append(groups, currentGroup)
			}

			// Start new group
			currentGroup = FileGroup{
				ID:        fmt.Sprintf("temporal_group_%d", len(groups)+1),
				Name:      fmt.Sprintf("Grup (%d)", len(groups)+1),
				Files:     []FileInfo{sortedFiles[i]},
				GroupType: "temporal",
				Suggested: true,
			}
		}
	}

	// Add last group
	if len(currentGroup.Files) > 1 {
		firstTime := currentGroup.Files[0].DateTaken
		lastTime := currentGroup.Files[len(currentGroup.Files)-1].DateTaken
		currentGroup.TimeSpan = fmt.Sprintf("%s - %s",
			firstTime.Format("2006-01-02 15:04"),
			lastTime.Format("2006-01-02 15:04"))
		groups = append(groups, currentGroup)
	}

	return groups
}

// AIGroupFiles performs hierarchical AI-based grouping (Temporal -> Visual)
func (a *App) AIGroupFiles(files []FileInfo, config GroupConfig) ([]FileGroup, error) {
	if len(files) == 0 {
		return []FileGroup{}, nil
	}

	// 1. Tier 1: Temporal Grouping (Identify Sessions)
	// If the user's window is too huge (e.g. 24h), we cap it internally for "Smart Grouping"
	// to avoid the "single blob" issue the user is seeing.
	effectiveTimeWindow := config.TimeWindowHours
	if effectiveTimeWindow > 2.0 {
		effectiveTimeWindow = 2.0 // Cap at 2 hours for session detection
	}
	if effectiveTimeWindow <= 0 {
		effectiveTimeWindow = 1.0
	}

	temporalGroups := a.GroupByTime(files, effectiveTimeWindow)

	// 2. Prepare for Visual Comparison
	type ImageWithHash struct {
		File FileInfo
		Hash *goimagehash.ImageHash
	}

	// Internal helper to get hashes for a group of files
	getHashes := func(files []FileInfo) []ImageWithHash {
		hashes := []ImageWithHash{}
		for _, f := range files {
			if f.FileType != "image" {
				continue
			}
			hash, err := ComputeImageHash(f.Path)
			if err == nil {
				hashes = append(hashes, ImageWithHash{File: f, Hash: hash})
			}
		}
		return hashes
	}

	// 3. Tier 2: Visual Comparison between Sessions
	// We want to merge sessions that are visually similar.
	finalGroups := []FileGroup{}
	usedTemporal := make(map[int]bool)

	for i, groupA := range temporalGroups {
		if usedTemporal[i] {
			continue
		}

		mergedGroup := groupA
		usedTemporal[i] = true
		groupAHashes := getHashes(groupA.Files)

		for j := i + 1; j < len(temporalGroups); j++ {
			if usedTemporal[j] {
				continue
			}

			groupB := temporalGroups[j]
			groupBHashes := getHashes(groupB.Files)

			// Compare Group A and Group B
			// If we find enough similar pairs, we merge them.
			similarPairs := 0
			totalSimilarity := 0.0
			comparisons := 0

			for _, hA := range groupAHashes {
				for _, hB := range groupBHashes {
					distance, err := hA.Hash.Distance(hB.Hash)
					if err != nil {
						continue
					}
					similarity := 100 - (float64(distance) * 100 / 64)
					if similarity >= float64(config.SimilarityThreshold) {
						similarPairs++
					}
					totalSimilarity += similarity
					comparisons++
				}
			}

			// Merging criteria: at least 1 very similar pair or high average similarity
			shouldMerge := false
			if similarPairs >= 1 {
				shouldMerge = true
			}

			if shouldMerge {
				mergedGroup.Files = append(mergedGroup.Files, groupB.Files...)
				mergedGroup.GroupType = "hybrid"
				if comparisons > 0 {
					mergedGroup.Similarity = (mergedGroup.Similarity + (totalSimilarity / float64(comparisons))) / 2
				}
				usedTemporal[j] = true
			}
		}

		// Calculate final metadata for the merged group
		if len(mergedGroup.Files) >= config.MinGroupSize {
			sort.Slice(mergedGroup.Files, func(i, j int) bool {
				return mergedGroup.Files[i].ModifiedAt.Before(mergedGroup.Files[j].ModifiedAt)
			})
			first := mergedGroup.Files[0].ModifiedAt
			last := mergedGroup.Files[len(mergedGroup.Files)-1].ModifiedAt
			mergedGroup.TimeSpan = fmt.Sprintf("%s - %s", first.Format("2006-01-02"), last.Format("2006-01-02"))
			mergedGroup.ID = fmt.Sprintf("group_%d", len(finalGroups)+1)
			mergedGroup.Name = fmt.Sprintf("Grup (%d)", len(finalGroups)+1)

			finalGroups = append(finalGroups, mergedGroup)
		}
	}

	// Fallback/Force Split: If no hybrid groups found, or only one massive group was found
	// despite having many files, perform visual only grouping to try and get more useful splits.
	if len(finalGroups) == 0 || (len(finalGroups) == 1 && len(files) > config.MinGroupSize*3) {
		visualGroups, err := a.GroupByVisualSimilarity(files, config.SimilarityThreshold)
		if err == nil && len(visualGroups) > len(finalGroups) {
			return visualGroups, nil
		}
	}

	return finalGroups, nil
}
