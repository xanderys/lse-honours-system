import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, modules, InsertModule, pdfFiles, InsertPdfFile } from "../drizzle/schema";
import { ENV } from './_core/env';

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
