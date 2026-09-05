import { pipeline, env } from '@xenova/transformers';

// Configure environment for Wails/WebView2
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = false;
// Explicitly set the remote host and template to avoid internal "Unauthorized" path fallbacks
env.remoteHost = 'https://huggingface.co';
env.remotePathTemplate = '{model}/resolve/{revision}/';

let classifier: any = null;

export const CATEGORIES = [
    'Anime/Manga', 'Cartoon/Illustration', 'Animal/Pet', 'Scenery/Landscape', 'Architecture/City',
    'People/Portrait', 'Group/Crowd', 'Coding/Programming', 'Web/App Design', 'UI Screenshot',
    'Game Screenshot', '3D/CGI Render', 'Food/Cuisine', 'Drink/Beverage', 'Vehicle/Car',
    'Space/Astronomy', 'Nature/Macro', 'Beach/Underwater', 'Forest/Mountain', 'Sky/Clouds',
    'Night/Dark', 'Technology/Gadget', 'Interior/Room', 'Fashion/Style', 'Sport/Active',
    'Music/Recording', 'Movie/Cinematic', 'Document/Scan', 'Drawing/Sketch', 'Painting/Fine Art',
    'Sculpture/Craft', 'Map/Data Viz', 'Logo/Iconography', 'Abstract/Texture', 'Black & White',
    'Vintage/Retro', 'Wedding/Ceremony', 'Party/Celebration', 'Stage/Concert', 'Medical/Lab',
    'Industrial/Work', 'Tool/Equipment', 'Furniture/Object', 'Toy/Collectible', 'Book/Magazine',
    'Social Media/Meme', 'Workout/Gym', 'Travel/Adventure', 'Shopping/Product', 'Grup'
];

// Comprehensive mapping from ImageNet/MobileNet labels to 50 PhotoSort libraries
const MAPPING_DICTIONARY: Record<string, string[]> = {
    'Anime/Manga': ['anime', 'manga', 'japanese animation', 'japanese cartoon', 'anime screenshot', 'manga panel', 'anime character', 'manga character', ' protagonist', 'hero', 'heroine', 'villain', 'antagonist', 'shonen', 'shoujo', 'seinen', 'josei', 'mecha', 'isekai', 'slice of life', 'romance anime', 'action anime', 'adventure anime', 'fantasy anime', 'sci-fi anime', 'horror anime', 'comedy anime', 'drama anime', 'sports anime', 'music anime', 'school anime', 'ninja', 'samurai', 'dragon ball', 'naruto', 'one piece', 'attack on titan', 'demon slayer', 'jujutsu kaisen', 'my hero academia', 'death note', 'fullmetal alchemist', 'cowboy bebop', 'evangelion', 'sailor moon', 'pokemon', 'digimon', 'yugioh', 'bleach', 'hunter x hunter', 'one punch man', 'tokyo ghoul', 'sword art online', 'attack on titan', 'kimetsu no yaiba', 'boku no hero academia', 'shingeki no kyojin', 'comic', 'cartoon', 'illustration', 'sketch', 'pencil box', 'pencil sharpener', 'book jacket', 'ashcan'],
    'Cartoon/Illustration': ['hand-colored', 'crayon', 'watercolor', 'drawing', 'art', 'graphic', 'poster', 'oil painting', 'acrylic'],
    'Animal/Pet': ['dog', 'cat', 'bird', 'horse', 'fish', 'animal', 'pet', 'mammal', 'tabby', 'golden retriever', 'poodle', 'hamster', 'rabbit', 'dalmatian', 'beagle', 'terrier'],
    'Scenery/Landscape': ['landscape', 'scenery', 'valley', 'field', 'meadow', 'nature', 'outdoors', 'geological formation', 'cliff', 'promontory'],
    'Architecture/City': ['building', 'house', 'city', 'street', 'architecture', 'tower', 'bridge', 'skyline', 'palace', 'castle', 'monument', 'triumphal arch'],
    'People/Portrait': ['portrait', 'person', 'face', 'human', 'man', 'woman', 'child', 'face mask', 'individual', 'crowd'],
    'Group/Crowd': ['crowd', 'group', 'people', 'audience', 'class', 'team', 'parade'],
    'Coding/Programming': ['code', 'coding', 'programming', 'developer', 'development', 'software development', 'web development', 'app development', 'programming language', 'source code', 'script', 'function', 'variable', 'class', 'object', 'method', 'api', 'database', 'server', 'client', 'frontend', 'backend', 'fullstack', 'html', 'css', 'javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'php', 'ruby', 'go', 'rust', 'swift', 'kotlin', 'sql', 'json', 'xml', 'yaml', 'markdown', 'git', 'github', 'gitlab', 'bitbucket', 'vscode', 'visual studio code', 'sublime text', 'atom', 'intellij', 'eclipse', 'netbeans', 'xcode', 'android studio', 'unity', 'unreal engine', 'terminal', 'command line', 'cmd', 'powershell', 'shell', 'bash', 'zsh', 'console', 'log', 'debug', 'error', 'warning', 'compile', 'build', 'deploy', 'commit', 'push', 'pull', 'merge', 'branch', 'repository', 'repo', 'ide', 'editor', 'monitor', 'screen', 'keyboard', 'laptop', 'desktop computer', 'oscilloscope', 'hard disc', 'scoreboard'],
    'Web/App Design': ['web site', 'menu', 'browser', 'sidebar', 'layout', 'home page', 'world wide web'],
    'UI Screenshot': ['screenshot', 'screen shot', 'desktop', 'window', 'interface', 'menu bar', 'taskbar', 'icon', 'folder', 'file explorer', 'app', 'application', 'software', 'program', 'browser', 'chrome', 'firefox', 'edge', 'safari', 'toolbar', 'navigation bar', 'status bar', 'dialog box', 'modal', 'button', 'input field', 'text field', 'dropdown', 'checkbox', 'radio button', 'scroll bar', 'cursor', 'pointer', 'mouse', 'click', 'hover', 'select', 'mobile phone', 'cellular telephone', 'digital clock', 'tablet', 'ipod'],
    'Game Screenshot': ['joystick', 'controller', 'video game', 'arcade', 'slot machine', 'console', 'pinball', 'gaming', 'gameplay', 'player', 'character', 'level', 'map', 'inventory', 'health bar', 'mana bar', 'experience bar', 'minimap', 'quest', 'mission', 'achievement', 'trophy', 'score', 'leaderboard', 'multiplayer', 'online', 'fps', 'rpg', 'mmo', 'battle royale', 'minecraft', 'fortnite', 'pubg', 'league of legends', 'dota', 'overwatch', 'valorant', 'call of duty', 'counter strike', 'gta', 'grand theft auto', 'zelda', 'mario', 'pokemon', 'genshin impact', 'mobile legends', 'free fire', 'among us', 'roblox', 'steam', 'epic games', 'origin', 'battle.net', 'xbox', 'playstation', 'ps4', 'ps5', 'nintendo', 'switch'],
    '3D/CGI Render': ['render', '3d', 'unreal engine', 'unity', 'octane', 'blender', 'digital art', 'geometric'],
    'Food/Cuisine': ['food', 'cuisine', 'dish', 'meal', 'pasta', 'pizza', 'sandwich', 'hamburger', 'steak', 'salad', 'baked goods', 'plate', 'guacamole', 'consomme'],
    'Drink/Beverage': ['drink', 'beverage', 'juice', 'coffee', 'tea', 'wine', 'beer', 'cocktail', 'bottle', 'cup', 'mug', 'goblet', 'water jug'],
    'Vehicle/Car': ['car', 'vehicle', 'truck', 'bus', 'train', 'airplane', 'bicycle', 'motorcycle', 'boat', 'ship', 'convertible', 'sports car', 'limousine'],
    'Space/Astronomy': ['space', 'galaxy', 'planet', 'star', 'astronomy', 'telescope', 'moon', 'sun', 'nebula', 'planetarium'],
    'Nature/Macro': ['flower', 'insect', 'macro', 'butterfly', 'bee', 'petals', 'leaf', 'plant', 'fungus', 'mushroom', 'ladybug'],
    'Beach/Underwater': ['beach', 'ocean', 'sea', 'underwater', 'coral', 'fish', 'sand', 'shell', 'shore', 'seashore', 'breakwater'],
    'Forest/Mountain': ['forest', 'mountain', 'woods', 'trees', 'jungle', 'peak', 'glacier', 'hills', 'coniferous', 'alp'],
    'Sky/Clouds': ['sky', 'clouds', 'sunlight', 'sunrise', 'sunset', 'atmosphere', 'rainbow'],
    'Night/Dark': ['night', 'dark', 'midnight', 'moonlight', 'street light', 'city lights', 'lantern'],
    'Technology/Gadget': ['technology', 'gadget', 'hardware', 'device', 'electronic', 'microchip', 'circuitry', 'robot', 'power saw', 'phone'],
    'Interior/Room': ['room', 'interior', 'living room', 'bedroom', 'kitchen', 'bathroom', 'cluttered room', 'dining table', 'coffee table', 'entertainment center'],
    'Fashion/Style': ['fashion', 'style', 'clothing', 'dress', 'shirt', 'pants', 'shoes', 'model', 'wardrobe', 'suit', 'tuxedo', 'gown', 'tie', 'cardigan', 'uniform'],
    'Sport/Active': ['sport', 'active', 'ball', 'athletics', 'stadium', 'playground', 'exercise', 'gymnastics', 'scoreboard'],
    'Music/Recording': ['music', 'recording', 'instrument', 'guitar', 'piano', 'drums', 'violin', 'microphone', 'headphones', 'loudspeaker', 'harmonica'],
    'Movie/Cinematic': ['movie', 'cinema', 'theater', 'film', 'movie scene', 'film scene', 'cinema scene', 'movie screenshot', 'film screenshot', 'actor', 'actress', 'character', 'protagonist', 'antagonist', 'hero', 'villain', 'director', 'producer', 'hollywood', 'bollywood', 'netflix', 'hulu', 'disney', 'pixar', 'marvel', 'dc', 'warner bros', 'paramount', 'universal', 'sony pictures', 'cinematic', 'cinematography', 'film grain', 'color grading', 'widescreen', 'letterbox', 'subtitle', 'caption', 'opening credits', 'end credits', 'trailer', 'teaser', 'poster', 'dvd', 'bluray', 'streaming', 'series', 'episode', 'season', 'scene', 'shot', 'frame', 'close-up', 'wide shot', 'panorama', 'action scene', 'dialogue scene', 'romance scene', 'horror scene', 'comedy scene', 'drama', 'thriller', 'horror', 'comedy', 'romance', 'action', 'adventure', 'sci-fi', 'fantasy', 'documentary', 'animation', 'anime', 'cartoon', 'live action', 'black and white film', 'silent film', 'classic film', 'modern film', 'blockbuster', 'indie film', 'award winning', 'oscar', 'emmy', 'golden globe'],
    'Document/Scan': ['document', 'scan', 'paper', 'text', 'book', 'magazine', 'ledger', 'newspaper', 'page', 'enunciator'],
    'Drawing/Sketch': ['drawing', 'sketch', 'pencil', 'charcoal', 'canvas', 'easel', 'wallaby'],
    'Painting/Fine Art': ['painting', 'fine art', 'museum', 'gallery', 'oil painting', 'acrylic', 'fresco'],
    'Sculpture/Craft': ['sculpture', 'craft', 'statue', 'clay', 'pottery', 'woodwork', 'jewelry', 'mask'],
    'Map/Data Viz': ['map', 'data', 'chart', 'graph', 'infographic', 'diagram', 'atlas', 'globe'],
    'Logo/Iconography': ['logo', 'icon', 'symbol', 'brand', 'emblem', 'badge', 'emoticon'],
    'Abstract/Texture': ['abstract', 'texture', 'pattern', 'gradient', 'shapes', 'noise', 'blur'],
    'Black & White': ['black and white', 'monochrome', 'grayscale', 'noir'],
    'Vintage/Retro': ['vintage', 'retro', 'old', 'antique', 'sepia', 'cassette', 'vinyl', 'typewriter'],
    'Wedding/Ceremony': ['wedding', 'ceremony', 'bride', 'groom', 'altar', 'celebration', 'gown', 'veil', 'groom'],
    'Party/Celebration': ['party', 'celebration', 'balloons', 'confetti', 'cake', 'candles', 'toast', 'event'],
    'Stage/Concert': ['stage', 'concert', 'performance', 'crowd', 'band', 'soloist', 'spotlight'],
    'Medical/Lab': ['medical', 'lab', 'doctor', 'nurse', 'hospital', 'microscope', 'test tube', 'syringe', 'stethoscope'],
    'Industrial/Work': ['industrial', 'work', 'factory', 'construction', 'worker', 'tools', 'machine', 'drilling platform'],
    'Tool/Equipment': ['tool', 'equipment', 'wrench', 'hammer', 'screwdriver', 'drill', 'pliers', 'measuring cup'],
    'Furniture/Object': ['furniture', 'object', 'chair', 'table', 'desk', 'sofa', 'shelf', 'wardrobe', 'studio couch'],
    'Toy/Collectible': ['toy', 'collectible', 'action figure', 'doll', 'game piece', 'teddy bear', 'puzzle', 'marionette'],
    'Book/Magazine': ['book', 'magazine', 'novel', 'comic book', 'paperback', 'hardcover'],
    'Social Media/Meme': ['social media', 'meme', 'internet', 'viral', 'comment', 'post', 'reaction'],
    'Workout/Gym': ['workout', 'gym', 'exercise', 'dumbbells', 'weights', 'treadmill', 'fitness', 'horizontal bar'],
    'Travel/Adventure': ['travel', 'adventure', 'luggage', 'passport', 'map', 'backpacker', 'tourist'],
    'Shopping/Product': ['shopping', 'product', 'store', 'cart', 'box', 'package', 'barcode'],
    'Grup': ['general', 'mixed', 'various', 'unknown', 'uncategorized', 'other', 'stuff']
};

/**
 * Initialize the classification pipeline
 */
export async function initAI() {
    if (!classifier) {
        // using a lightweight image classification model (MobileNetV2)
        classifier = await pipeline('image-classification', 'Xenova/mobilenet_v2_1.0_224');
    }
    return classifier;
}

/**
 * Classify an image and return a category guess based on the 50-library taxonomy
 */
export async function classifyImage(imageUrl: string): Promise<{ category: string, label: string }> {
    try {
        const pipe = await initAI();
        const results = await pipe(imageUrl);

        // results is an array of { label: string, score: number }
        const topResult = results[0];
        const originalLabel = topResult.label;
        const label = originalLabel.toLowerCase();
        const score = topResult.score;

        console.log(`[AI Classification] Original: "${originalLabel}" | Normalized: "${label}" | Confidence: ${(score * 100).toFixed(1)}%`);

        // TIER 1: Exact substring match (current approach)
        for (const [category, keywords] of Object.entries(MAPPING_DICTIONARY)) {
            const matchedKeyword = keywords.find(keyword => label.includes(keyword));
            if (matchedKeyword) {
                console.log(`[AI Match] ✓ TIER 1 - Category: "${category}" | Keyword: "${matchedKeyword}"`);
                return { category, label: originalLabel };
            }
        }

        // TIER 2: Word-boundary matching (split by spaces, commas, underscores)
        const labelWords = label.split(/[\s,_-]+/).filter((w: string) => w.length > 2); // filter out tiny words
        console.log(`[AI Debug] Label words: [${labelWords.join(', ')}]`);

        for (const [category, keywords] of Object.entries(MAPPING_DICTIONARY)) {
            const matchedKeyword = keywords.find(keyword =>
                labelWords.some((word: string) => word === keyword || word.includes(keyword) || keyword.includes(word))
            );
            if (matchedKeyword) {
                console.log(`[AI Match] ✓ TIER 2 - Category: "${category}" | Word Match: "${matchedKeyword}"`);
                return { category, label: originalLabel };
            }
        }

        // TIER 3: Aggressive partial matching for common patterns
        const commonMappings: Record<string, string> = {
            'screen': 'UI Screenshot',
            'monitor': 'Technology/Gadget',
            'display': 'Technology/Gadget',
            'site': 'Web/App Design',
            'window': 'UI Screenshot',
            'television': 'Technology/Gadget',
            'digital': 'Technology/Gadget',
            'cellular': 'UI Screenshot',
            'remote': 'Technology/Gadget',
            'notebook': 'Coding/Programming',
            'laptop': 'Coding/Programming',
            'desktop': 'Coding/Programming',
        };

        for (const [pattern, category] of Object.entries(commonMappings)) {
            if (label.includes(pattern)) {
                console.log(`[AI Match] ✓ TIER 3 - Category: "${category}" | Pattern: "${pattern}"`);
                return { category, label: originalLabel };
            }
        }

        // TIER 4: Top 3 results fallback (check secondary labels)
        if (results.length > 1) {
            console.log(`[AI Fallback] Checking top ${Math.min(3, results.length)} results...`);
            for (let i = 1; i < Math.min(3, results.length); i++) {
                const altLabel = results[i].label.toLowerCase();
                console.log(`  - Result ${i + 1}: "${results[i].label}" (${(results[i].score * 100).toFixed(1)}%)`);

                for (const [category, keywords] of Object.entries(MAPPING_DICTIONARY)) {
                    if (keywords.some(keyword => altLabel.includes(keyword))) {
                        console.log(`[AI Match] ✓ TIER 4 - Category: "${category}" | Alt Label: "${results[i].label}"`);
                        return { category, label: results[i].label };
                    }
                }
            }
        }

        // Final fallback: Return Grup with detailed logging
        console.warn(`[AI Fallback] ❌ NO MATCH FOUND - Defaulting to "Grup"`);
        console.warn(`[AI Fallback] Label: "${originalLabel}" | All results:`, results.slice(0, 5).map((r: any) => `${r.label} (${(r.score * 100).toFixed(1)}%)`));
        return { category: 'Grup', label: originalLabel };
    } catch (error) {
        console.error('[AI Error] Classification failed:', error);
        return { category: 'Grup', label: 'error' };
    }
}

/**
 * Advanced: Zero-shot classification for specific series/titles
 */
export async function detectSpecificContent(_imageUrl: string, _candidates: string[]) {
    // placeholder for CLIP zero-shot
    // const pipe = await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32');
    // return await pipe(imageUrl, candidates);
}
