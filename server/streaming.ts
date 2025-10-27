import OpenAI from "openai";
import { ENV } from "./_core/env";
import type { RetrievedChunk } from "./retrieval";

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const MAX_PROMPT_TOKENS = 2800;

export type Citation = {
  page_start: number;
  page_end: number;
  chunk_no: number;
};

/**
 * Build prompt with token budget enforcement
 */
export function buildPrompt(
  systemPrompt: string,
  pdfContext: {
    fileName: string;
    moduleName?: string;
  },
  threadSummary: string,
  userMessage: string,
  retrievedChunks: RetrievedChunk[]
): { messages: OpenAI.Chat.ChatCompletionMessageParam[]; citations: Citation[] } {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  
  // Estimate tokens (rough: 1 token ≈ 4 chars)
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);
  
  // System message with instructions
  const baseSystemPrompt = systemPrompt || 
    "You are a study assistant. Answer concisely in British English using only the provided document context. Always cite page numbers in your answers.";
  
  const contextInfo = `\n\nDocument: ${pdfContext.fileName}${pdfContext.moduleName ? ` (${pdfContext.moduleName})` : ""}`;
  
  const fullSystemPrompt = baseSystemPrompt + contextInfo;
  
  let tokensUsed = estimateTokens(fullSystemPrompt) + estimateTokens(userMessage);
  
  messages.push({
    role: "system",
    content: fullSystemPrompt,
  });
  
  // Add thread summary if it fits
  if (threadSummary && threadSummary.length > 0) {
    const summaryTokens = estimateTokens(threadSummary);
    if (tokensUsed + summaryTokens < MAX_PROMPT_TOKENS - 500) {
      tokensUsed += summaryTokens;
    } else {
      // Truncate summary
      const allowedChars = (MAX_PROMPT_TOKENS - tokensUsed - 500) * 4;
      threadSummary = threadSummary.substring(0, allowedChars) + "...";
      tokensUsed += estimateTokens(threadSummary);
    }
  }
  
  // Build context from retrieved chunks
  const citations: Citation[] = [];
  let contextText = "\n\n=== Relevant Document Sections ===\n\n";
  
  for (const chunk of retrievedChunks) {
    const chunkHeader = `[Pages ${chunk.page_start}-${chunk.page_end}]:\n`;
    const chunkText = chunkHeader + chunk.content + "\n\n";
    const chunkTokens = estimateTokens(chunkText);
    
    // Check if we have budget for this chunk
    if (tokensUsed + chunkTokens > MAX_PROMPT_TOKENS - 200) {
      break; // Stop adding context
    }
    
    contextText += chunkText;
    tokensUsed += chunkTokens;
    
    citations.push({
      page_start: chunk.page_start,
      page_end: chunk.page_end,
      chunk_no: chunk.chunk_no,
    });
  }
  
  if (citations.length === 0) {
    contextText = "\n\nNo relevant sections found in the document.\n";
  }
  
  // Add context as a system message
  messages.push({
    role: "system",
    content: contextText,
  });
  
  // Add thread summary if exists
  if (threadSummary && threadSummary.length > 0) {
    messages.push({
      role: "system",
      content: `Previous conversation:\n${threadSummary}`,
    });
  }
  
  // Add user message
  messages.push({
    role: "user",
    content: userMessage,
  });
  
  console.log(`[Prompt] Built prompt with ${messages.length} messages, ~${tokensUsed} tokens, ${citations.length} citations`);
  
  return { messages, citations };
}

/**
 * Stream chat response from OpenAI
 */
export async function* streamChatResponse(
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
): AsyncGenerator<string, void, unknown> {
  if (!ENV.openaiApiKey) {
    throw new Error("OpenAI API key not configured");
  }
  
  const openai = new OpenAI({ apiKey: ENV.openaiApiKey });
  
  const stream = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages,
    temperature: 0.2,
    stream: true,
  });
  
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) {
      yield content;
    }
  }
}

/**
 * Stream complete response with timing
 */
export async function* streamResponse(
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
): AsyncGenerator<{ type: "token" | "timing"; content?: string; timing?: any }, void, unknown> {
  const startTime = Date.now();
  let firstTokenTime: number | null = null;
  let tokenCount = 0;
  
  for await (const token of streamChatResponse(messages)) {
    if (firstTokenTime === null) {
      firstTokenTime = Date.now();
      yield {
        type: "timing",
        timing: { firstTokenMs: firstTokenTime - startTime },
      };
    }
    
    tokenCount++;
    yield { type: "token", content: token };
  }
  
  yield {
    type: "timing",
    timing: {
      totalMs: Date.now() - startTime,
      firstTokenMs: firstTokenTime ? firstTokenTime - startTime : 0,
      tokenCount,
    },
  };
}

