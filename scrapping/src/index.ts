import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import { WebExplorer, GlobalStagehandClient } from "./core/index.js";
import logger from "./utils/logger.js";
import { vertex } from "@ai-sdk/google-vertex";

// Re-export all modules for external use
export * from "./core/index.js";
export * from "./server/index.js";
export * from "./interfaces/index.js";
export * from "./utils/logger.js";

async function main() {
  logger.info("🚀 Starting Fresh Web Explorer");

  // Parse command line arguments
  const args = process.argv.slice(2);
  const urlIndex = args.indexOf("--url");
  const objectiveIndex = args.indexOf("--objective");

  if (urlIndex === -1 || objectiveIndex === -1) {
    logger.error(
      "❌ Missing required arguments. Usage: npm start -- --url <URL> --objective <OBJECTIVE>"
    );
    process.exit(1);
  }

  const startUrl = args[urlIndex + 1];
  const objectiveArgs = args.slice(objectiveIndex + 1);
  const objective = objectiveArgs.join(" ").replace(/^["']|["']$/g, ""); // Remove quotes and join multi-word objectives

  if (!startUrl || !objective) {
    logger.error("❌ URL and objective cannot be empty");
    process.exit(1);
  }

  // Initialize Vertex AI model for Stagehand
  const vertexModel = vertex("gemini-1.5-pro");

  // Initialize Stagehand client with Vertex AI
  const llmClient = new GlobalStagehandClient({
    model: vertexModel,
  });

  // Initialize Stagehand browser with OpenAI client
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    llmClient: llmClient,
    localBrowserLaunchOptions: {
      headless: true,
    },
    browserbaseSessionCreateParams: {
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      browserSettings: {
        blockAds: true,
        viewport: {
          width: 1920,
          height: 1080,
        },
      },
    },
  });

  try {
    // Initialize browser and page
    await stagehand.init();
    const page = stagehand.page;
    const browser = stagehand.context.browser()!;

    logger.info(`🎯 Starting URL: ${startUrl}`);
    logger.info(`📋 Objective: ${objective}`);

    // Create explorer instance
    const explorer = new WebExplorer(
      browser,
      page,
      objective,
      startUrl,
      stagehand
    );

    // Start tool-driven exploration
    const success = await explorer.explore();

    if (success) {
      logger.info(
        "✅ Exploration completed successfully - Objective achieved!"
      );
    } else {
      logger.info(
        "⚪ Exploration completed - Objective not achieved, but data collected"
      );
    }
  } catch (error) {
    logger.error("❌ Fatal error during exploration:", error);
  } finally {
    // Clean up
    try {
      await stagehand.close();
      logger.info("🧹 Browser closed successfully");
    } catch (error) {
      logger.error("❌ Error closing browser:", error);
    }
  }

  logger.info("🏁 Fresh Web Explorer finished");
}

// Run the main function
main().catch((error) => {
  logger.error("❌ Unhandled error:", error);
  process.exit(1);
});
