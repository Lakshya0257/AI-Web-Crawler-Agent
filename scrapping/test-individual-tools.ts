import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import { OpenAIStagehandClient } from "./src/services/OpenAIStagehandClient.js";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import fs from 'fs';
import path from 'path';

interface ToolTestConfig {
  url: string;
  task: string;
  tool: 'page_act' | 'page_extract' | 'page_observe';
  instruction: string;
  verbose?: 0 | 1 | 2;
}

class IndividualToolTester {
  private stagehand: Stagehand;

  constructor(verbose: 0 | 1 | 2 = 1) {
    // Initialize OpenAI client for Stagehand
    const openaiClient = new OpenAIStagehandClient({
      model: openai("gpt-4o"),
    });

    this.stagehand = new Stagehand({
      env: "LOCAL",
      verbose: verbose,
      llmClient: openaiClient,
    });
  }

  async testTool(config: ToolTestConfig): Promise<void> {
    console.log('\n=== INDIVIDUAL TOOL TEST ===');
    console.log(`URL: ${config.url}`);
    console.log(`Task: ${config.task}`);
    console.log(`Tool: ${config.tool}`);
    console.log(`Instruction: ${config.instruction}`);
    console.log('============================\n');

    try {
      // Initialize Stagehand
      await this.stagehand.init();
      
      // Navigate to URL
      console.log(`🌐 Navigating to: ${config.url}`);
      await this.stagehand.page.goto(config.url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      
      // Wait for page to settle
      await this.stagehand.page.waitForTimeout(3000);
      
      // Take initial screenshot
      const initialScreenshot = await this.stagehand.page.screenshot({ fullPage: true });
      this.saveScreenshot('initial_page', initialScreenshot);
      console.log('📸 Initial screenshot saved');

      // Execute the specified tool
      let result;
      switch (config.tool) {
        case 'page_act':
          result = await this.executePageAct(config.instruction);
          break;
        case 'page_extract':
          result = await this.executePageExtract(config.instruction);
          break;
        case 'page_observe':
          result = await this.executePageObserve(config.instruction);
          break;
        default:
          throw new Error(`Unknown tool: ${config.tool}`);
      }

      // Take final screenshot
      const finalScreenshot = await this.stagehand.page.screenshot({ fullPage: true });
      this.saveScreenshot(`after_${config.tool}`, finalScreenshot);
      console.log('📸 Final screenshot saved');

      // Display results
      console.log('\n=== TOOL EXECUTION RESULT ===');
      console.log(JSON.stringify(result, null, 2));
      console.log('============================\n');

      // Save results to file
      this.saveResult(config, result);

    } catch (error) {
      console.error('❌ Test failed:', error);
    } finally {
      await this.cleanup();
    }
  }

  private async executePageAct(instruction: string): Promise<any> {
    console.log(`🎬 Executing page_act: ${instruction}`);
    
    try {
      const result = await this.stagehand.page.act({
        action: instruction,
      });
      
      console.log('✅ page_act completed successfully');
      return {
        success: true,
        tool: 'page_act',
        instruction: instruction,
        result: result,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ page_act failed:', error);
      return {
        success: false,
        tool: 'page_act',
        instruction: instruction,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      };
    }
  }

  private async executePageExtract(instruction: string): Promise<any> {
    console.log(`📊 Executing page_extract: ${instruction}`);
    
    try {
      const extractSchema = z.object({
        extracted_data: z.string().describe("The extracted information"),
        elements_found: z
          .array(z.string())
          .describe("List of relevant elements found"),
        page_structure: z
          .string()
          .describe("Description of the page structure"),
        interactive_elements: z
          .array(z.string())
          .describe("Interactive elements on the page"),
      });

      const result = await this.stagehand.page.extract({
        instruction,
        schema: extractSchema,
      });
      
      console.log('✅ page_extract completed successfully');
      return {
        success: true,
        tool: 'page_extract',
        instruction: instruction,
        result: result,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ page_extract failed:', error);
      return {
        success: false,
        tool: 'page_extract',
        instruction: instruction,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      };
    }
  }

  private async executePageObserve(instruction: string): Promise<any> {
    console.log(`👀 Executing page_observe: ${instruction}`);
    
    try {
      const result = await this.stagehand.page.observe({
        instruction: instruction,
        returnAction: true, // Get suggested actions for elements
      });

      if(result.length === 0) {
        console.log(`❌ No elements found for observation.`)
      }

      console.log(`✅ Observe succeeded:`, result);

      // Format the observation results for better readability
      const formattedResult = {
        page_state: "observed page",
        visible_elements: result.map(
          (item) => `[${result.indexOf(item)}] ${item.description}`
        ),
        interactive_elements: result
          .filter((item) => item.method)
          .map(
            (item) =>
              `[${result.indexOf(item)}] ${item.method}: ${item.description}`
          ),
        forms_present: result.some(
          (item) =>
            item.description.toLowerCase().includes("form") ||
            item.description.toLowerCase().includes("input") ||
            item.description.toLowerCase().includes("textbox")
        ),
        navigation_options: result
          .filter(
            (item) =>
              item.method === "click" &&
              (item.description.toLowerCase().includes("link") ||
                item.description.toLowerCase().includes("button") ||
                item.description.toLowerCase().includes("menu"))
          )
          .map((item) => `[${result.indexOf(item)}] ${item.description}`),
      };
      
      console.log('✅ page_observe completed successfully');
      return {
        success: true,
        tool: 'page_observe',
        instruction: instruction,
        result: formattedResult,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ page_observe failed:', error);
      return {
        success: false,
        tool: 'page_observe',
        instruction: instruction,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      };
    }
  }

  private saveScreenshot(name: string, buffer: Buffer): void {
    const testDir = 'tool_test_results';
    const screenshotsDir = path.join(testDir, 'screenshots');
    
    // Create directories if they don't exist
    fs.mkdirSync(screenshotsDir, { recursive: true });
    
    const filename = `${name}_${Date.now()}.png`;
    const filepath = path.join(screenshotsDir, filename);
    
    fs.writeFileSync(filepath, buffer);
    console.log(`📸 Screenshot saved: ${filepath}`);
  }

  private saveResult(config: ToolTestConfig, result: any): void {
    const testDir = 'tool_test_results';
    fs.mkdirSync(testDir, { recursive: true });
    
    const resultData = {
      config: config,
      result: result,
      timestamp: new Date().toISOString()
    };
    
    const filename = `test_result_${config.tool}_${Date.now()}.json`;
    const filepath = path.join(testDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(resultData, null, 2));
    console.log(`💾 Result saved: ${filepath}`);
  }

  private async cleanup(): Promise<void> {
    try {
      await this.stagehand.close();
      console.log('🧹 Cleanup completed');
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
    }
  }
}

// Example usage and CLI interface
async function runTest() {
  // Get command line arguments or use defaults
  const args = process.argv.slice(2);
  
  let config: ToolTestConfig;
  
  if (args.length >= 4) {
    // Parse command line arguments
    config = {
      url: args[0],
      task: args[1], 
      tool: args[2] as 'page_act' | 'page_extract' | 'page_observe',
      instruction: args[3],
      verbose: args[4] === '2' ? 2 : args[4] === '0' ? 0 : 1
    };
  } else {
    // Use example configuration
    console.log('Usage: npm run test-tools <url> <task> <tool> <instruction> [verbose]');
    console.log('Example: npm run test-tools "https://github.com" "Find pricing info" "page_observe" "Look for pricing or plans links" 1');
    console.log('\nUsing example configuration...\n');
    
    config = {
      url: "https://github.com",
      task: "Find pricing information",
      tool: "page_observe",
      instruction: "Look for pricing, plans, or subscription links on the page",
      verbose: 1
    };
  }

  // Validate tool name
  if (!['page_act', 'page_extract', 'page_observe'].includes(config.tool)) {
    console.error('❌ Invalid tool. Must be: page_act, page_extract, or page_observe');
    process.exit(1);
  }

  const tester = new IndividualToolTester(config.verbose);
  await tester.testTool(config);
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTest().catch(console.error);
}

export { IndividualToolTester, ToolTestConfig }; 