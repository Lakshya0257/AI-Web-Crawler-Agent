# Background Processing for Exploration Mode

## Overview

The WebExplorer now supports intelligent processing modes based on the objective type:

- **Exploration Mode**: Uses background processing for efficient concurrent page exploration
- **Task-Focused Mode**: Uses sequential processing for targeted objective completion

## New Features

### 🔗 Page Linkage Tracking
The system now tracks which page leads to which page, creating a complete navigation map for frontend diagram visualization. This includes:
- **Directional relationships**: Records when page A links to page B
- **Circular references**: Properly handles circular navigation patterns
- **Frontend integration**: Saves linkages in JSON format for easy consumption

### 📊 Configurable Page Limits
Added `maxPagesToExplore` parameter to control exploration scope:
- **Constructor parameter**: Set during WebExplorer initialization (default: 6)
- **Runtime override**: Can be changed via explore() method parameter
- **Automatic limiting**: Stops adding new pages when limit is reached

## Implementation Details

### Automatic Mode Detection

The system automatically detects exploration objectives based on keywords:

```typescript
private detectExplorationObjective(objective: string): boolean {
  const lowerObjective = objective.toLowerCase();
  return (
    lowerObjective.includes("explore") ||
    lowerObjective.includes("exploration") ||
    lowerObjective.includes("discover") ||
    lowerObjective.includes("depth") ||
    lowerObjective.includes("whole site") ||
    lowerObjective.includes("entire site")
  );
}
```

### Background Processing Flow

#### Exploration Mode (`exploreWithBackgroundProcessing()`)
1. **Non-blocking Processing**: Pages are processed concurrently without waiting
2. **Promise Tracking**: Active processing promises are tracked in `activeProcessingPromises` Map
3. **Queue Management**: New pages are continuously shifted from queue and processed
4. **Completion Detection**: Loop continues until all pages have "completed" status
5. **Smart Waiting**: System intelligently waits for processing to complete

#### Task-Focused Mode (`exploreSequentially()`)
1. **Sequential Processing**: Pages are processed one at a time
2. **Immediate Response**: Stops as soon as objective is achieved
3. **Focused Navigation**: Direct path to target information

### Key Features

#### 1. Concurrent Processing
```typescript
// Start processing in background (don't await)
const processingPromise = this.processPage(pageData).finally(() => {
  // Clean up completed promise
  this.activeProcessingPromises.delete(urlHash);
});

// Track the processing promise
this.activeProcessingPromises.set(urlHash, processingPromise);
```

#### 2. Intelligent Completion Detection
```typescript
private areAllPagesCompleted(): boolean {
  for (const [urlHash, pageData] of this.session.pages) {
    if (pageData.status !== "completed") {
      return false;
    }
  }
  return true;
}
```

#### 3. Graceful Shutdown
```typescript
private async waitForAllProcessingToComplete(): Promise<void> {
  if (this.activeProcessingPromises.size > 0) {
    logger.info(`⏳ Waiting for ${this.activeProcessingPromises.size} background processes to complete...`);
    await Promise.allSettled(Array.from(this.activeProcessingPromises.values()));
    this.activeProcessingPromises.clear();
  }
}
```

### LLM Integration

The `isExplorationObjective` parameter is now passed to the LLM decision-making process:

```typescript
const decision = await this.llmClient.decideNextAction(
  currentScreenshotBuffer,
  pageData.url,
  this.session.metadata.objective,
  pageData.urlHash,
  this.session.globalStepCounter,
  conversationHistory,
  this.session.pageQueue,
  this.session.pages,
  this.isExplorationObjective  // New parameter
);
```

This allows the LLM to:
- Understand the processing mode
- Make appropriate decisions for exploration vs task-focused objectives
- Optimize its strategy based on whether background processing is enabled

### Benefits

#### For Exploration Objectives:
- **Faster Discovery**: Multiple pages processed concurrently
- **Better Coverage**: System doesn't get stuck on single pages
- **Efficient Resource Usage**: Browser automation runs in parallel
- **Comprehensive Results**: All discovered pages are eventually processed

#### For Task-Focused Objectives:
- **Direct Navigation**: Sequential processing for focused goals
- **Quick Results**: Stops immediately when objective is achieved
- **Resource Conservation**: No unnecessary concurrent processing

### Example Usage

#### Exploration Objective
```typescript
const objective = "explore the entire website and discover all features";
// → Automatically detected as exploration mode
// → Uses background processing
// → Processes multiple pages concurrently
```

#### Task-Focused Objective
```typescript
const objective = "find pricing information";
// → Detected as task-focused mode
// → Uses sequential processing  
// → Stops when pricing page is found
```

### Monitoring and Logging

The system provides detailed logging for background processing:

```
🔄 Started background processing for: https://example.com/about
   activeProcessing: 3, queueRemaining: 12

⏳ Waiting for background processing to complete...
   activeProcessing: 2

✅ All pages completed in exploration mode
```

### Error Handling

- **Promise Rejection**: Uses `Promise.allSettled()` to handle individual page failures
- **Cleanup**: Ensures promises are properly removed from tracking map
- **Graceful Degradation**: System continues processing even if individual pages fail

## Architecture Impact

This implementation maintains backward compatibility while adding significant performance improvements for exploration scenarios. The modular design allows easy extension for future processing modes or strategies. 