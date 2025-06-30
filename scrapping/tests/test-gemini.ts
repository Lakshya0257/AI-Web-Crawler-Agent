import "dotenv/config";
import { google } from "@ai-sdk/google";
import { vertex } from "@ai-sdk/google-vertex";
import { generateObject } from "ai";
import { z } from "zod";

async function testGemini() {
  console.log("🧪 Testing Gemini Flash with Vercel AI SDK");
  
  try {
    const result = await generateObject({
      model: vertex("gemini-2.0-flash"),
      schema: z.object({
        message: z.string().describe("A simple greeting message"),
        timestamp: z.string().describe("Current timestamp"),
        status: z.string().describe("Status of the test")
      }),
      system:"You are a helpful assistant that can generate a simple test response with a greeting message, current timestamp, and success status.",
      prompt: "Generate a simple test response with a greeting message, current timestamp, and success status."
    });

    console.log("✅ Gemini Flash Response:");
    console.log(JSON.stringify(result.object, null, 2));
    
  } catch (error) {
    console.error("❌ Error testing Gemini:", error);
  }
}

// Run the test
testGemini(); 