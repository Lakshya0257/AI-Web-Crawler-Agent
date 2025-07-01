import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";
import { OpenAIStagehandClient } from "./OpenAIStagehandClient.js";
import { GoogleVertexStagehandClient } from "./GoogleVertexStagehandClient.js";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { vertex } from "@ai-sdk/google-vertex";
import { GlobalStagehandClient } from "../src/core/llm/GlobalStagehandClient.js";

async function testStagehandClients() {
  console.log("🧪 Testing All Stagehand Clients");

  // Example 1: OpenAI Client (requires OPENAI_API_KEY)
  // console.log("\n=== OpenAI Client ===");
  // try {
  //   const openaiClient = new OpenAIStagehandClient({
  //     model: openai("gpt-4o"),
  //   });

  //   const stagehandOpenAI = new Stagehand({
  //     env: "LOCAL",
  //     verbose: 1,
  //     llmClient: openaiClient,
  //   });

  //   await stagehandOpenAI.init();

  //   await stagehandOpenAI.page.goto("https://www.google.com", {
  //     waitUntil: "domcontentloaded",
  //   });

  //   const result = await stagehandOpenAI.page.act(
  //     "Type 'Hello, World!' into the search bar"
  //   );
  //   if (result.success) {
  //     console.log("✅ OpenAI Stagehand client created successfully");
  //   }
  //   await stagehandOpenAI.close();
  // } catch (error) {
  //   console.error("❌ OpenAI client error:", error);
  // }

  // Example 2: Claude Client (requires ANTHROPIC_API_KEY)
  console.log("\n=== Claude Client ===");
  try {
    const claudeClient = new GlobalStagehandClient({
      model: anthropic("claude-3-5-sonnet-20241022"),
    });

    const stagehandClaude = new Stagehand({
      env: "LOCAL",
      verbose: 2,
      llmClient: claudeClient,
      browserbaseSessionCreateParams: {
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
        browserSettings: {
          blockAds: true,
          viewport: {
            width: 1024,
            height: 768,
          },
        },
      },
    });

    await stagehandClaude.init();

    // Navigate to a website
    await stagehandClaude.page.goto("https://youtube.com");

    const agent = stagehandClaude.agent({
      // You can use either OpenAI or Anthropic
      provider: "openai",
      // The model to use (claude-3-7-sonnet-latest for Anthropic)
      model: "gpt-4.1-mini",

      // Customize the system prompt
      instructions: `You are a helpful assistant that can use a web browser.
	Do not ask follow up questions, the user will trust your judgement. Also only do that action what user have asked, don't do anything else.`,

      // Customize the API key
      options: {
        apiKey: process.env.OPENAI_API_KEY,
      },
    });

    // Execute the agent
    const response = await agent.execute("Navigate to https://www.google.com");

    console.log("Agent response:", response);

    // await stagehandClaude.init();

    // await stagehandClaude.page.goto("https://figma.com", {
    //   waitUntil: "domcontentloaded",
    // });

    // const result = await stagehandClaude.page.act(
    //   "Type 'Hello, World!' into the search bar"
    // );
    // if (result.success) {
    //   console.log("✅ Claude Stagehand client created successfully");
    // }

    // const result2 = await stagehandClaude.page.act(
    //   "Click the 'Button to open navigation menu in header"
    // );
    // if (result2.success) {
    //   console.log("✅ Claude Stagehand 2 client created successfully", result2);
    // }

    // const result3 = await stagehandClaude.page.act(
    //   "Click on the 'Community' dropdown"
    // );
    // if (result3.success) {
    //   console.log("✅ Claude Stagehand 3 client created successfully", result3);
    // }
    await stagehandClaude.close();
  } catch (error) {
    console.error("❌ Claude client error:", error);
  }

  // Example 3: Google Vertex Client (requires GOOGLE_APPLICATION_CREDENTIALS)
  // console.log("\n=== Google Vertex Client ===");
  // try {
  //   const vertexClient = new GoogleVertexStagehandClient({
  //     model: vertex("gemini-2.0-flash"),
  //   });

  //   const stagehandVertex = new Stagehand({
  //     env: "LOCAL",
  //     verbose: 1,
  //     llmClient: vertexClient,
  //   });

  //   await stagehandVertex.init();

  //   await stagehandVertex.page.goto("https://www.google.com", {
  //     waitUntil: "domcontentloaded",
  //   });

  //   const result = await stagehandVertex.page.act(
  //     "Type 'Hello, World!' into the search bar"
  //   );

  //   if (result.success) {
  //     console.log("✅ Google Vertex Stagehand client created successfully");
  //   }
  //   await stagehandVertex.close();
  // } catch (error) {
  //   console.error("❌ Google Vertex client error:", error);
  // }

  console.log("\n🏁 All client tests completed");
}

// Example usage function showing how to switch between clients
export function getStagehandClient(provider: "openai" | "claude" | "vertex") {
  switch (provider) {
    case "openai":
      return new OpenAIStagehandClient({
        model: openai("gpt-4o"),
      });
    case "claude":
      return new GlobalStagehandClient({
        model: anthropic("claude-3-5-sonnet-20241022"),
      });
    case "vertex":
      return new GoogleVertexStagehandClient({
        model: vertex("gemini-2.0-flash"),
      });
    default:
      throw new Error("Unknown provider");
  }
}

// Usage example:
/*
const client = getStagehandClient("vertex"); // or "openai" or "claude"
const stagehand = new Stagehand({
  env: "LOCAL",
  verbose: 1,
  llmClient: client,
});
*/

// Run the test
testStagehandClients();
