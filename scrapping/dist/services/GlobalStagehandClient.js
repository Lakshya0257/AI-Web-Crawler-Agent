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
import { generateObject, generateText, } from "ai";
import { LLMClient, } from "@browserbasehq/stagehand";
export class GlobalStagehandClient extends LLMClient {
    type = "global";
    model;
    constructor({ model }) {
        super(model.modelId);
        this.model = model;
    }
    async createChatCompletion({ options, }) {
        const formattedMessages = options.messages.map((message) => {
            if (Array.isArray(message.content)) {
                if (message.role === "system") {
                    const systemMessage = {
                        role: "system",
                        content: message.content
                            .map((c) => ("text" in c ? c.text : ""))
                            .join("\n"),
                    };
                    return systemMessage;
                }
                const contentParts = message.content.map((content) => {
                    if ("image_url" in content) {
                        const imageContent = {
                            type: "image",
                            image: content.image_url?.url ?? "",
                        };
                        return imageContent;
                    }
                    else {
                        const textContent = {
                            type: "text",
                            text: content.text ?? "",
                        };
                        return textContent;
                    }
                });
                if (message.role === "user") {
                    const userMessage = {
                        role: "user",
                        content: contentParts,
                    };
                    return userMessage;
                }
                else {
                    const textOnlyParts = contentParts.map((part) => ({
                        type: "text",
                        text: part.type === "image" ? "[Image]" : part.text,
                    }));
                    const assistantMessage = {
                        role: "assistant",
                        content: textOnlyParts,
                    };
                    return assistantMessage;
                }
            }
            return {
                role: message.role,
                content: message.content,
            };
        });
        if (options.response_model) {
            const response = await generateObject({
                model: this.model,
                messages: formattedMessages,
                schema: options.response_model.schema,
            });
            return {
                data: response.object,
                usage: {
                    prompt_tokens: response.usage.promptTokens ?? 0,
                    completion_tokens: response.usage.completionTokens ?? 0,
                    total_tokens: response.usage.totalTokens ?? 0,
                },
            };
        }
        const tools = {};
        for (const rawTool of options.tools ?? []) {
            tools[rawTool.name] = {
                description: rawTool.description,
                parameters: rawTool.parameters,
            };
        }
        const response = await generateText({
            model: this.model,
            messages: formattedMessages,
            tools,
        });
        return {
            data: response.text,
            usage: {
                prompt_tokens: response.usage.promptTokens ?? 0,
                completion_tokens: response.usage.completionTokens ?? 0,
                total_tokens: response.usage.totalTokens ?? 0,
            },
        };
    }
}
