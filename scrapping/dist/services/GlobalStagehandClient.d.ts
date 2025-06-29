/******************************************************************************
 * YOU PROBABLY DON'T WANT TO BE USING THIS FILE DIRECTLY                      *
 * INSTEAD, EDIT `stagehand.config.ts` TO MODIFY THE CLIENT CONFIGURATION      *
 ******************************************************************************/
/**
 * Welcome to the Stagehand Azure OpenAI client!
 *
 * This is a client for Azure OpenAI using the Vercel AI SDK
 * that allows you to create chat completions with Azure OpenAI.
 *
 * To use this client, you need to have the Azure AI SDK installed and the appropriate environment variables set.
 *
 * ```bash
 * npm install @ai-sdk/azure
 * ```
 *
 * Environment variables needed:
 * - AZURE_OPENAI_API_KEY: Your Azure OpenAI API key
 * - AZURE_OPENAI_ENDPOINT: Your Azure OpenAI endpoint
 * - AZURE_OPENAI_DEPLOYMENT: Your deployment name
 * - AZURE_OPENAI_API_VERSION: API version (optional, defaults to 2024-10-01-preview)
 */
import { LanguageModel } from "ai";
import { CreateChatCompletionOptions, LLMClient } from "@browserbasehq/stagehand";
export declare class GlobalStagehandClient extends LLMClient {
    type: "global";
    private model;
    constructor({ model }: {
        model: LanguageModel;
    });
    createChatCompletion<T>({ options, }: CreateChatCompletionOptions): Promise<T>;
}
