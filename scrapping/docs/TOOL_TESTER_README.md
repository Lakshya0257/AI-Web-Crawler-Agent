# Individual Tool Tester

This standalone test file allows you to test individual Stagehand tools (`page_act`, `page_extract`, `page_observe`) without using any code from the services directory.

## Prerequisites

Make sure you have your OpenAI API key set in your environment:
```bash
export OPENAI_API_KEY="your-api-key-here"
```
Or create a `.env` file with:
```
OPENAI_API_KEY=your-api-key-here
```

## Usage

### Command Line
```bash
npm run test-tools <url> <task> <tool> <instruction> [verbose]
```

### Parameters
- **url**: The website URL to test on
- **task**: Description of what you're trying to accomplish  
- **tool**: Which tool to test (`page_act`, `page_extract`, or `page_observe`)
- **instruction**: The specific instruction for the tool
- **verbose**: Optional verbosity level (0, 1, or 2, default: 1)

### Examples

#### Test page_observe to find pricing links
```bash
npm run test-tools "https://github.com" "Find pricing info" "page_observe" "Look for pricing, plans, or subscription links on the page" 1
```

#### Test page_act to click a button
```bash
npm run test-tools "https://github.com" "Navigate to pricing" "page_act" "Click on the Pricing link" 1
```

#### Test page_extract to get specific data
```bash
npm run test-tools "https://github.com" "Extract pricing plans" "page_extract" "Extract all pricing plan names and their prices" 1
```

### Without Arguments
If you run without arguments, it will use a default example:
```bash
npm run test-tools
```

## Output

The tool will:
1. Navigate to the specified URL
2. Take an initial screenshot
3. Execute the specified tool with your instruction
4. Take a final screenshot
5. Display the results in the console
6. Save results and screenshots to `tool_test_results/` directory

### Output Files
- `tool_test_results/screenshots/` - Before and after screenshots
- `tool_test_results/test_result_[tool]_[timestamp].json` - Detailed results

## Available Tools

### page_observe
- **Purpose**: Observe and analyze elements on the page
- **Returns**: Formatted list of visible elements, interactive elements, forms, and navigation options
- **Use when**: You want to understand what's available on the page

### page_extract  
- **Purpose**: Extract specific data from the page
- **Returns**: Structured data including extracted information, elements found, page structure
- **Use when**: You want to pull specific information from the page

### page_act
- **Purpose**: Perform actions like clicking, typing, scrolling
- **Returns**: Success/failure status of the action
- **Use when**: You want to interact with page elements

## Notes

- The tester initializes its own Stagehand instance with OpenAI LLM client
- No dependencies on the main services code (except OpenAIStagehandClient)
- Each test is isolated and cleans up after itself
- Screenshots are automatically saved for debugging
- Verbose levels: 0 (silent), 1 (normal), 2 (detailed)
- Requires OPENAI_API_KEY environment variable 