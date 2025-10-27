import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import OpenAI from "openai";
import { ENV } from "./_core/env";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

const INDEXES_DIR = ".local-storage/indexes";
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "800");
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || "100");
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large";

export type PdfChunk = {
  chunk_no: number;
  page_start: number;
  page_end: number;
  content: string;
  tokens: number;
  preview: string; // First 100 chars for display
  embedding?: number[];
};

export type PdfIndex = {
  fileId: number;
  checksum: string;
  chunks: PdfChunk[];
  indexedAt: string;
  totalChunks: number;
};

/**
 * Extract text from PDF file, organized by page
 */
export async function extractPdfText(filePath: string): Promise<Map<number, string>> {
  const buffer = await fs.readFile(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDoc = await loadingTask.promise;
  
  const pageTexts = new Map<number, string>();
  
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => {
        const textItem = item as TextItem;
        return textItem.str || "";
      })
      .join(" ");
    pageTexts.set(i, pageText);
  }
  
  return pageTexts;
}

/**
 * Simple token estimator (rough approximation: 1 token ≈ 4 chars)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Chunk text with overlap, preserving page boundaries
 */
export function chunkText(
  pageTexts: Map<number, string>,
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP
): PdfChunk[] {
  const chunks: PdfChunk[] = [];
  let chunkNo = 0;
  let currentChunk = "";
  let currentTokens = 0;
  let chunkStartPage = 1;
  let currentPage = 1;
  
  const pages = Array.from(pageTexts.entries()).sort((a, b) => a[0] - b[0]);
  
  for (const [pageNum, pageText] of pages) {
    currentPage = pageNum;
    const words = pageText.split(/\s+/).filter(w => w.length > 0);
    
    for (const word of words) {
      const wordTokens = estimateTokens(word + " ");
      
      if (currentTokens + wordTokens > chunkSize && currentChunk.length > 0) {
        // Save current chunk
        chunks.push({
          chunk_no: chunkNo++,
          page_start: chunkStartPage,
          page_end: currentPage,
          content: currentChunk.trim(),
          tokens: currentTokens,
          preview: currentChunk.trim().substring(0, 100) + "...",
        });
        
        // Start new chunk with overlap
        const overlapWords = currentChunk.split(/\s+/).slice(-overlap);
        currentChunk = overlapWords.join(" ") + " " + word + " ";
        currentTokens = estimateTokens(currentChunk);
        chunkStartPage = currentPage;
      } else {
        currentChunk += word + " ";
        currentTokens += wordTokens;
      }
    }
  }
  
  // Save final chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      chunk_no: chunkNo++,
      page_start: chunkStartPage,
      page_end: currentPage,
      content: currentChunk.trim(),
      tokens: currentTokens,
      preview: currentChunk.trim().substring(0, 100) + "...",
    });
  }
  
  return chunks;
}

/**
 * Generate embeddings for chunks using OpenAI API
 */
export async function generateEmbeddings(chunks: PdfChunk[]): Promise<PdfChunk[]> {
  if (!ENV.openaiApiKey) {
    throw new Error("OpenAI API key not configured");
  }
  
  const openai = new OpenAI({ apiKey: ENV.openaiApiKey });
  
  // Process in batches of 100 to avoid rate limits
  const batchSize = 100;
  const chunksWithEmbeddings: PdfChunk[] = [];
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map(c => c.content);
    
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
    });
    
    for (let j = 0; j < batch.length; j++) {
      chunksWithEmbeddings.push({
        ...batch[j],
        embedding: response.data[j].embedding,
      });
    }
  }
  
  return chunksWithEmbeddings;
}

/**
 * Save index to disk
 */
export async function saveIndex(fileId: number, chunks: PdfChunk[], checksum: string): Promise<string> {
  // Ensure indexes directory exists
  await fs.mkdir(INDEXES_DIR, { recursive: true });
  
  const index: PdfIndex = {
    fileId,
    checksum,
    chunks,
    indexedAt: new Date().toISOString(),
    totalChunks: chunks.length,
  };
  
  const indexPath = path.join(INDEXES_DIR, `${fileId}.json`);
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
  
  return indexPath;
}

/**
 * Load index from disk
 */
export async function loadIndex(fileId: number): Promise<PdfIndex | null> {
  const indexPath = path.join(INDEXES_DIR, `${fileId}.json`);
  
  try {
    const data = await fs.readFile(indexPath, "utf-8");
    return JSON.parse(data) as PdfIndex;
  } catch (error) {
    return null;
  }
}

/**
 * Compute MD5 checksum of PDF content
 */
export function computeChecksum(buffer: Buffer): string {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

/**
 * Main indexing orchestrator
 */
export async function indexPdf(
  fileId: number,
  filePath: string,
  onProgress?: (progress: number) => void
): Promise<{ success: boolean; chunkCount: number; checksum: string; error?: string }> {
  try {
    console.log(`[Indexing] Starting indexing for file ${fileId}`);
    
    // Step 1: Compute checksum
    const buffer = await fs.readFile(filePath);
    const checksum = computeChecksum(buffer);
    
    onProgress?.(10);
    
    // Step 2: Extract text from PDF
    console.log(`[Indexing] Extracting text from PDF...`);
    const pageTexts = await extractPdfText(filePath);
    
    onProgress?.(30);
    
    // Step 3: Chunk the text
    console.log(`[Indexing] Chunking text (${pageTexts.size} pages)...`);
    const chunks = chunkText(pageTexts, CHUNK_SIZE, CHUNK_OVERLAP);
    console.log(`[Indexing] Created ${chunks.length} chunks`);
    
    onProgress?.(50);
    
    // Step 4: Generate embeddings
    console.log(`[Indexing] Generating embeddings...`);
    const chunksWithEmbeddings = await generateEmbeddings(chunks);
    
    onProgress?.(80);
    
    // Step 5: Save index
    console.log(`[Indexing] Saving index to disk...`);
    const indexPath = await saveIndex(fileId, chunksWithEmbeddings, checksum);
    console.log(`[Indexing] Index saved to ${indexPath}`);
    
    onProgress?.(100);
    
    return {
      success: true,
      chunkCount: chunks.length,
      checksum,
    };
  } catch (error) {
    console.error(`[Indexing] Error indexing file ${fileId}:`, error);
    return {
      success: false,
      chunkCount: 0,
      checksum: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if file needs re-indexing
 */
export async function needsReindex(fileId: number, currentChecksum: string): Promise<boolean> {
  const existingIndex = await loadIndex(fileId);
  if (!existingIndex) return true;
  return existingIndex.checksum !== currentChecksum;
}

