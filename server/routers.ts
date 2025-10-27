import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";


export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  modules: router({
    list: publicProcedure.query(async () => {
      const { getAllModules } = await import("./db");
      return await getAllModules();
    }),
    create: publicProcedure
      .input(z.object({ name: z.string(), color: z.string().optional() }))
      .mutation(async ({ input }) => {
        const { createModule } = await import("./db");
        await createModule(input);
        return { success: true };
      }),
    update: publicProcedure
      .input(z.object({ id: z.number(), name: z.string() }))
      .mutation(async ({ input }) => {
        const { updateModule } = await import("./db");
        await updateModule(input.id, { name: input.name });
        return { success: true };
      }),
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { deleteModule } = await import("./db");
        await deleteModule(input.id);
        return { success: true };
      }),
  }),

  indexes: router({
    triggerIndex: publicProcedure
      .input(z.object({ fileId: z.number() }))
      .mutation(async ({ input }) => {
        const { getIndexByFileId, createOrUpdateIndex, getPdfFileById } = await import("./db");
        const { getLocalFilePath } = await import("./storage");
        const { indexPdf, computeChecksum, needsReindex } = await import("./indexing");
        const { promises: fs } = await import("fs");
        
        const file = await getPdfFileById(input.fileId);
        if (!file) {
          throw new Error("PDF file not found");
        }
        
        // Get local file path
        const localPath = await getLocalFilePath(file.fileKey);
        if (!localPath) {
          throw new Error("PDF file not found on disk");
        }
        
        // Check if file has changed
        const existingIndex = await getIndexByFileId(input.fileId);
        if (existingIndex && existingIndex.status === "READY") {
          const buffer = await fs.readFile(localPath);
          const currentChecksum = computeChecksum(buffer);
          
          if (existingIndex.checksum === currentChecksum) {
            console.log(`[Indexing] File ${input.fileId} unchanged, skipping re-index`);
            return { success: true, message: "File already indexed" };
          } else {
            console.log(`[Indexing] File ${input.fileId} changed, triggering re-index`);
          }
        }
        
        // Set status to INDEXING
        await createOrUpdateIndex({
          fileId: input.fileId,
          status: "INDEXING",
          progress: 0,
        });
        
        // Run indexing in background
        (async () => {
          try {
            const result = await indexPdf(input.fileId, localPath, async (progress) => {
              try {
                await createOrUpdateIndex({
                  fileId: input.fileId,
                  status: "INDEXING",
                  progress,
                });
              } catch (progressErr) {
                console.error(`[Indexing] Failed to update progress for file ${input.fileId}:`, progressErr);
              }
            });
            
            if (result.success) {
              await createOrUpdateIndex({
                fileId: input.fileId,
                status: "READY",
                progress: 100,
                chunkCount: result.chunkCount,
                checksum: result.checksum,
                indexPath: `.local-storage/indexes/${input.fileId}.json`,
                indexedAt: new Date(),
              });
              console.log(`[Indexing] Successfully indexed file ${input.fileId} - Status set to READY`);
            } else {
              await createOrUpdateIndex({
                fileId: input.fileId,
                status: "ERROR",
                errorMessage: result.error,
              });
              console.error(`[Indexing] Failed to index file ${input.fileId}:`, result.error);
            }
          } catch (err) {
            console.error(`[Indexing] Unhandled error for file ${input.fileId}:`, err);
            try {
              await createOrUpdateIndex({
                fileId: input.fileId,
                status: "ERROR",
                errorMessage: err instanceof Error ? err.message : String(err),
              });
            } catch (updateErr) {
              console.error(`[Indexing] Failed to update error status:`, updateErr);
            }
          }
        })();
        
        return { success: true };
      }),
    getStatus: publicProcedure
      .input(z.object({ fileId: z.number() }))
      .query(async ({ input }) => {
        const { getIndexByFileId } = await import("./db");
        const index = await getIndexByFileId(input.fileId);
        return index || {
          status: "PENDING",
          progress: 0,
          chunkCount: 0,
        };
      }),
  }),

  chat: router({
    startOrResume: publicProcedure
      .input(z.object({ fileId: z.number() }))
      .query(async ({ input }) => {
        const { getOrCreateThread } = await import("./db");
        const threadId = await getOrCreateThread(input.fileId);
        return { threadId };
      }),
    getHistory: publicProcedure
      .input(z.object({ threadId: z.string() }))
      .query(async ({ input }) => {
        const { getThreadMessages } = await import("./db");
        const messages = await getThreadMessages(input.threadId);
        return { messages };
      }),
    sendMessage: publicProcedure
      .input(z.object({
        fileId: z.number(),
        messages: z.array(z.object({
          role: z.enum(["user", "assistant", "system"]),
          content: z.string(),
        })),
        systemPrompt: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { getPdfFileById } = await import("./db");
        const { chatWithPDF } = await import("./openai");
        const { getDb } = await import("./db");
        const { pdfFiles } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        
        const file = await getPdfFileById(input.fileId);
        if (!file) {
          throw new Error("PDF file not found");
        }
        
        let pdfText = file.extractedText;
        
        // If text not cached, extract and cache it
        if (!pdfText) {
          const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
          const { promises: fs } = await import("fs");
          
          let arrayBuffer: ArrayBuffer;
          
          // Handle local storage files vs remote URLs
          if (file.fileUrl.startsWith('/storage/')) {
            // Local storage - read from filesystem
            const { getLocalFilePath } = await import("./storage");
            const localPath = await getLocalFilePath(file.fileKey);
            if (!localPath) {
              throw new Error(`PDF file not found at ${file.fileKey}`);
            }
            const buffer = await fs.readFile(localPath);
            arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
          } else {
            // Remote URL - fetch it
            const response = await fetch(file.fileUrl);
            if (!response.ok) {
              throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
            }
            arrayBuffer = await response.arrayBuffer();
          }
          
          const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
          const pdfDoc = await loadingTask.promise;
          
          let fullText = "";
          for (let i = 1; i <= pdfDoc.numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(" ");
            fullText += pageText + "\n";
          }
          
          pdfText = fullText;
          
          // Cache the extracted text
          const db = await getDb();
          if (db) {
            await db.update(pdfFiles)
              .set({ extractedText: fullText })
              .where(eq(pdfFiles.id, input.fileId));
          }
        }
        
        // Get AI response
        const assistantMessage = await chatWithPDF({
          messages: input.messages,
          pdfText,
          systemPrompt: input.systemPrompt,
        });
        
        return { message: assistantMessage };
      }),
  }),

  pdfFiles: router({
    listByModule: publicProcedure
      .input(z.object({ moduleId: z.number() }))
      .query(async ({ input }) => {
        const { getPdfFilesByModule } = await import("./db");
        return await getPdfFilesByModule(input.moduleId);
      }),
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const { getPdfFileById } = await import("./db");
        return await getPdfFileById(input.id);
      }),
    upload: publicProcedure
      .input(z.object({
        moduleId: z.number(),
        fileName: z.string(),
        fileData: z.string(), // base64 encoded PDF
      }))
      .mutation(async ({ input }) => {
        const { storagePut } = await import("./storage");
        const { createPdfFile } = await import("./db");
        const { computeChecksum } = await import("./indexing");
        
        // Decode base64 to buffer
        const buffer = Buffer.from(input.fileData, 'base64');
        const fileSize = buffer.length;
        
        // Compute checksum for change detection
        const checksum = computeChecksum(buffer);
        
        // Generate unique file key
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(7);
        const fileKey = `pdfs/${input.moduleId}/${timestamp}-${randomSuffix}.pdf`;
        
        // Upload to storage
        const { url } = await storagePut(fileKey, buffer, 'application/pdf');
        
        // Save to database with checksum
        await createPdfFile({
          moduleId: input.moduleId,
          fileName: input.fileName,
          fileKey,
          fileUrl: url,
          fileSize,
          contentChecksum: checksum,
        });
        
        return { success: true, url };
      }),
    updateAnnotations: publicProcedure
      .input(z.object({
        id: z.number(),
        annotations: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { updatePdfAnnotations } = await import("./db");
        await updatePdfAnnotations(input.id, input.annotations);
        return { success: true };
      }),
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { deletePdfFile } = await import("./db");
        await deletePdfFile(input.id);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
