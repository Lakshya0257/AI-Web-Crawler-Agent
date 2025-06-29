import { generateObject, generateText, } from "ai";
import { LLMClient, } from "@browserbasehq/stagehand";
export class GoogleVertexStagehandClient extends LLMClient {
    type = "google-vertex";
    model;
    constructor({ model }) {
        super(model.modelId);
        this.model = model;
    }
    async createChatCompletion({ options, }) {
        // Convert Stagehand messages to Vercel AI format
        const formattedMessages = options.messages.map((message) => {
            if (Array.isArray(message.content)) {
                const contentParts = message.content.map((content) => {
                    if (content.type === "image_url") {
                        return {
                            type: "image",
                            image: content.image_url?.url ?? "",
                        };
                    }
                    else {
                        return {
                            type: "text",
                            text: content.text ?? content.content ?? "",
                        };
                    }
                });
                return {
                    role: message.role,
                    content: contentParts,
                };
            }
            return {
                role: message.role,
                content: message.content,
            };
        });
        try {
            if (options.response_model) {
                // Use generateObject for structured responses
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
            // Use generateText for regular responses
            const response = await generateText({
                model: this.model,
                messages: formattedMessages,
                tools: options.tools ? this.convertTools(options.tools) : undefined,
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
        catch (error) {
            console.error("Google Vertex API error:", error);
            throw error;
        }
    }
    convertTools(tools) {
        const convertedTools = {};
        for (const tool of tools) {
            convertedTools[tool.name] = {
                description: tool.description,
                parameters: tool.parameters,
            };
        }
        return convertedTools;
    }
}
