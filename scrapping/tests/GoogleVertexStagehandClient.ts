import {
  CoreAssistantMessage,
  CoreMessage,
  CoreSystemMessage,
  CoreTool,
  CoreUserMessage,
  generateObject,
  generateText,
  ImagePart,
  LanguageModel,
  TextPart,
} from "ai";
import {
  CreateChatCompletionOptions,
  LLMClient,
  AvailableModel,
} from "@browserbasehq/stagehand";
import { vertex } from "@ai-sdk/google-vertex";

export class GoogleVertexStagehandClient extends LLMClient {
  public type = "google-vertex" as const;
  private model: LanguageModel;

  constructor({ model }: { model: LanguageModel }) {
    super(model.modelId as AvailableModel);
    this.model = model;
  }

  async createChatCompletion<T = any>({
    options,
  }: CreateChatCompletionOptions): Promise<T> {
    // Convert Stagehand messages to Vercel AI format
    const formattedMessages = options.messages.map((message: any) => {
      if (Array.isArray(message.content)) {
        const contentParts = message.content.map((content: any) => {
          if (content.type === "image_url") {
            return {
              type: "image",
              image: content.image_url?.url ?? "",
            };
          } else {
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
        } as T;
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
      } as T;
    } catch (error) {
      console.error("Google Vertex API error:", error);
      throw error;
    }
  }

  private convertTools(tools: any[]) {
    const convertedTools: Record<string, any> = {};
    
    for (const tool of tools) {
      convertedTools[tool.name] = {
        description: tool.description,
        parameters: tool.parameters,
      };
    }
    
    return convertedTools;
  }
} 