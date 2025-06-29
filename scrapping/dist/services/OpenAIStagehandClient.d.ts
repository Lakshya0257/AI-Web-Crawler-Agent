/**
 * Welcome to the Stagehand OpenAI client!
 *
 * This is a client for OpenAI using the Vercel AI SDK
 * that allows you to create chat completions with OpenAI.
 *
 * To use this client, you need to have the OpenAI AI SDK installed and the appropriate environment variables set.
 *
 * ```bash
 * npm install @ai-sdk/openai
 * ```
 *
 * Environment variables needed:
 * - OPENAI_API_KEY: Your OpenAI API key
 */
import { LanguageModel } from "ai";
import { CreateChatCompletionOptions, LLMClient } from "@browserbasehq/stagehand";
import { ChatCompletion } from "openai/resources";
export declare class OpenAIStagehandClient extends LLMClient {
    type: "openai";
    private model;
    constructor({ model }: {
        model: LanguageModel;
    });
    createChatCompletion<T = ChatCompletion>({ options, }: CreateChatCompletionOptions): Promise<T>;
}
