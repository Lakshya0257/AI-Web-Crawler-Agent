import { LanguageModel } from "ai";
import { CreateChatCompletionOptions, LLMClient } from "@browserbasehq/stagehand";
export declare class GoogleVertexStagehandClient extends LLMClient {
    type: "google-vertex";
    private model;
    constructor({ model }: {
        model: LanguageModel;
    });
    createChatCompletion<T = any>({ options, }: CreateChatCompletionOptions): Promise<T>;
    private convertTools;
}
