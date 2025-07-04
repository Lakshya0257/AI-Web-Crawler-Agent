/**
 * Complete Tree Exploration Test with Full Debugging
 * 
 * This test demonstrates the entire tree-based exploration system with:
 * - Automatic tree state saving (JSON + ASCII)
 * - Decision debugging at each step
 * - Combined instruction tracking
 * - Progress monitoring
 * - Complete file-based debugging system
 */

import { WebExplorer } from './src/core/exploration/WebExplorer.js';
import { chromium } from 'playwright';
import { Stagehand } from '@browserbasehq/stagehand';
import logger from './src/utils/logger.js';

async function testCompleteTreeExploration() {
  console.log('🌳 Starting Complete Tree Exploration Test with Full Debugging');
  console.log('====================================================================');

  let browser;
  let explorer;
  
  try {
    // Launch browser
    browser = await chromium.launch({ 
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Initialize Stagehand
    const stagehand = new Stagehand({
      page,
      modelName: "claude-3-5-sonnet-20241022",
      modelClientOptions: {
        apiKey: process.env.ANTHROPIC_API_KEY
      }
    });

    // Test URL - using a simple form page for tree exploration
    const testUrl = 'https://formspree.io/';
    
    console.log(`🎯 Target URL: ${testUrl}`);
    console.log(`🌳 Tree Exploration Mode: ENABLED`);
    console.log(`📁 Debug files will be saved to: lakshay@figr.design/[session_id]/urls/[url_hash]/tree_states/`);
    console.log('');

    // Create WebExplorer in tree exploration mode
    explorer = new WebExplorer(
      browser,
      page,
      'Explore the website systematically using tree-based exploration to discover all interactive elements and user flows',
      testUrl,
      stagehand,
      3, // maxPagesToExplore
      undefined, // socket
      'lakshay@figr.design', // userName
      undefined, // activeExplorations
      true, // isExploration - this enables tree mode
      'Test the complete tree exploration system with full debugging', // additionalContext
      false // canLogin
    );

    console.log('🚀 Starting Tree Exploration...');
    console.log('');
    console.log('Expected Debug Files:');
    console.log('  📄 tree_step_001.json - Initial tree state');
    console.log('  📄 tree_step_001.txt - ASCII tree visualization');
    console.log('  📄 tree_decision_step_001.json - LLM decision details');
    console.log('  📄 combined_instruction_step_XXX.json - Combined instructions (if page changes)');
    console.log('  📸 Screenshots for each step');
    console.log('');

    // Run exploration
    const success = await explorer.explore();
    
    console.log('');
    console.log('====================================================================');
    console.log(`🏁 Tree Exploration Completed: ${success ? 'SUCCESS' : 'FAILED'}`);
    console.log('');
    
    if (success) {
      console.log('✅ Check the debug files in the tree_states folder to see:');
      console.log('   - Complete tree structure at each step');
      console.log('   - LLM decision reasoning and action selection');
      console.log('   - Combined instruction generation for optimal navigation');
      console.log('   - Progress tracking and completion statistics');
      console.log('');
      console.log('📊 Tree exploration provides systematic coverage of all UI elements');
      console.log('🔄 Backtracking enables efficient exploration of complex user flows');
      console.log('📝 Every step is logged for debugging and analysis');
    } else {
      console.log('❌ Exploration failed - check logs for details');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Enhanced test with step-by-step monitoring
async function testTreeExplorationWithMonitoring() {
  console.log('');
  console.log('🔍 Enhanced Test: Tree Exploration with Step Monitoring');
  console.log('========================================================');

  let browser;
  let explorer;
  
  try {
    browser = await chromium.launch({ 
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    const stagehand = new Stagehand({
      page,
      modelName: "claude-3-5-sonnet-20241022",
      modelClientOptions: {
        apiKey: process.env.ANTHROPIC_API_KEY
      }
    });

    // Test with a more complex site
    const testUrl = 'https://example.com';
    
    explorer = new WebExplorer(
      browser,
      page,
      'Systematically explore this website to build a complete interaction tree',
      testUrl,
      stagehand,
      2,
      undefined,
      'lakshay@figr.design',
      undefined,
      true, // Enable tree exploration
      'Monitor every step of tree building process',
      false
    );

    console.log('🎯 This test will show you:');
    console.log('  1. Tree initialization (root node creation)');
    console.log('  2. Action discovery (finding all clickable elements)');
    console.log('  3. Action execution (taking highest priority action)');
    console.log('  4. State tracking (completed vs pending actions)');
    console.log('  5. Backtracking (moving to incomplete branches)');
    console.log('  6. Combined instructions (optimal navigation paths)');
    console.log('');

    const success = await explorer.explore();
    
    console.log('🎉 Monitoring complete!');
    console.log('Check the generated files to see the complete tree exploration process.');

  } catch (error) {
    console.error('❌ Monitoring test failed:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run tests
async function runAllTests() {
  console.log('🧪 Tree Exploration Complete System Test');
  console.log('==========================================');
  console.log('');
  
  // Test 1: Basic tree exploration with debugging
  await testCompleteTreeExploration();
  
  // Wait before next test
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 2: Enhanced monitoring
  await testTreeExplorationWithMonitoring();
  
  console.log('');
  console.log('🎯 All Tests Complete!');
  console.log('');
  console.log('📁 Find your debug files in:');
  console.log('   Web-Crawler/scrapping/lakshay@figr.design/[session_id]/urls/[url_hash]/tree_states/');
  console.log('');
  console.log('📋 File Types Generated:');
  console.log('   🌳 tree_step_XXX.json - Complete tree state');
  console.log('   📄 tree_step_XXX.txt - Human-readable ASCII tree');
  console.log('   🧠 tree_decision_step_XXX.json - LLM decision details');
  console.log('   🔄 combined_instruction_step_XXX.json - Navigation optimization');
  console.log('   📸 step_XXX_*.png - Screenshots at each step');
}

// Set up environment check
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

// Run the tests
runAllTests().catch(console.error); 