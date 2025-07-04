# Folder Structure Guide

## Overview
The intelligent scraper now creates readable, organized folder structures that make it easy to understand what was explored and when.

## Folder Naming Convention

### Format
```
{domain}--{path}--{context}--{timestamp}
```

### Components
- **Domain**: Clean domain name (removes `www.`, replaces `.` with `-`)
- **Path**: URL path (removes query params, replaces `/` with `-`)  
- **Context**: Exploration type (`exploration` or `query`)
- **Timestamp**: ISO timestamp for uniqueness

### Examples

| Original URL | Folder Name |
|-------------|-------------|
| `https://github.com` | `github-com--exploration--2025-06-25T20-15-30Z` |
| `https://github.com/microsoft/vscode` | `github-com--microsoft-vscode--exploration--2025-06-25T20-15-30Z` |
| `https://docs.github.com/en/actions` | `docs-github-com--en-actions--exploration--2025-06-25T20-15-30Z` |
| `https://github.com/settings/profile?tab=account` | `github-com--settings-profile--exploration--2025-06-25T20-15-30Z` |

## Key Improvements

### ✅ Before vs After
**Before (Hard to read):**
```
github_com_2025-06-25T18-14-47Z/
github_com_2025-06-25T18-15-32Z/
github_com_2025-06-25T18-16-45Z/
```

**After (Clear and readable):**
```
github-com--exploration--2025-06-25T20-15-30Z/
github-com--microsoft-vscode--exploration--2025-06-25T20-16-15Z/
docs-github-com--en-actions--query--2025-06-25T20-17-00Z/
```

### ✅ URL Processing
- **Query parameters removed**: `?tab=account&sort=name` → ignored
- **Fragments removed**: `#section1` → ignored  
- **Trailing slashes normalized**: `/path/` → `/path`
- **Special characters cleaned**: `/api/v1/users` → `api-v1-users`

## Folder Contents

### Analysis Folders (`analysis/`)
Each session folder contains:
- `session_metadata.json` - Session info with URL summary and context
- `master_log.json` - Complete step-by-step log
- `step_XX_action.json` - Individual step details
- `complete_session_log.json` - Final consolidated log

### Screenshot Folders (`screenshots/`)
Each session folder contains:
- `step_XX_action_timestamp.png` - Screenshots for each step
- `screenshot_manifest.json` - Index of all screenshots

### Data Folders (`data/`)
Final results:
- `{domain}_timestamp_final_result.json` - Consolidated extraction results

## Session Metadata Enhancement

Each session now includes:
```json
{
  "sessionId": "github-com--microsoft-vscode--exploration--2025-06-25T20-15-30Z",
  "url": "https://github.com/microsoft/vscode", 
  "urlSummary": "github.com/microsoft/vscode",
  "explorationContext": "exploration",
  "startTime": "2025-06-25T20:15:30.123Z",
  "totalSteps": 8,
  "success": true
}
```

## Finding Specific Sessions

### By Domain
```bash
ls analysis/ | grep "github-com"
ls analysis/ | grep "docs-github-com"
```

### By Page Type  
```bash
ls analysis/ | grep "homepage"
ls analysis/ | grep "settings"
ls analysis/ | grep "microsoft-vscode"
```

### By Context
```bash
ls analysis/ | grep "exploration"
ls analysis/ | grep "query"  
```

### By Date
```bash
ls analysis/ | grep "2025-06-25"
ls analysis/ | sort  # Chronological order
```

This makes it much easier to:
1. **Find specific explorations** by domain or page
2. **Understand what was explored** without opening files
3. **Organize results** by website or section
4. **Compare different sessions** on the same site
5. **Debug issues** by quickly identifying problematic URLs 