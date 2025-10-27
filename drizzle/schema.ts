import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Modules table for organizing lecture slides by subject
 */
export const modules = mysqlTable("modules", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  color: varchar("color", { length: 7 }).default("#3b82f6").notNull(), // hex color for UI
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Module = typeof modules.$inferSelect;
export type InsertModule = typeof modules.$inferInsert;

/**
 * PDF files table for storing lecture slides
 */
export const pdfFiles = mysqlTable("pdfFiles", {
  id: int("id").autoincrement().primaryKey(),
  moduleId: int("moduleId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 512 }).notNull(), // S3 key
  fileUrl: text("fileUrl").notNull(), // S3 URL
  fileSize: int("fileSize").notNull(), // in bytes
  annotations: text("annotations"), // JSON string for highlights and pen strokes
  extractedText: text("extractedText"), // Cached PDF text for RAG
  contentChecksum: varchar("contentChecksum", { length: 32 }), // MD5 checksum for change detection
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PdfFile = typeof pdfFiles.$inferSelect;
export type InsertPdfFile = typeof pdfFiles.$inferInsert;

/**
 * PDF indexes table for tracking vector embedding status
 */
export const pdfIndexes = mysqlTable("pdfIndexes", {
  id: int("id").autoincrement().primaryKey(),
  fileId: int("fileId").notNull().unique(),
  status: mysqlEnum("status", ["PENDING", "INDEXING", "READY", "ERROR"]).default("PENDING").notNull(),
  chunkCount: int("chunkCount").default(0),
  checksum: varchar("checksum", { length: 32 }),
  indexPath: varchar("indexPath", { length: 512 }), // Path to index.json file
  errorMessage: text("errorMessage"),
  progress: int("progress").default(0), // Percentage 0-100
  indexedAt: timestamp("indexedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PdfIndex = typeof pdfIndexes.$inferSelect;
export type InsertPdfIndex = typeof pdfIndexes.$inferInsert;

/**
 * Chat threads table - one thread per PDF file
 */
export const pdfThreads = mysqlTable("pdfThreads", {
  id: int("id").autoincrement().primaryKey(),
  threadId: varchar("threadId", { length: 36 }).notNull().unique(), // UUID
  fileId: int("fileId").notNull(),
  title: varchar("title", { length: 255 }), // Optional thread title
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PdfThread = typeof pdfThreads.$inferSelect;
export type InsertPdfThread = typeof pdfThreads.$inferInsert;

/**
 * Chat messages table - stores conversation history
 */
export const pdfMessages = mysqlTable("pdfMessages", {
  id: int("id").autoincrement().primaryKey(),
  threadId: varchar("threadId", { length: 36 }).notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content").notNull(),
  tokenCount: int("tokenCount").default(0),
  citations: text("citations"), // JSON array of {page_start, page_end, chunk_no}
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PdfMessage = typeof pdfMessages.$inferSelect;
export type InsertPdfMessage = typeof pdfMessages.$inferInsert;