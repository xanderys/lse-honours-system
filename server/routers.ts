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
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { deleteModule } = await import("./db");
        await deleteModule(input.id);
        return { success: true };
      }),
  }),

  chat: router({
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
        const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
        
        const file = await getPdfFileById(input.fileId);
        if (!file) {
          throw new Error("PDF file not found");
        }
        
        // Fetch PDF content from S3
        const response = await fetch(file.fileUrl);
        const arrayBuffer = await response.arrayBuffer();
        
        // Extract text from PDF using pdfjs
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdfDoc = await loadingTask.promise;
        
        let fullText = "";
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          const page = await pdfDoc.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map((item: any) => item.str).join(" ");
          fullText += pageText + "\n";
        }
        
        // Get AI response
        const assistantMessage = await chatWithPDF({
          messages: input.messages,
          pdfText: fullText,
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
        
        // Decode base64 to buffer
        const buffer = Buffer.from(input.fileData, 'base64');
        const fileSize = buffer.length;
        
        // Generate unique file key
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(7);
        const fileKey = `pdfs/${input.moduleId}/${timestamp}-${randomSuffix}.pdf`;
        
        // Upload to S3
        const { url } = await storagePut(fileKey, buffer, 'application/pdf');
        
        // Save to database
        await createPdfFile({
          moduleId: input.moduleId,
          fileName: input.fileName,
          fileKey,
          fileUrl: url,
          fileSize,
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
