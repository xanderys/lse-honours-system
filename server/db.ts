import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, modules, InsertModule, pdfFiles, InsertPdfFile, pdfThreads, InsertPdfThread, pdfMessages, InsertPdfMessage, pdfIndexes, InsertPdfIndex } from "../drizzle/schema";
import { ENV } from './_core/env';
import { randomUUID } from "crypto";
import OpenAI from "openai";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Module queries
export async function getAllModules() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(modules);
}

export async function createModule(data: InsertModule) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(modules).values(data);
  return result;
}

export async function updateModule(id: number, data: Partial<InsertModule>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(modules).set(data).where(eq(modules.id, id));
}

export async function deleteModule(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete associated PDF files first
  await db.delete(pdfFiles).where(eq(pdfFiles.moduleId, id));
  await db.delete(modules).where(eq(modules.id, id));
}

// PDF file queries
export async function getPdfFilesByModule(moduleId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(pdfFiles).where(eq(pdfFiles.moduleId, moduleId));
}

export async function getPdfFileById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(pdfFiles).where(eq(pdfFiles.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createPdfFile(data: InsertPdfFile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(pdfFiles).values(data);
  return result;
}

export async function updatePdfAnnotations(id: number, annotations: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(pdfFiles).set({ annotations }).where(eq(pdfFiles.id, id));
}

export async function deletePdfFile(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(pdfFiles).where(eq(pdfFiles.id, id));
}

// PDF Index queries
export async function getIndexByFileId(fileId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(pdfIndexes).where(eq(pdfIndexes.fileId, fileId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createOrUpdateIndex(data: InsertPdfIndex) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const existing = await getIndexByFileId(data.fileId!);
  
  if (existing) {
    console.log(`[DB] Updating index for fileId ${data.fileId}, status: ${data.status}, progress: ${data.progress}`);
    await db.update(pdfIndexes).set(data).where(eq(pdfIndexes.fileId, data.fileId!));
    console.log(`[DB] Index updated successfully for fileId ${data.fileId}`);
  } else {
    console.log(`[DB] Creating new index for fileId ${data.fileId}`);
    await db.insert(pdfIndexes).values(data);
    console.log(`[DB] Index created successfully for fileId ${data.fileId}`);
  }
}

// Thread management
export async function getOrCreateThread(fileId: number): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Try to find existing thread for this file
  const existing = await db
    .select()
    .from(pdfThreads)
    .where(eq(pdfThreads.fileId, fileId))
    .orderBy(desc(pdfThreads.createdAt))
    .limit(1);
  
  if (existing.length > 0) {
    return existing[0].threadId;
  }
  
  // Create new thread
  const threadId = randomUUID();
  await db.insert(pdfThreads).values({
    threadId,
    fileId,
  });
  
  return threadId;
}

export async function getThreadMessages(threadId: string, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(pdfMessages)
    .where(eq(pdfMessages.threadId, threadId))
    .orderBy(pdfMessages.createdAt)
    .limit(limit);
}

export async function addMessage(data: InsertPdfMessage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(pdfMessages).values(data);
}

/**
 * Get thread summary - returns condensed version of old messages
 * Uses token count to determine when summarization is needed
 */
export async function getThreadSummary(threadId: string): Promise<string> {
  const db = await getDb();
  if (!db) return "";
  
  const messages = await getThreadMessages(threadId, 100);
  
  if (messages.length === 0) return "";
  
  // Calculate total tokens
  const totalTokens = messages.reduce((sum, msg) => sum + (msg.tokenCount || 0), 0);
  
  // If under threshold, return full history
  if (totalTokens < 2500) {
    return messages
      .map(m => `${m.role}: ${m.content}`)
      .join("\n");
  }
  
  // Need summarization
  const oldMessages = messages.slice(0, -10); // Keep last 10 messages verbatim
  const recentMessages = messages.slice(-10);
  
  const summary = await summarizeThread(oldMessages);
  const recent = recentMessages
    .map(m => `${m.role}: ${m.content}`)
    .join("\n");
  
  return `Previous conversation summary:\n${summary}\n\nRecent messages:\n${recent}`;
}

/**
 * Summarize old thread messages using GPT
 */
async function summarizeThread(messages: any[]): Promise<string> {
  if (messages.length === 0) return "";
  
  if (!ENV.openaiApiKey) {
    // Fallback: simple truncation
    return messages
      .slice(0, 5)
      .map(m => `${m.role}: ${m.content.substring(0, 100)}...`)
      .join("\n");
  }
  
  const openai = new OpenAI({ apiKey: ENV.openaiApiKey });
  
  const conversationText = messages
    .map(m => `${m.role}: ${m.content}`)
    .join("\n");
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Summarize this conversation history in 200-300 words, preserving key questions and answers. Focus on main topics and important details.",
        },
        {
          role: "user",
          content: conversationText,
        },
      ],
      temperature: 0.0,
      max_tokens: 500,
    });
    
    return response.choices[0].message.content || "";
  } catch (error) {
    console.error("[Thread] Error summarizing thread:", error);
    return conversationText.substring(0, 1000) + "...";
  }
}

/**
 * Estimate token count for a message (rough approximation)
 */
export function estimateMessageTokens(content: string): number {
  return Math.ceil(content.length / 4);
}
