# 🤖 Intelligent Web Scraper (TypeScript)

**Autonomous Website Exploration with Detailed Logging & Multiple Screenshots**

## ✨ Features

- **🧠 Intelligent Exploration**: Step-by-step autonomous website navigation
- **📸 Multiple Screenshots**: Captures screenshots at every action step
- **📝 Detailed Logging**: Creates individual log files for each step + master log
- **🔄 Dynamic Interaction**: Clicks links, navigates pages, extracts data
- **📊 Structured Data**: Exports comprehensive JSON results
- **🎯 Goal-Oriented**: Follows a systematic exploration pattern

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- **Google Gemini API key** (required for LLM automation)

### Installation

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your Google API key
```

### Usage

```bash
# Run the scraper
npm test

# Or with dev mode (auto-reload)
npm run dev
```

## 🎯 How It Works

### Exploration Flow
The scraper follows this exact pattern:

1. **🌐 Initialize Browser** - Set up Stagehand automation
2. **🔗 Navigate** - Go to target URL + take screenshot
3. **👀 Observe** - Analyze page structure and navigation
4. **📊 Extract** - Get basic page information and content
5. **🔄 Interact** - Click navigation links (About/Services)
6. **📸 Screenshot** - Capture multiple page views
7. **📊 Secondary Extract** - Get information from new page
8. **🔙 Navigate Back** - Return to home page
9. **📊 Final Extract** - Comprehensive data extraction

### Screenshots Captured
- **Navigation screenshots** - After each page navigation
- **Action result screenshots** - After clicking/interacting
- **Full page screenshots** - Complete page capture
- **Viewport screenshots** - Above-the-fold content
- **Multiple per step** - Different views of same action

### Log Files Created
```
analysis/
└── domain_name_timestamp/
    ├── step_01_initialize.json
    ├── step_02_browser_init.json
    ├── step_03_navigate.json
    ├── step_04_page_observe.json
    ├── step_05_page_extract.json
    ├── step_06_page_act.json
    ├── step_07_take_screenshot.json
    ├── step_08_page_extract.json
    ├── step_09_page_act.json
    ├── step_10_page_extract.json
    ├── master_log.json
    ├── session_metadata.json
    └── complete_session_log.json
```

## 📊 Data Structure

```typescript
interface ScrapingResult {
  success: boolean;
  url: string;
  totalSteps: number;
  explorationSteps: ExplorationStep[];
  screenshots: Screenshot[];
  extractedData: {
    observations: any[];
    extractions: any[];
    actions: any[];
    pageInfo: any;
  };
  processingTime: number;
  timestamp: string;
  sessionId: string;
}
```

### Example Output
```json
{
  "success": true,
  "url": "https://profit.co",
  "totalSteps": 7,
  "explorationSteps": [
    {
      "step": 1,
      "action": { "action": "page_observe", "instruction": "Analyze page structure" },
      "success": true,
      "data": { "observation": {...}, "pageUrl": "..." },
      "screenshots": []
    }
  ],
  "screenshots": [
    {
      "filename": "step_02_navigate_2025-06-25T10-30-45-123Z.png",
      "path": "screenshots/domain_timestamp/...",
      "step": 2,
      "action": "navigate",
      "timestamp": "2025-06-25T10:30:45.123Z"
    }
  ],
  "extractedData": {
    "observations": [...],
    "extractions": [...],
    "actions": [...],
    "pageInfo": {...}
  },
  "processingTime": 45000,
  "sessionId": "profit_co_2025-06-25T10-30-45Z"
}
```

## 🔧 Configuration

### Change Target URL
Edit `src/index.ts`:
```typescript
const testUrl = 'https://your-target-website.com';
const objective = 'Your exploration objective here';
```

### Environment Variables
Create `.env`:
```bash
GOOGLE_API_KEY=your_google_api_key_here
```

## 📁 File Structure

```
src/
├── types/
│   └── index.ts              # TypeScript interfaces
├── utils/
│   └── logger.ts            # Winston logging setup  
├── services/
│   ├── IntelligentScraper.ts   # Main scraper engine
│   ├── SessionLogger.ts        # Step-by-step logging
│   └── ScreenshotManager.ts    # Screenshot handling
└── index.ts                 # Entry point

Generated Output:
├── analysis/                # Step-by-step logs
├── screenshots/             # Captured images  
├── data/                   # Final JSON results
└── logs/                   # System logs
```

## 🎯 Action Types

- **`page_observe`** - Analyze page structure, find navigation elements
- **`page_act`** - Interact with page (click links, navigate)
- **`page_extract`** - Extract data (titles, content, contact info)
- **`take_screenshot`** - Capture visual state of page

## 📸 Screenshot Organization

Screenshots are organized by session and step:
```
screenshots/
└── profit_co_2025-06-25T10-30-45Z/
    ├── step_02_navigate_2025-06-25T10-30-45-123Z.png
    ├── step_06_action_result_2025-06-25T10-30-47-456Z.png
    ├── step_07_full_page_2025-06-25T10-30-48-789Z.png
    ├── step_07_viewport_2025-06-25T10-30-49-012Z.png
    └── screenshot_manifest.json
```

## 🔍 Example Console Output

```bash
🚀 Starting Intelligent Web Scraper
🎯 Testing with URL: https://profit.co
🚀 Session started: profit_co_2025-06-25T10-30-45Z
🌐 Initializing browser...
✅ Browser initialized successfully
🔗 Navigating to: https://profit.co
✅ Successfully navigated to https://profit.co
🔄 Step 2: page_observe - Analyze the current page structure
✅ Step 2: page_observe - Analyze the current page structure (1250ms)
🔄 Step 3: page_extract - Extract basic page information
✅ Step 3: page_extract - Extract basic page information (890ms)
🔄 Step 4: page_act - Look for and click on About or Services navigation link
✅ Step 4: page_act - Look for and click on About or Services navigation link (2100ms) | Screenshots: 1
🔄 Step 5: take_screenshot - Capture multiple screenshots
📸 2 screenshots saved for step 5
✅ Step 5: take_screenshot - Capture multiple screenshots (1450ms) | Screenshots: 2
✅ Scraping completed successfully!
📊 Results:
   • Total Steps: 7
   • Screenshots: 8
   • Processing Time: 15230ms
   • Session ID: profit_co_2025-06-25T10-30-45Z
```

## 🛠 Development

```bash
# Build TypeScript
npm run build

# Run with auto-reload
npm run dev

# Direct execution
npm start
```

## 🚀 Get Started

1. **Get Google Gemini API key** from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. **Set environment variables** in `.env`
3. **Run the scraper**: `npm test`

That's it! The system will autonomously explore the website and create detailed logs and screenshots of every step. 🎉