import OpenAI from "openai";
import { ENV } from "./_core/env";
import { loadIndex, type PdfChunk } from "./indexing";

const RETRIEVAL_TOP_K = parseInt(process.env.RETRIEVAL_TOP_K || "8");
const MMR_LAMBDA = parseFloat(process.env.MMR_LAMBDA || "0.3");
const MAX_CONTEXT_TOKENS = parseInt(process.env.MAX_CONTEXT_TOKENS || "1600");
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large";
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

export type RetrievedChunk = PdfChunk & {
  similarity: number;
};

/**
 * Expand query using GPT to generate paraphrases
 */
export async function expandQuery(query: string): Promise<string[]> {
  if (!ENV.openaiApiKey) {
    return [query];
  }
  
  const openai = new OpenAI({ apiKey: ENV.openaiApiKey });
  
  try {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: "system",
          content: "Generate 2 alternative phrasings of the user's question. Return only the alternatives, one per line.",
        },
        {
          role: "user",
          content: query,
        },
      ],
      temperature: 0.3,
      max_tokens: 150,
    });
    
    const alternatives = response.choices[0].message.content
      ?.split("\n")
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.length < 500) || [];
    
    return [query, ...alternatives.slice(0, 2)];
  } catch (error) {
    console.error("[Retrieval] Error expanding query:", error);
    return [query];
  }
}

/**
 * Generate embeddings for multiple queries
 */
export async function embedQueries(queries: string[]): Promise<number[][]> {
  if (!ENV.openaiApiKey) {
    throw new Error("OpenAI API key not configured");
  }
  
  const openai = new OpenAI({ apiKey: ENV.openaiApiKey });
  
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: queries,
  });
  
  return response.data.map(d => d.embedding);
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }
  
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }
  
  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);
  
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Check if a chunk likely contains a definition
 */
export function hasDefinitionIndicators(text: string): boolean {
  const definitionPatterns = [
    /\bis defined as\b/i,
    /\brefers to\b/i,
    /\bmeans that\b/i,
    /\bis a\b/i,
    /\bis an\b/i,
    /\bdefin(e|ition|ed)\b/i,
    /\bcharacterized by\b/i,
    /\bcan be described as\b/i,
    /\bessentially\b/i,
    /\bin other words\b/i,
    /^[A-Z][a-z]+:?\s/m, // Starts with capitalized word (likely a term)
  ];
  
  return definitionPatterns.some(pattern => pattern.test(text));
}

/**
 * Calculate priority boost for a chunk
 * Boosts chunks that likely contain definitions or key concepts
 */
function calculatePriorityBoost(chunk: PdfChunk, totalChunks: number): number {
  let boost = 0;
  
  // 1. Early position boost (definitions often appear early in slides)
  // Boost decreases linearly from 0.15 (first chunk) to 0 (last chunk)
  const positionBoost = 0.15 * (1 - chunk.chunk_no / totalChunks);
  boost += positionBoost;
  
  // 2. Definition indicator boost
  if (hasDefinitionIndicators(chunk.content)) {
    boost += 0.10;
  }
  
  // 3. Short chunk boost (definitions tend to be concise)
  // Boost chunks between 50-200 tokens (typical definition length)
  if (chunk.tokens >= 50 && chunk.tokens <= 200) {
    boost += 0.05;
  }
  
  return boost;
}

/**
 * Maximal Marginal Relevance (MMR) diversified search
 * Balances relevance with diversity to avoid redundant results
 * Now with slide prioritization for definitions
 */
export function mmrSearch(
  queryEmbeds: number[][],
  chunks: PdfChunk[],
  k: number = RETRIEVAL_TOP_K,
  lambda: number = MMR_LAMBDA
): RetrievedChunk[] {
  if (chunks.length === 0 || !chunks[0].embedding) {
    return [];
  }
  
  // Calculate average query embedding
  const avgQueryEmbed = new Array(queryEmbeds[0].length).fill(0);
  for (const embed of queryEmbeds) {
    for (let i = 0; i < embed.length; i++) {
      avgQueryEmbed[i] += embed[i] / queryEmbeds.length;
    }
  }
  
  const totalChunks = chunks.length;
  
  // Calculate similarities for all chunks with priority boosting
  const candidates = chunks.map(chunk => {
    const baseSimilarity = cosineSimilarity(avgQueryEmbed, chunk.embedding!);
    const priorityBoost = calculatePriorityBoost(chunk, totalChunks);
    
    return {
      ...chunk,
      similarity: Math.min(1.0, baseSimilarity + priorityBoost), // Cap at 1.0
    };
  });
  
  // Sort by boosted similarity
  candidates.sort((a, b) => b.similarity - a.similarity);
  
  // MMR selection
  const selected: RetrievedChunk[] = [];
  const remaining = [...candidates];
  
  while (selected.length < k && remaining.length > 0) {
    if (selected.length === 0) {
      // First item: just pick the most similar
      selected.push(remaining.shift()!);
    } else {
      // Calculate MMR score for each remaining candidate
      let bestScore = -Infinity;
      let bestIndex = 0;
      
      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        
        // Relevance to query
        const relevance = candidate.similarity;
        
        // Max similarity to already selected items
        let maxSimilarity = 0;
        for (const selectedChunk of selected) {
          const sim = cosineSimilarity(candidate.embedding!, selectedChunk.embedding!);
          maxSimilarity = Math.max(maxSimilarity, sim);
        }
        
        // MMR score: balance relevance vs diversity
        const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity;
        
        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIndex = i;
        }
      }
      
      selected.push(remaining.splice(bestIndex, 1)[0]);
    }
  }
  
  return selected;
}

/**
 * Compress context to fit within token budget
 * Prioritizes higher-ranked chunks
 */
export function compressContext(
  chunks: RetrievedChunk[],
  maxTokens: number = MAX_CONTEXT_TOKENS
): RetrievedChunk[] {
  const compressed: RetrievedChunk[] = [];
  let totalTokens = 0;
  
  for (const chunk of chunks) {
    if (totalTokens + chunk.tokens <= maxTokens) {
      compressed.push(chunk);
      totalTokens += chunk.tokens;
    } else {
      // Try to fit a partial chunk if space remains
      const remainingTokens = maxTokens - totalTokens;
      if (remainingTokens > 50) {
        // Truncate chunk content to fit
        const charLimit = Math.floor(remainingTokens * 4); // rough char estimate
        compressed.push({
          ...chunk,
          content: chunk.content.substring(0, charLimit) + "...",
          tokens: remainingTokens,
        });
      }
      break;
    }
  }
  
  return compressed;
}

/**
 * Main retrieval pipeline
 */
export async function retrieveContext(
  fileId: number,
  query: string
): Promise<{ chunks: RetrievedChunk[]; totalTokens: number; error?: string }> {
  try {
    console.log(`[Retrieval] Starting retrieval for file ${fileId}`);
    const startTime = Date.now();
    
    // Step 1: Load index
    const index = await loadIndex(fileId);
    if (!index || index.chunks.length === 0) {
      return {
        chunks: [],
        totalTokens: 0,
        error: "No index found or index is empty",
      };
    }
    
    console.log(`[Retrieval] Loaded index with ${index.chunks.length} chunks`);
    
    // Step 2: Expand query
    const expandStart = Date.now();
    const queries = await expandQuery(query);
    console.log(`[Retrieval] Query expansion: ${Date.now() - expandStart}ms`);
    console.log(`[Retrieval] Expanded to ${queries.length} variants`);
    
    // Step 3: Embed queries
    const embedStart = Date.now();
    const queryEmbeds = await embedQueries(queries);
    console.log(`[Retrieval] Query embedding: ${Date.now() - embedStart}ms`);
    
    // Step 4: MMR search with slide prioritization
    const searchStart = Date.now();
    const retrieved = mmrSearch(queryEmbeds, index.chunks, RETRIEVAL_TOP_K, MMR_LAMBDA);
    console.log(`[Retrieval] MMR search: ${Date.now() - searchStart}ms`);
    console.log(`[Retrieval] Retrieved ${retrieved.length} chunks`);
    
    // Log prioritization info
    const definitionChunks = retrieved.filter(c => hasDefinitionIndicators(c.content)).length;
    const avgPageNum = retrieved.reduce((sum, c) => sum + (c.page_start || 0), 0) / retrieved.length;
    console.log(`[Retrieval] Prioritization: ${definitionChunks} definition-like chunks, avg page ${avgPageNum.toFixed(1)}`);
    
    // Step 5: Compress context
    const compressStart = Date.now();
    const compressed = compressContext(retrieved, MAX_CONTEXT_TOKENS);
    const totalTokens = compressed.reduce((sum, c) => sum + c.tokens, 0);
    console.log(`[Retrieval] Context compression: ${Date.now() - compressStart}ms`);
    console.log(`[Retrieval] Final context: ${compressed.length} chunks, ${totalTokens} tokens`);
    
    console.log(`[Retrieval] Total retrieval time: ${Date.now() - startTime}ms`);
    
    return { chunks: compressed, totalTokens };
  } catch (error) {
    console.error("[Retrieval] Error during retrieval:", error);
    return {
      chunks: [],
      totalTokens: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

