import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ArrowLeft, ZoomIn, ZoomOut, Highlighter, Pen, Send, Settings, X, Square, Eraser, Columns2, FileText, ScrollText, PanelRightOpen, GripVertical, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import * as pdfjsLib from "pdfjs-dist";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

type ViewMode = "continuous" | "single" | "double";

type Annotation = {
  id: string;
  type: "highlight" | "pen";
  pageNumber: number;
  data: any;
};

type Question = {
  id: string;
  text: string;
  timestamp: number;
};

type PageRenderInfo = {
  pageNumber: number;
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  viewport: any;
};

type Citation = {
  page_start: number;
  page_end: number;
  chunk_no: number;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  streaming?: boolean;
};

type IndexStatus = "PENDING" | "INDEXING" | "READY" | "ERROR";

export default function DeepFocus() {
  const { id } = useParams<{ id: string }>();
  const fileId = parseInt(id);
  const [, setLocation] = useLocation();

  const containerRef = useRef<HTMLDivElement>(null);
  const pagesContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const thumbnailSidebarRef = useRef<HTMLDivElement>(null);
  const hasRestoredScroll = useRef(false);
  const isZooming = useRef(false);
  const savedScrollRatio = useRef<number>(0);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(() => {
    try {
      const savedPage = localStorage.getItem(`pdf-page-${fileId}`);
      return savedPage ? parseInt(savedPage) : 1;
    } catch {
      return 1;
    }
  });
  const [totalPages, setTotalPages] = useState(0);
  
  // Load zoom from localStorage (per-PDF persistence)
  const [scale, setScale] = useState(() => {
    try {
      const savedZoom = localStorage.getItem(`pdf-zoom-${fileId}`);
      return savedZoom ? parseFloat(savedZoom) : 1.0;
    } catch {
      return 1.0;
    }
  });
  const [viewMode, setViewMode] = useState<ViewMode>("continuous");
  const [tool, setTool] = useState<"none" | "highlight" | "pen" | "eraser">("none");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [currentDrawing, setCurrentDrawing] = useState<any>(null);
  const [renderedPages, setRenderedPages] = useState<Map<number, PageRenderInfo>>(new Map());
  const [erasedIds, setErasedIds] = useState<Set<string>>(new Set());
  
  // Resizable layout state
  const [sidebarWidth, setSidebarWidth] = useState(33.33); // percentage
  const [questionsHeight, setQuestionsHeight] = useState(50); // percentage of sidebar height
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isResizingHorizontal, setIsResizingHorizontal] = useState(false);
  const [isResizingVertical, setIsResizingVertical] = useState(false);
  
  // Drag and drop state
  const [draggedQuestion, setDraggedQuestion] = useState<Question | null>(null);
  const [isDragOverChat, setIsDragOverChat] = useState(false);
  
  // Thumbnail sidebar state with localStorage persistence (per-PDF)
  const [showThumbnails, setShowThumbnails] = useState(() => {
    try {
      const saved = localStorage.getItem(`pdf-thumbnails-visible-${fileId}`);
      return saved !== null ? JSON.parse(saved) : true; // Default to true (open)
    } catch {
      return true;
    }
  });
  const [thumbnails, setThumbnails] = useState<Map<number, string>>(new Map());
  const [thumbnailWidth, setThumbnailWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(`pdf-thumbnail-width-${fileId}`);
      return saved ? parseFloat(saved) : 20; // Default 20%
    } catch {
      return 20;
    }
  });
  const [isResizingThumbnail, setIsResizingThumbnail] = useState(false);
  const [selectedThumbnail, setSelectedThumbnail] = useState<number | null>(null);
  
  // Zoom control state
  const [showZoomDropdown, setShowZoomDropdown] = useState(false);
  const [targetScale, setTargetScale] = useState(scale);
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState("");
  const zoomPresets = [50, 75, 100, 125, 150, 200, 300];
  
  // Page navigation state
  const [isEditingPage, setIsEditingPage] = useState(false);
  const [pageInputValue, setPageInputValue] = useState("");
  
  const MIN_SIDEBAR_WIDTH = 20; // 20% minimum
  const COLLAPSE_THRESHOLD = 15; // collapse if dragged below 15%
  const MIN_PDF_WIDTH = 40; // 40% minimum for PDF viewer
  const MIN_SECTION_HEIGHT = 20; // 20% minimum for questions/chat sections
  const MIN_THUMBNAIL_WIDTH = 15; // 15% minimum for thumbnail sidebar
  const THUMBNAIL_COLLAPSE_THRESHOLD = 10; // collapse if dragged below 10%
  const MAX_THUMBNAIL_WIDTH = 40; // 40% maximum
  
  const [questionInput, setQuestionInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  
  // Load questions from localStorage (per-PDF persistence)
  const [questions, setQuestions] = useState<Question[]>(() => {
    try {
      const saved = localStorage.getItem(`pdf-questions-${fileId}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  
  // Chat messages from server
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(`pdf-thread-${fileId}`) || null;
    } catch {
      return null;
    }
  });
  
  // Indexing status
  const [indexStatus, setIndexStatus] = useState<IndexStatus>("PENDING");
  const [indexProgress, setIndexProgress] = useState(0);
  
  // Load system prompt from localStorage (universal across all PDFs)
  const DEFAULT_SYSTEM_PROMPT = "You are a study assistant. Answer concisely in British English using only the provided document context. Always cite page numbers in your answers.";
  const [systemPrompt, setSystemPrompt] = useState(() => {
    try {
      const saved = localStorage.getItem('studyAssistantSystemPrompt');
      return saved || DEFAULT_SYSTEM_PROMPT;
    } catch {
      return DEFAULT_SYSTEM_PROMPT;
    }
  });

  const utils = trpc.useUtils();
  const { data: file } = trpc.pdfFiles.getById.useQuery({ id: fileId });

  const updateAnnotationsMutation = trpc.pdfFiles.updateAnnotations.useMutation({
    onSuccess: () => {
      console.log("Annotations saved successfully");
    },
    onError: (error) => {
      console.error("Failed to save annotations:", error);
      toast.error("Failed to save annotations");
    },
  });

  // Initialize thread and load chat history
  const { data: threadData } = trpc.chat.startOrResume.useQuery(
    { fileId },
    { enabled: !!fileId }
  );

  useEffect(() => {
    if (threadData?.threadId) {
      setThreadId(threadData.threadId);
      localStorage.setItem(`pdf-thread-${fileId}`, threadData.threadId);
    }
  }, [threadData, fileId]);

  const { data: historyData } = trpc.chat.getHistory.useQuery(
    { threadId: threadId! },
    { enabled: !!threadId }
  );

  useEffect(() => {
    if (historyData?.messages) {
      setChatMessages(historyData.messages.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        citations: m.citations ? JSON.parse(m.citations) : undefined,
      })));
    }
  }, [historyData]);

  // Check and trigger indexing
  const triggerIndexMutation = trpc.indexes.triggerIndex.useMutation();
  const { data: indexData, refetch: refetchIndexStatus } = trpc.indexes.getStatus.useQuery(
    { fileId },
    { 
      enabled: !!fileId, 
      refetchInterval: 2000, // Poll every 2s
    }
  );

  useEffect(() => {
    if (indexData) {
      setIndexStatus(indexData.status as IndexStatus);
      setIndexProgress(indexData.progress || 0);

      // Trigger indexing if PENDING
      if (indexData.status === "PENDING" && fileId) {
        triggerIndexMutation.mutate({ fileId });
      }
      
      // Stop polling once indexing is complete or failed
      if (indexData.status === "READY" || indexData.status === "ERROR") {
        // Polling will automatically stop due to refetchInterval logic below
      }
    }
  }, [indexData, fileId]);

  // Dynamically control polling
  useEffect(() => {
    // This effect ensures we stop unnecessary polling
    if (indexStatus === "READY" || indexStatus === "ERROR") {
      // The refetchInterval will continue but we just ignore the results
      // In a production app, you might want to use a state-based refetchInterval
    }
  }, [indexStatus]);

  // Reset scroll restoration flag when file changes
  useEffect(() => {
    hasRestoredScroll.current = false;
  }, [fileId]);

  // Load PDF
  useEffect(() => {
    if (!file?.fileUrl) return;

    const loadPdf = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(file.fileUrl);
        const pdf = await loadingTask.promise;
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);

        // Load saved annotations
        if (file.annotations) {
          try {
            const parsed = JSON.parse(file.annotations);
            setAnnotations(parsed.map((a: any) => ({
              ...a,
              id: a.id || `${a.type}-${a.pageNumber}-${Math.random()}`
            })));
          } catch (e) {
            console.error("Failed to parse annotations", e);
          }
        }
      } catch (error) {
        console.error("Error loading PDF:", error);
        toast.error("Failed to load PDF");
      }
    };

    loadPdf();
  }, [file]);

  // Render pages based on view mode
  useEffect(() => {
    if (!pdfDoc || !pagesContainerRef.current) return;

    let isCancelled = false;

    const renderPages = async () => {
      const container = pagesContainerRef.current!;
      container.innerHTML = ""; // Clear previous renders
      
      const newRenderedPages = new Map<number, PageRenderInfo>();
      
      let pagesToRender: number[] = [];
      
      if (viewMode === "continuous") {
        // Render all pages
        pagesToRender = Array.from({ length: totalPages }, (_, i) => i + 1);
      } else if (viewMode === "single") {
        // Render only current page
        pagesToRender = [currentPage];
      } else if (viewMode === "double") {
        // Render current page and next page
        pagesToRender = [currentPage];
        if (currentPage < totalPages) {
          pagesToRender.push(currentPage + 1);
        }
      }

      // Fetch all pages first to ensure they're loaded
      const pagePromises = pagesToRender.map(pageNum => pdfDoc.getPage(pageNum));
      const pages = await Promise.all(pagePromises);

      if (isCancelled) return;

      // Create all page structures synchronously
      const pageElements: Array<{
        pageNum: number;
        page: any;
        viewport: any;
        container: HTMLDivElement;
        canvas: HTMLCanvasElement;
        textLayerDiv: HTMLDivElement;
        annotationCanvas: HTMLCanvasElement;
      }> = [];

      pages.forEach((page, idx) => {
        const pageNum = pagesToRender[idx];
      const viewport = page.getViewport({ scale });

        // Create page container
        const pageContainer = document.createElement("div");
        pageContainer.className = "pdf-page-container relative mb-4";
        pageContainer.style.width = `${viewport.width}px`;
        pageContainer.style.margin = viewMode === "double" ? "0 10px" : "0 auto";
        pageContainer.style.display = viewMode === "double" ? "inline-block" : "block";

        // Create canvas
        const canvas = document.createElement("canvas");
        canvas.className = "pdf-canvas shadow-lg bg-white";
      canvas.height = viewport.height;
      canvas.width = viewport.width;
        canvas.dataset.pageNumber = pageNum.toString();

        // Create text layer for text selection
        const textLayerDiv = document.createElement("div");
        textLayerDiv.className = "pdf-text-layer";
        textLayerDiv.style.cssText = `
          position: absolute;
          left: 0;
          top: 0;
          right: 0;
          bottom: 0;
          overflow: hidden;
          opacity: 0.2;
          line-height: 1.0;
          pointer-events: auto;
        `;

        // Create annotation overlay canvas
        const annotationCanvas = document.createElement("canvas");
        const toolClass = tool === "pen" ? "tool-pen" : tool === "eraser" ? "tool-eraser" : "tool-none";
        annotationCanvas.className = `pdf-annotation-layer ${toolClass}`;
        annotationCanvas.style.cssText = `
          position: absolute;
          left: 0;
          top: 0;
        `;
        annotationCanvas.height = viewport.height;
        annotationCanvas.width = viewport.width;
        annotationCanvas.dataset.pageNumber = pageNum.toString();

        pageContainer.appendChild(canvas);
        pageContainer.appendChild(textLayerDiv);
        pageContainer.appendChild(annotationCanvas);
        container.appendChild(pageContainer);

        pageElements.push({
          pageNum,
          page,
          viewport,
          container: pageContainer,
          canvas,
          textLayerDiv,
          annotationCanvas,
        });

        newRenderedPages.set(pageNum, {
          pageNumber: pageNum,
          canvas: annotationCanvas,
          textLayer: textLayerDiv,
          viewport,
        });
      });

      // Update state immediately with all pages
      setRenderedPages(newRenderedPages);

      if (isCancelled) return;

      // Now render all pages (PDF content and text layers) in parallel
      await Promise.all(
        pageElements.map(async ({ page, viewport, canvas, textLayerDiv }) => {
          if (isCancelled) return;
          
          // Render PDF content
      const context = canvas.getContext("2d")!;
          try {
            await page.render({ canvasContext: context, viewport }).promise;
          } catch (error) {
            // Ignore cancellation errors
            if (!isCancelled) {
              console.error("Error rendering page:", error);
            }
          }

          if (isCancelled) return;

          // Render text layer
          try {
            const textContent = await page.getTextContent();
            textContent.items.forEach((item: any) => {
              const textItem = item as TextItem;
              if (!textItem.str) return;

              const div = document.createElement("div");
              const tx = pdfjsLib.Util.transform(
                viewport.transform,
                textItem.transform
              );
              const fontSize = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
              
              div.style.cssText = `
                position: absolute;
                left: ${tx[4]}px;
                top: ${tx[5] - fontSize}px;
                font-size: ${fontSize}px;
                font-family: sans-serif;
                transform-origin: 0% 0%;
                white-space: pre;
                cursor: text;
              `;
              div.textContent = textItem.str;
              textLayerDiv.appendChild(div);
            });
          } catch (error) {
            if (!isCancelled) {
              console.error("Error rendering text layer:", error);
            }
          }
        })
      );
    };

    renderPages();

    return () => {
      isCancelled = true;
    };
  }, [pdfDoc, scale, viewMode, currentPage, totalPages]);

  // Generate thumbnails for all pages
  useEffect(() => {
    if (!pdfDoc || totalPages === 0) return;

    const generateThumbnails = async () => {
      const newThumbnails = new Map<number, string>();
      const THUMBNAIL_SCALE = 0.3; // Smaller scale for thumbnails

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        try {
          const page = await pdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: THUMBNAIL_SCALE });

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

          if (context) {
            await page.render({
        canvasContext: context,
        viewport: viewport,
            }).promise;

            newThumbnails.set(pageNum, canvas.toDataURL());
          }
        } catch (error) {
          console.error(`Error generating thumbnail for page ${pageNum}:`, error);
        }
      }

      setThumbnails(newThumbnails);
    };

    generateThumbnails();
  }, [pdfDoc, totalPages]);

  // Restore scroll position after zoom re-render completes (centered on viewport)
  useEffect(() => {
    if (!scrollContainerRef.current || !pagesContainerRef.current || viewMode !== "continuous") return;
    if (!isZooming.current || savedScrollRatio.current === 0) return;
    
    // Wait for pages to finish rendering
    const timer = setTimeout(() => {
      const scrollContainer = scrollContainerRef.current;
      const pagesContainer = pagesContainerRef.current;
      if (!scrollContainer || !pagesContainer) return;
      
      const pageElements = pagesContainer.querySelectorAll(".pdf-page-container");
      if (pageElements.length === 0) return;
      
      const currentPageElement = pageElements[currentPage - 1] as HTMLElement;
      if (currentPageElement) {
        const newPageHeight = currentPageElement.offsetHeight;
        const newPageTop = currentPageElement.offsetTop;
        
        // Calculate the new position of the saved point
        const newCenterPosition = newPageTop + (savedScrollRatio.current * newPageHeight);
        
        // Scroll so that point is at the center of the viewport
        const viewportHalfHeight = scrollContainer.clientHeight / 2;
        scrollContainer.scrollTop = newCenterPosition - viewportHalfHeight;
      }
      
      // Clear saved ratio
      savedScrollRatio.current = 0;
    }, 150);
    
    return () => clearTimeout(timer);
  }, [renderedPages, currentPage, viewMode]); // Trigger after pages render

  // Restore scroll position after rendering (only once on initial load)
  useEffect(() => {
    if (!pagesContainerRef.current || !scrollContainerRef.current || renderedPages.size === 0) return;
    if (hasRestoredScroll.current) return; // Only restore once
    
    // Small delay to ensure rendering is complete
    const timer = setTimeout(() => {
      if (viewMode === "continuous" && currentPage > 1) {
        const pageElements = pagesContainerRef.current!.querySelectorAll(".pdf-page-container");
        const targetPage = pageElements[currentPage - 1];
        if (targetPage) {
          targetPage.scrollIntoView({ block: "start", behavior: "auto" });
          hasRestoredScroll.current = true; // Mark as restored
        }
      } else {
        hasRestoredScroll.current = true; // Mark as restored even if no scroll needed
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, [renderedPages, viewMode]); // Removed currentPage to prevent re-trigger

  // Track current page in continuous mode based on scroll position
  useEffect(() => {
    if (viewMode !== "continuous" || !scrollContainerRef.current || !pagesContainerRef.current) return;

    let scrollTimeout: NodeJS.Timeout | null = null;

    const handleScroll = () => {
      // Don't track scroll during zoom operations
      if (isZooming.current) return;
      
      // Throttle scroll events for performance
      if (scrollTimeout) return;
      
      scrollTimeout = setTimeout(() => {
        scrollTimeout = null;
        
        const scrollContainer = scrollContainerRef.current;
        const pagesContainer = pagesContainerRef.current;
        if (!scrollContainer || !pagesContainer) return;

        const pageElements = pagesContainer.querySelectorAll(".pdf-page-container");
        const scrollContainerRect = scrollContainer.getBoundingClientRect();
        const scrollContainerTop = scrollContainerRect.top;
        const scrollContainerCenter = scrollContainerTop + scrollContainerRect.height / 2;

        // Find which page is closest to the center of the viewport
        let closestPage = 1;
        let minDistance = Infinity;

        pageElements.forEach((element, index) => {
          const rect = element.getBoundingClientRect();
          const pageCenter = rect.top + rect.height / 2;
          const distance = Math.abs(pageCenter - scrollContainerCenter);

          if (distance < minDistance) {
            minDistance = distance;
            closestPage = index + 1;
          }
        });

        if (closestPage !== currentPage) {
          setCurrentPage(closestPage);
        }
      }, 50); // 50ms throttle
    };

    const scrollContainer = scrollContainerRef.current;
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollContainer.removeEventListener("scroll", handleScroll);
    };
  }, [viewMode, currentPage, renderedPages]);

  // Update cursor classes when tool changes
  useEffect(() => {
    renderedPages.forEach((pageInfo) => {
      const canvas = pageInfo.canvas;
      const toolClass = tool === "pen" ? "tool-pen" : tool === "eraser" ? "tool-eraser" : "tool-none";
      canvas.className = `pdf-annotation-layer ${toolClass}`;
    });
  }, [tool, renderedPages]);

  // Render annotations on all visible pages (scale normalized coordinates to current zoom)
  useEffect(() => {
    renderedPages.forEach((pageInfo) => {
      const canvas = pageInfo.canvas;
      const context = canvas.getContext("2d")!;
      context.clearRect(0, 0, canvas.width, canvas.height);

      const pageAnnotations = annotations.filter((a) => a.pageNumber === pageInfo.pageNumber);
      
      pageAnnotations.forEach((annotation) => {
        if (annotation.type === "highlight") {
          context.fillStyle = "rgba(255, 255, 0, 0.3)";
          // Scale normalized coordinates (0-1) to current canvas dimensions
          context.fillRect(
            annotation.data.x * canvas.width,
            annotation.data.y * canvas.height,
            annotation.data.width * canvas.width,
            annotation.data.height * canvas.height
          );
        } else if (annotation.type === "pen") {
          context.strokeStyle = annotation.data.color || "#000";
          context.lineWidth = (annotation.data.width || 2) * scale; // Scale line width with zoom
          context.beginPath();
          annotation.data.points.forEach((point: any, index: number) => {
            // Scale normalized coordinates to current canvas dimensions
            const x = point.x * canvas.width;
            const y = point.y * canvas.height;
            if (index === 0) {
              context.moveTo(x, y);
            } else {
              context.lineTo(x, y);
            }
          });
          context.stroke();
        }
      });
    });
  }, [annotations, renderedPages, scale]);

  // Handle text selection for highlighting
  const handleTextSelection = useCallback(() => {
    if (tool !== "highlight") return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const rects = range.getClientRects();
    
    if (rects.length === 0) return;

    // Find which page this selection belongs to
    let targetPageNum: number | null = null;
    let pageContainer: HTMLElement | null = null;

    renderedPages.forEach((pageInfo, pageNum) => {
      if (pageInfo.textLayer.contains(range.commonAncestorContainer)) {
        targetPageNum = pageNum;
        pageContainer = pageInfo.textLayer.parentElement as HTMLElement;
      }
    });

    if (!targetPageNum || !pageContainer) return;

    const pageRect = (pageContainer as HTMLElement).getBoundingClientRect();
    const pageInfo = renderedPages.get(targetPageNum)!;

    // Convert each rect to normalized coordinates (0-1 range)
    Array.from(rects).forEach((rect) => {
      const x = (rect.left - pageRect.left) * (pageInfo.viewport.width / pageRect.width);
      const y = (rect.top - pageRect.top) * (pageInfo.viewport.height / pageRect.height);
      const width = rect.width * (pageInfo.viewport.width / pageRect.width);
      const height = rect.height * (pageInfo.viewport.height / pageRect.height);

      // Normalize to 0-1 range
      const normalizedX = x / pageInfo.viewport.width;
      const normalizedY = y / pageInfo.viewport.height;
      const normalizedWidth = width / pageInfo.viewport.width;
      const normalizedHeight = height / pageInfo.viewport.height;

      const newAnnotation: Annotation = {
        id: `highlight-${Date.now()}-${Math.random()}`,
        type: "highlight",
        pageNumber: targetPageNum!,
        data: { 
          x: normalizedX, 
          y: normalizedY, 
          width: normalizedWidth, 
          height: normalizedHeight 
        },
      };

      setAnnotations((prev) => [...prev, newAnnotation]);
    });

    selection.removeAllRanges();
  }, [tool, renderedPages]);

  // Listen for mouseup to detect text selection
  useEffect(() => {
    const handleMouseUp = () => {
      if (tool === "highlight") {
        setTimeout(handleTextSelection, 10);
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [tool, handleTextSelection]);

  // Helper function to check if point intersects with annotation (using normalized coordinates)
  const checkAnnotationIntersection = (
    normalizedX: number,
    normalizedY: number,
    pageNum: number,
    canvasWidth: number,
    canvasHeight: number
  ): Annotation | null => {
    // Eraser radius in normalized coordinates (relative to canvas size)
    const eraserRadius = 15 / Math.min(canvasWidth, canvasHeight);
    
    return annotations.find((a) => {
      if (a.pageNumber !== pageNum) return false;
      
      if (a.type === "highlight") {
        // Check if point is inside highlight rectangle (normalized coords)
        return (
          normalizedX >= a.data.x - eraserRadius &&
          normalizedX <= a.data.x + a.data.width + eraserRadius &&
          normalizedY >= a.data.y - eraserRadius &&
          normalizedY <= a.data.y + a.data.height + eraserRadius
        );
      } else if (a.type === "pen") {
        // Check if point is near any point in the pen stroke (normalized coords)
        return a.data.points.some((point: any) => {
          const dist = Math.sqrt(Math.pow(normalizedX - point.x, 2) + Math.pow(normalizedY - point.y, 2));
          return dist < eraserRadius;
        });
      }
      return false;
    }) || null;
  };

  // Handle pen drawing and erasing on canvas
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== "pen" && tool !== "eraser") return;

    const target = e.target as HTMLElement;
    if (!target.classList.contains("pdf-annotation-layer")) return;

    const canvas = target as HTMLCanvasElement;
    const pageNum = parseInt(canvas.dataset.pageNumber || "0");
    if (!pageNum) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Normalize coordinates (0-1 range) for zoom independence
    const normalizedX = x / canvas.width;
    const normalizedY = y / canvas.height;

    if (tool === "eraser") {
      setIsErasing(true);
      setErasedIds(new Set());
      
      // Check for annotation to erase
      const annotation = checkAnnotationIntersection(normalizedX, normalizedY, pageNum, canvas.width, canvas.height);
      if (annotation && !erasedIds.has(annotation.id)) {
        setAnnotations((prev) => prev.filter((a) => a.id !== annotation.id));
        setErasedIds((prev) => new Set(prev).add(annotation.id));
      }
    } else if (tool === "pen") {
      setIsDrawing(true);
      setCurrentDrawing({
        id: `pen-${Date.now()}-${Math.random()}`,
          type: "pen",
        pageNumber: pageNum,
          data: { points: [{ x: normalizedX, y: normalizedY }], color: "#000", width: 2 },
      });
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("pdf-annotation-layer")) return;

    const canvas = target as HTMLCanvasElement;
    const pageNum = parseInt(canvas.dataset.pageNumber || "0");
    if (!pageNum) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Normalize coordinates (0-1 range)
    const normalizedX = x / canvas.width;
    const normalizedY = y / canvas.height;

    if (isErasing && tool === "eraser") {
      // Continuously check for annotations to erase while dragging
      const annotation = checkAnnotationIntersection(normalizedX, normalizedY, pageNum, canvas.width, canvas.height);
      if (annotation && !erasedIds.has(annotation.id)) {
        setAnnotations((prev) => prev.filter((a) => a.id !== annotation.id));
        setErasedIds((prev) => new Set(prev).add(annotation.id));
      }
    } else if (isDrawing && tool === "pen" && currentDrawing) {
      setCurrentDrawing((prev: any) => ({
        ...prev,
        data: {
          ...prev.data,
          points: [...prev.data.points, { x: normalizedX, y: normalizedY }],
        },
      }));
    }
  };

  const handleCanvasMouseUp = () => {
    if (isDrawing && currentDrawing) {
      setAnnotations((prev) => [...prev, currentDrawing]);
      setCurrentDrawing(null);
    }
    if (isErasing) {
      if (erasedIds.size > 0) {
        toast.success(`Erased ${erasedIds.size} annotation${erasedIds.size > 1 ? 's' : ''}`);
      }
      setErasedIds(new Set());
    }
    setIsDrawing(false);
    setIsErasing(false);
  };

  // Render current drawing (scale normalized coordinates)
  useEffect(() => {
    if (!currentDrawing) return;

    const pageInfo = renderedPages.get(currentDrawing.pageNumber);
    if (!pageInfo) return;

    const canvas = pageInfo.canvas;
    const context = canvas.getContext("2d")!;
    
    // Re-render all annotations plus current drawing
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    const pageAnnotations = annotations.filter((a) => a.pageNumber === currentDrawing.pageNumber);
    [...pageAnnotations, currentDrawing].forEach((annotation) => {
      if (annotation.type === "pen") {
        context.strokeStyle = annotation.data.color || "#000";
        context.lineWidth = (annotation.data.width || 2) * scale; // Scale line width
        context.beginPath();
        annotation.data.points.forEach((point: any, index: number) => {
          // Scale normalized coordinates to canvas dimensions
          const x = point.x * canvas.width;
          const y = point.y * canvas.height;
          if (index === 0) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        });
        context.stroke();
      }
    });
  }, [currentDrawing, renderedPages, annotations, scale]);

  // Save annotations
  const saveAnnotations = useCallback(() => {
    if (annotations.length === 0) {
      // If no annotations, save empty string to clear
      updateAnnotationsMutation.mutate({
        id: fileId,
        annotations: JSON.stringify([]),
      });
    } else {
    updateAnnotationsMutation.mutate({
      id: fileId,
      annotations: JSON.stringify(annotations),
    });
    }
  }, [annotations, fileId, updateAnnotationsMutation]);

  // Auto-save annotations after changes
  useEffect(() => {
      const timeout = setTimeout(saveAnnotations, 1000);
      return () => clearTimeout(timeout);
  }, [annotations, saveAnnotations]);

  // Save zoom level to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(`pdf-zoom-${fileId}`, scale.toString());
    } catch (error) {
      console.error("Failed to save zoom level:", error);
    }
  }, [scale, fileId]);

  // Save current page to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(`pdf-page-${fileId}`, currentPage.toString());
    } catch (error) {
      console.error("Failed to save current page:", error);
    }
  }, [currentPage, fileId]);

  // Save questions to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(`pdf-questions-${fileId}`, JSON.stringify(questions));
    } catch (error) {
      console.error("Failed to save questions:", error);
    }
  }, [questions, fileId]);

  // Save thumbnail sidebar visibility to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(`pdf-thumbnails-visible-${fileId}`, JSON.stringify(showThumbnails));
    } catch (error) {
      console.error("Failed to save thumbnail visibility:", error);
    }
  }, [showThumbnails, fileId]);

  // Save thumbnail sidebar width to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(`pdf-thumbnail-width-${fileId}`, thumbnailWidth.toString());
    } catch (error) {
      console.error("Failed to save thumbnail width:", error);
    }
  }, [thumbnailWidth, fileId]);

  // Chat messages are now persisted on the server via the streaming endpoint
  // No need for localStorage persistence

  // Close zoom dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (showZoomDropdown && !target.closest('.relative')) {
        setShowZoomDropdown(false);
      }
    };

    if (showZoomDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showZoomDropdown]);

  // Keyboard shortcuts for tools
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs/textareas
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'e':
          e.preventDefault();
          setTool((prev) => prev === "eraser" ? "none" : "eraser");
          break;
        case 'h':
          e.preventDefault();
          setTool((prev) => prev === "highlight" ? "none" : "highlight");
          break;
        case 'd':
          e.preventDefault();
          setTool((prev) => prev === "pen" ? "none" : "pen");
          break;
        case 'escape':
          e.preventDefault();
          setTool("none");
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle trackpad/mouse wheel zoom
  useEffect(() => {
    let zoomResetTimer: NodeJS.Timeout | null = null;

    const handleWheel = (e: WheelEvent) => {
      // Detect pinch-to-zoom: ctrlKey is set on macOS trackpad pinch
      // Also check for actual pinch events (some browsers)
      const isPinchZoom = e.ctrlKey || e.metaKey;
      
      if (isPinchZoom) {
        e.preventDefault();
        e.stopPropagation();
        
        // Save position BEFORE zoom (only on first zoom event)
        if (!isZooming.current) {
          saveScrollPositionForZoom();
        }
        
        // Mark as zooming
        isZooming.current = true;
        
        // Calculate zoom factor
        // Negative deltaY means zoom in, positive means zoom out
        const delta = -e.deltaY;
        const zoomFactor = delta > 0 ? 1.05 : 0.95;
        
        setTargetScale((prev) => Math.max(0.5, Math.min(3, prev * zoomFactor)));
        
        // Reset zooming flag after user stops zooming
        if (zoomResetTimer) clearTimeout(zoomResetTimer);
        zoomResetTimer = setTimeout(() => {
          isZooming.current = false;
          zoomResetTimer = null;
        }, 300);
      }
    };

    const container = containerRef.current;
    if (container) {
      // Use capture phase and prevent default
      container.addEventListener("wheel", handleWheel, { passive: false, capture: true });
      return () => {
        container.removeEventListener("wheel", handleWheel, { capture: true });
        if (zoomResetTimer) clearTimeout(zoomResetTimer);
      };
    }
  }, []);

  // Prevent arrow key scrolling in thumbnail sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const sidebar = thumbnailSidebarRef.current;
      if (!sidebar) return;

      // Check if focused element is within the thumbnail sidebar
      const activeElement = document.activeElement;
      if (activeElement && sidebar.contains(activeElement)) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    // Attach to document level to catch all keyboard events early
    document.addEventListener("keydown", handleKeyDown, { passive: false, capture: true });
    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, []);

  // Smooth zoom animation using lerp
  useEffect(() => {
    let animationFrameId: number;
    
    const animate = () => {
      setScale((currentScale) => {
        const diff = targetScale - currentScale;
        
        // If close enough, snap to target
        if (Math.abs(diff) < 0.001) {
          return targetScale;
        }
        
        // Linear interpolation for smooth animation
        const newScale = currentScale + diff * 0.15;
        animationFrameId = requestAnimationFrame(animate);
        return newScale;
      });
    };
    
    // Start animation if target differs from current
    if (Math.abs(targetScale - scale) > 0.001) {
      animationFrameId = requestAnimationFrame(animate);
    }
    
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [targetScale, scale]);

  // View mode cycling
  const cycleViewMode = () => {
    setViewMode((prev) => {
      if (prev === "continuous") return "single";
      if (prev === "single") return "double";
      return "continuous";
    });
  };

  // Handle horizontal resize (PDF viewer vs Sidebar)
  const handleHorizontalMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingHorizontal(true);
  };

  const handleHorizontalMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingHorizontal) return;

    const containerWidth = window.innerWidth;
    const newSidebarWidth = ((containerWidth - e.clientX) / containerWidth) * 100;

    if (newSidebarWidth < COLLAPSE_THRESHOLD) {
      setIsSidebarCollapsed(true);
      setIsResizingHorizontal(false);
    } else if (newSidebarWidth >= MIN_SIDEBAR_WIDTH && newSidebarWidth <= (100 - MIN_PDF_WIDTH)) {
      setSidebarWidth(newSidebarWidth);
      setIsSidebarCollapsed(false);
    }
  }, [isResizingHorizontal]);

  const handleMouseUp = useCallback(() => {
    setIsResizingHorizontal(false);
    setIsResizingVertical(false);
    setIsResizingThumbnail(false);
  }, []);

  // Handle vertical resize (Questions vs Study Assistant)
  const handleVerticalMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingVertical(true);
  };

  const handleVerticalMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingVertical || !containerRef.current) return;

    const sidebarElement = containerRef.current.querySelector('.sidebar-container') as HTMLElement;
    if (!sidebarElement) return;

    const rect = sidebarElement.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const newQuestionsHeight = (relativeY / rect.height) * 100;

    if (newQuestionsHeight >= MIN_SECTION_HEIGHT && newQuestionsHeight <= (100 - MIN_SECTION_HEIGHT)) {
      setQuestionsHeight(newQuestionsHeight);
    }
  }, [isResizingVertical]);

  // Handle thumbnail sidebar resize
  const handleThumbnailMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingThumbnail(true);
  };

  const handleThumbnailMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizingThumbnail || !containerRef.current) return;

    const pdfViewerElement = containerRef.current.querySelector('.pdf-viewer-section') as HTMLElement;
    if (!pdfViewerElement) return;

    const pdfViewerRect = pdfViewerElement.getBoundingClientRect();
    const pdfViewerWidth = pdfViewerRect.width;
    const offsetX = e.clientX - pdfViewerRect.left;
    const newThumbnailWidth = (offsetX / pdfViewerWidth) * 100;

    if (newThumbnailWidth < THUMBNAIL_COLLAPSE_THRESHOLD) {
      setShowThumbnails(false);
      setThumbnailWidth(MIN_THUMBNAIL_WIDTH);
    } else if (newThumbnailWidth >= MIN_THUMBNAIL_WIDTH && newThumbnailWidth <= MAX_THUMBNAIL_WIDTH) {
      setThumbnailWidth(newThumbnailWidth);
      setShowThumbnails(true);
    }
  }, [isResizingThumbnail]);

  useEffect(() => {
    if (isResizingHorizontal) {
      document.addEventListener('mousemove', handleHorizontalMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.classList.add('resizing');
    } else if (isResizingVertical) {
      document.addEventListener('mousemove', handleVerticalMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.classList.add('resizing-vertical');
    } else if (isResizingThumbnail) {
      document.addEventListener('mousemove', handleThumbnailMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.classList.add('resizing');
    } else {
      document.body.classList.remove('resizing', 'resizing-vertical');
    }

    return () => {
      document.removeEventListener('mousemove', handleHorizontalMouseMove);
      document.removeEventListener('mousemove', handleVerticalMouseMove);
      document.removeEventListener('mousemove', handleThumbnailMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.classList.remove('resizing', 'resizing-vertical');
    };
  }, [isResizingHorizontal, isResizingVertical, isResizingThumbnail, handleHorizontalMouseMove, handleVerticalMouseMove, handleThumbnailMouseMove, handleMouseUp]);

  // Question handlers
  const addQuestion = () => {
    if (!questionInput.trim()) return;
    const newQuestion: Question = {
      id: Date.now().toString(),
      text: questionInput,
      timestamp: Date.now(),
    };
    setQuestions((prev) => [newQuestion, ...prev]);
    setQuestionInput("");
  };

  const removeQuestion = (id: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  };

  const [isStreaming, setIsStreaming] = useState(false);

  // Handle citation click - jump to page
  const handleCitationClick = (pageNumber: number) => {
    setCurrentPage(pageNumber);
    
    // Scroll to page if in continuous mode
    if (viewMode === "continuous" && pagesContainerRef.current) {
      const pageElements = pagesContainerRef.current.querySelectorAll(".pdf-page-container");
      const targetPage = pageElements[pageNumber - 1];
      if (targetPage) {
        targetPage.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    
    toast.info(`Jumped to page ${pageNumber}`);
  };

  // Handle thumbnail click - select thumbnail and jump to page
  const handleThumbnailClick = (pageNumber: number) => {
    setSelectedThumbnail(pageNumber);
    setCurrentPage(pageNumber);
    
    // Scroll to page if in continuous mode
    if (viewMode === "continuous" && scrollContainerRef.current && pagesContainerRef.current) {
      const pageElements = pagesContainerRef.current.querySelectorAll(".pdf-page-container");
      const targetPage = pageElements[pageNumber - 1];
      if (targetPage) {
        targetPage.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  };

  // Save scroll position before zoom (centered on viewport)
  const saveScrollPositionForZoom = () => {
    if (viewMode !== "continuous" || !scrollContainerRef.current || !pagesContainerRef.current) return;
    
    const scrollContainer = scrollContainerRef.current;
    const pageElements = pagesContainerRef.current.querySelectorAll(".pdf-page-container");
    if (pageElements.length === 0) return;
    
    // Calculate the center point of the viewport
    const viewportCenter = scrollContainer.scrollTop + (scrollContainer.clientHeight / 2);
    
    // Find which page contains the viewport center
    const currentPageElement = pageElements[currentPage - 1] as HTMLElement;
    if (currentPageElement) {
      const pageTop = currentPageElement.offsetTop;
      const pageHeight = currentPageElement.offsetHeight;
      const centerOffsetInPage = viewportCenter - pageTop;
      const ratio = centerOffsetInPage / pageHeight;
      savedScrollRatio.current = ratio;
    }
  };

  // Handle thumbnail keyboard navigation - instantly jump to pages like macOS Preview
  const handleThumbnailKeyDown = (e: React.KeyboardEvent, pageNum: number) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (pageNum > 1) {
        handleThumbnailClick(pageNum - 1);
        // Focus the previous thumbnail
        setTimeout(() => {
          const thumbnailButtons = document.querySelectorAll('.thumbnail-button');
          const prevButton = thumbnailButtons[pageNum - 2] as HTMLButtonElement;
          if (prevButton) prevButton.focus();
        }, 10);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (pageNum < totalPages) {
        handleThumbnailClick(pageNum + 1);
        // Focus the next thumbnail
        setTimeout(() => {
          const thumbnailButtons = document.querySelectorAll('.thumbnail-button');
          const nextButton = thumbnailButtons[pageNum] as HTMLButtonElement;
          if (nextButton) nextButton.focus();
        }, 10);
      }
    }
  };

  // Handle zoom input editing
  const handleZoomInputBlur = () => {
    const value = parseFloat(zoomInputValue);
    if (!isNaN(value)) {
      saveScrollPositionForZoom();
      isZooming.current = true;
      const clampedValue = Math.max(50, Math.min(300, value));
      const newScale = clampedValue / 100;
      setScale(newScale);
      setTargetScale(newScale);
      setTimeout(() => {
        isZooming.current = false;
      }, 300);
    }
    setIsEditingZoom(false);
    setZoomInputValue("");
  };

  const handleZoomInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleZoomInputBlur();
    } else if (e.key === "Escape") {
      setIsEditingZoom(false);
      setZoomInputValue("");
    }
  };

  // Handle page input editing
  const handlePageInputBlur = () => {
    const value = parseInt(pageInputValue);
    if (!isNaN(value) && value >= 1 && value <= totalPages) {
      setCurrentPage(value);
      // Scroll to page if in continuous mode
      if (viewMode === "continuous" && scrollContainerRef.current && pagesContainerRef.current) {
        setTimeout(() => {
          const pageElements = pagesContainerRef.current!.querySelectorAll(".pdf-page-container");
          const targetPage = pageElements[value - 1];
          if (targetPage) {
            targetPage.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 50);
      }
    }
    setIsEditingPage(false);
    setPageInputValue("");
  };

  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handlePageInputBlur();
    } else if (e.key === "Escape") {
      setIsEditingPage(false);
      setPageInputValue("");
    }
  };

  const sendChatMessage = async (message?: string) => {
    const messageToSend = message || chatInput.trim();
    if (!messageToSend || isStreaming || !threadId) {
      if (!threadId) {
        toast.error("Initializing chat...");
      }
      return;
    }
    
    if (!message) {
    setChatInput("");
    }

    // Check index status
    if (indexStatus !== "READY") {
      toast.error("PDF is still being indexed. Please wait...");
      return;
    }
    
    setIsStreaming(true);
    
    // Add user message immediately
    setChatMessages((prev) => [
      ...prev,
      { role: "user", content: messageToSend },
      { role: "assistant", content: "", streaming: true }, // Streaming placeholder
    ]);
    
    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
      fileId,
          threadId,
          message: messageToSend,
      systemPrompt,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Stream request failed: ${response.statusText}`);
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error("No response body");
      }
      
      let buffer = "";
      let fullResponse = "";
      let citations: Citation[] = [];
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));
            
            if (data.type === "token") {
              fullResponse += data.content;
              setChatMessages((prev) => {
                const updated = [...prev];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg.role === "assistant" && lastMsg.streaming) {
                  lastMsg.content = fullResponse;
                }
                return updated;
              });
            } else if (data.type === "done") {
              citations = data.citations || [];
            } else if (data.type === "error") {
              toast.error(`Chat error: ${data.error}`);
              setChatMessages((prev) => prev.slice(0, -1)); // Remove placeholder
              return;
            }
          }
        }
      }
      
      // Finalize the message
      setChatMessages((prev) => {
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg.role === "assistant") {
          lastMsg.streaming = false;
          lastMsg.citations = citations;
        }
        return updated;
      });
      
    } catch (error) {
      console.error("Streaming error:", error);
      toast.error(`Chat error: ${error instanceof Error ? error.message : String(error)}`);
      setChatMessages((prev) => prev.slice(0, -1)); // Remove placeholder
    } finally {
      setIsStreaming(false);
    }
  };

  // Drag and drop handlers for questions
  const handleQuestionDragStart = (e: React.DragEvent, question: Question) => {
    setDraggedQuestion(question);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", question.text);
    
    // Add visual feedback to the dragged element
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "0.5";
    }
  };

  const handleQuestionDragEnd = (e: React.DragEvent) => {
    setDraggedQuestion(null);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
  };

  const handleChatDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOverChat(true);
  };

  const handleChatDragLeave = (e: React.DragEvent) => {
    // Only remove highlight if we're actually leaving the drop zone
    const rect = e.currentTarget.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX >= rect.right ||
      e.clientY < rect.top ||
      e.clientY >= rect.bottom
    ) {
      setIsDragOverChat(false);
    }
  };

  const handleChatDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverChat(false);
    
    if (draggedQuestion) {
      // Send the question to the chat
      sendChatMessage(draggedQuestion.text);
      
      // Optionally remove the question from the list
      // Uncomment if you want questions to be removed after being asked:
      // removeQuestion(draggedQuestion.id);
    }
  };

  if (!file) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const getViewModeIcon = () => {
    if (viewMode === "continuous") return <ScrollText className="h-4 w-4" />;
    if (viewMode === "single") return <FileText className="h-4 w-4" />;
    return <Columns2 className="h-4 w-4" />;
  };

  const getViewModeLabel = () => {
    if (viewMode === "continuous") return "Continuous";
    if (viewMode === "single") return "Single Page";
    return "Two Pages";
  };

  // Save system prompt to localStorage whenever it changes
  const handleSystemPromptChange = (newPrompt: string) => {
    setSystemPrompt(newPrompt);
    try {
      localStorage.setItem('studyAssistantSystemPrompt', newPrompt);
      toast.success("System prompt saved universally!");
    } catch (error) {
      console.error("Failed to save system prompt:", error);
      toast.error("Failed to save system prompt");
    }
  };

  // Reset system prompt to default
  const handleResetSystemPrompt = () => {
    handleSystemPromptChange(DEFAULT_SYSTEM_PROMPT);
  };

  // Simple markdown parser for bold and links only
  const parseSimpleMarkdown = (text: string) => {
    const parts: Array<{ type: 'text' | 'bold' | 'link', content: string, url?: string }> = [];
    
    // Combined regex for bold (**text**) and links [text](url)
    const regex = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }

      if (match[1]) {
        // Bold text
        parts.push({ type: 'bold', content: match[2] });
      } else if (match[3]) {
        // Link
        parts.push({ type: 'link', content: match[4], url: match[5] });
      }

      lastIndex = regex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.slice(lastIndex) });
    }

    return parts;
  };

  const renderMarkdownText = (text: string) => {
    const parts = parseSimpleMarkdown(text);
    
    return (
      <>
        {parts.map((part, idx) => {
          if (part.type === 'bold') {
            return <strong key={idx} className="font-bold">{part.content}</strong>;
          } else if (part.type === 'link') {
            return (
              <a
                key={idx}
                href={part.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline hover:text-primary/80"
              >
                {part.content}
              </a>
            );
          } else {
            return <span key={idx}>{part.content}</span>;
          }
        })}
      </>
    );
  };

  const pdfViewerWidth = isSidebarCollapsed ? 100 : (100 - sidebarWidth);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center justify-between" onClick={() => setSelectedThumbnail(null)}>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation(`/module/${file.moduleId}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="font-semibold">{file.fileName}</h1>
        </div>
        {isSidebarCollapsed && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setIsSidebarCollapsed(false)}
            title="Show sidebar"
          >
            <PanelRightOpen className="h-4 w-4 mr-2" />
            Show Sidebar
          </Button>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden" ref={containerRef}>
        {/* PDF Viewer */}
        <div 
          className="pdf-viewer-section border-r flex flex-col bg-slate-50 dark:bg-slate-900 transition-all duration-200"
          style={{ width: `${pdfViewerWidth}%` }}
        >
          {/* PDF Tools and Controls Bar */}
          <div className="border-b bg-background px-2 md:px-4 py-2 md:py-3 flex items-center justify-between gap-1 md:gap-2">
        <div className="flex items-center gap-1 md:gap-2">
              {/* Thumbnail toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowThumbnails(!showThumbnails)}
                title="Toggle thumbnails sidebar"
                className="h-8 w-8 p-0"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <div className="h-6 w-px bg-border hidden md:block" />
              <span className="text-sm font-medium mr-2 hidden xl:inline">Tools:</span>
          <Button
            variant={tool === "highlight" ? "default" : "outline"}
                size="sm"
            onClick={() => setTool(tool === "highlight" ? "none" : "highlight")}
                title="Highlight text - Press H (select text to highlight)"
                className="h-8 px-2 md:px-3"
          >
                <Highlighter className="h-4 w-4 xl:mr-2" />
                <span className="hidden xl:inline">Highlight</span>
          </Button>
          <Button
            variant={tool === "pen" ? "default" : "outline"}
                size="sm"
            onClick={() => setTool(tool === "pen" ? "none" : "pen")}
                title="Draw with pen - Press D"
                className="h-8 px-2 md:px-3"
          >
                <Pen className="h-4 w-4 xl:mr-2" />
                <span className="hidden xl:inline">Draw</span>
          </Button>
              <Button
                variant={tool === "eraser" ? "default" : "outline"}
                size="sm"
                onClick={() => setTool(tool === "eraser" ? "none" : "eraser")}
                title="Erase annotations - Press E (drag to erase)"
                className="h-8 px-2 md:px-3"
              >
                <Eraser className="h-4 w-4 xl:mr-2" />
                <span className="hidden xl:inline">Erase</span>
              </Button>
              <div className="h-6 w-px bg-border hidden md:block" />
              <Button
                variant="outline"
                size="sm"
                onClick={cycleViewMode}
                title={`View mode: ${getViewModeLabel()}`}
                className="h-8 px-2 md:px-3"
              >
                {getViewModeIcon()}
                <span className="ml-2 hidden xl:inline">{getViewModeLabel()}</span>
              </Button>
            </div>
            <div className="flex items-center gap-1 px-1 md:px-2">
              {isEditingPage ? (
                <div className="flex items-center gap-0.5">
                  <Input
                    type="text"
                    value={pageInputValue}
                    onChange={(e) => setPageInputValue(e.target.value)}
                    onBlur={handlePageInputBlur}
                    onKeyDown={handlePageInputKeyDown}
                    className="h-7 w-12 px-1 text-xs text-center"
                    placeholder={currentPage.toString()}
                    autoFocus
                  />
                  <span className="text-xs text-muted-foreground">/{totalPages}</span>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setIsEditingPage(true);
                    setPageInputValue(currentPage.toString());
                  }}
                  className="text-xs md:text-sm text-muted-foreground font-medium whitespace-nowrap hover:text-foreground transition-colors"
                  title="Click to jump to page"
                >
                  {currentPage}/{totalPages}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1 md:gap-2">
              <span className="text-sm font-medium mr-2 hidden xl:inline">Zoom:</span>
          <Button variant="outline" size="icon" onClick={() => {
            saveScrollPositionForZoom();
            isZooming.current = true;
            const newScale = Math.max(0.5, scale - 0.25);
            setScale(newScale);
            setTargetScale(newScale);
            setTimeout(() => {
              isZooming.current = false;
            }, 300);
          }} className="h-8 w-8">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <div className="relative">
            {isEditingZoom ? (
              <Input
                type="text"
                value={zoomInputValue}
                onChange={(e) => setZoomInputValue(e.target.value)}
                onBlur={handleZoomInputBlur}
                onKeyDown={handleZoomInputKeyDown}
                className="h-8 w-[60px] px-2 font-mono text-xs text-center"
                placeholder={Math.round(scale * 100).toString()}
                autoFocus
              />
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsEditingZoom(true);
                  setZoomInputValue(Math.round(scale * 100).toString());
                }}
                className="h-8 min-w-[60px] px-2 font-mono text-xs"
              >
            {Math.round(scale * 100)}%
              </Button>
            )}
            {showZoomDropdown && !isEditingZoom && (
              <div className="absolute right-0 top-full mt-1 bg-background border rounded-md shadow-lg z-50 min-w-[100px]">
                {zoomPresets.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => {
                      saveScrollPositionForZoom();
                      isZooming.current = true;
                      const newScale = preset / 100;
                      setScale(newScale);
                      setTargetScale(newScale);
                      setShowZoomDropdown(false);
                      setTimeout(() => {
                        isZooming.current = false;
                      }, 300);
                    }}
                    className={`w-full px-3 py-2 text-sm text-left hover:bg-accent transition-colors ${
                      Math.round(scale * 100) === preset ? "bg-accent font-medium" : ""
                    }`}
                  >
                    {preset}%
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button variant="outline" size="icon" onClick={() => {
            saveScrollPositionForZoom();
            isZooming.current = true;
            const newScale = Math.min(3, scale + 0.25);
            setScale(newScale);
            setTargetScale(newScale);
            setTimeout(() => {
              isZooming.current = false;
            }, 300);
          }} className="h-8 w-8">
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

          {/* Main PDF Area with Thumbnails */}
      <div className="flex-1 flex overflow-hidden">
            {/* Thumbnail Sidebar */}
            {showThumbnails && (
              <>
                <div 
                  ref={thumbnailSidebarRef}
                  className="border-r bg-background overflow-y-auto flex-shrink-0"
                  style={{ width: `${thumbnailWidth}%` }}
                >
                  <div className="p-2 space-y-2">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
                      const thumbnail = thumbnails.get(pageNum);
                      const isSelected = pageNum === selectedThumbnail;
                      const isCurrentPage = pageNum === currentPage;
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => handleThumbnailClick(pageNum)}
                          onKeyDown={(e) => handleThumbnailKeyDown(e, pageNum)}
                          className={`thumbnail-button w-full group relative rounded-md overflow-hidden transition-all ${
                            isSelected
                              ? "ring-2 ring-primary shadow-lg"
                              : isCurrentPage
                              ? "ring-2 ring-muted-foreground/40 shadow-md"
                              : "hover:ring-2 hover:ring-primary/50 shadow-sm"
                          }`}
                        >
                          {thumbnail ? (
                            <img
                              src={thumbnail}
                              alt={`Page ${pageNum}`}
                              className="w-full h-auto"
                            />
                          ) : (
                            <div className="w-full aspect-[8.5/11] bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                              <span className="text-muted-foreground text-xs">Loading...</span>
                            </div>
                          )}
                          <div className={`absolute bottom-0 left-0 right-0 text-center py-1 text-xs font-medium ${
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : isCurrentPage
                              ? "bg-muted-foreground/60 text-white"
                              : "bg-black/60 text-white group-hover:bg-black/80"
                          }`}>
                            {pageNum}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Resize handle for thumbnail sidebar */}
                <div
                  className="w-1 bg-border hover:bg-primary cursor-col-resize flex-shrink-0 transition-colors"
                  onMouseDown={handleThumbnailMouseDown}
                  title="Drag to resize thumbnail sidebar"
                />
              </>
            )}

          {/* PDF Canvas Area */}
          <div 
            ref={scrollContainerRef} 
            className="pdf-scroll-container flex-1 overflow-auto"
            onClick={() => setSelectedThumbnail(null)}
          >
            <div 
              ref={pagesContainerRef}
              className="p-8 min-h-full"
              style={{ 
                textAlign: viewMode === "double" ? "center" : "left",
                userSelect: tool === "highlight" ? "text" : "none"
              }}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
            />
          </div>

          {/* Page Navigation - Only show for single/double page modes */}
          {viewMode !== "continuous" && totalPages > 0 && (
            <div className="border-t bg-background px-4 py-3 flex justify-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setCurrentPage((p) => Math.max(1, p - (viewMode === "double" ? 2 : 1)))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <div className="flex items-center px-4 bg-muted rounded-md">
                <span className="text-sm font-medium">
                  Page {currentPage}{viewMode === "double" && currentPage < totalPages && `-${currentPage + 1}`} of {totalPages}
                </span>
              </div>
              <Button
                variant="secondary"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + (viewMode === "double" ? 2 : 1)))}
                disabled={currentPage >= totalPages}
              >
                Next
              </Button>
            </div>
          )}
          </div>
        </div>

        {/* Horizontal Resize Handle */}
        {!isSidebarCollapsed && (
          <div
            className="w-1 bg-border hover:bg-primary cursor-col-resize flex items-center justify-center group relative transition-colors"
            onMouseDown={handleHorizontalMouseDown}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
            <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 absolute" />
          </div>
        )}

        {/* Right sidebar */}
        {!isSidebarCollapsed && (
          <div 
            className="flex flex-col sidebar-container transition-all duration-200"
            style={{ width: `${sidebarWidth}%` }}
            onClick={() => setSelectedThumbnail(null)}
          >
            {/* Questions section */}
            <div 
              className="border-b flex flex-col p-4 overflow-hidden"
              style={{ height: `${questionsHeight}%` }}
            >
            <h2 className="font-semibold mb-3">Questions</h2>
            <div className="flex gap-2 mb-3">
              <Textarea
                placeholder="Type your question and press Enter..."
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    addQuestion();
                  }
                }}
                className="resize-none text-base"
                rows={2}
              />
            </div>
            <div className="flex-1 overflow-auto space-y-2">
              {questions.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  Add questions as you study. Drag them to the Study Assistant to ask!
                </div>
              ) : (
                questions.map((q) => (
                  <Card 
                    key={q.id} 
                    className="p-2 group relative cursor-move hover:shadow-md transition-shadow"
                    draggable
                    onDragStart={(e) => handleQuestionDragStart(e, q)}
                    onDragEnd={handleQuestionDragEnd}
                  >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100"
                    onClick={() => removeQuestion(q.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                    <p className="text-sm pr-7 leading-snug">{q.text}</p>
                    <div className="text-xs text-muted-foreground mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      Drag to Study Assistant to ask
                    </div>
                </Card>
                ))
              )}
            </div>
          </div>

          {/* Vertical Resize Handle */}
          <div
            className="h-1 bg-border hover:bg-primary cursor-row-resize flex items-center justify-center group relative transition-colors"
            onMouseDown={handleVerticalMouseDown}
          >
            <div className="absolute inset-x-0 -top-1 -bottom-1" />
            <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 absolute rotate-90" />
          </div>

          {/* Chat section */}
          <div 
            className={`flex flex-col p-4 overflow-hidden transition-all ${
              isDragOverChat ? 'bg-primary/10 border-2 border-primary border-dashed' : ''
            }`}
            style={{ height: `${100 - questionsHeight}%` }}
            onDragOver={handleChatDragOver}
            onDragLeave={handleChatDragLeave}
            onDrop={handleChatDrop}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Study Assistant</h2>
              <div className="flex items-center gap-2">
                {/* Indexing status indicator */}
                {indexStatus === "INDEXING" && (
                  <div className="flex items-center gap-2 text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded">
                    <span className="animate-spin">⚙️</span>
                    <span>Indexing {indexProgress}%</span>
                  </div>
                )}
                {indexStatus === "READY" && (
                  <div className="text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-1 rounded">
                    ✓ Context indexed
                  </div>
                )}
                {indexStatus === "ERROR" && (
                  <button
                    onClick={() => triggerIndexMutation.mutate({ fileId })}
                    className="text-xs bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 px-2 py-1 rounded hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                  >
                    ⚠️ Indexing failed - Click to retry
                  </button>
                )}
              <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)}>
                <Settings className="h-4 w-4" />
              </Button>
            </div>
            </div>
            {isDragOverChat && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="bg-primary text-primary-foreground px-4 py-2 rounded-lg shadow-lg">
                  Drop question here to ask
                </div>
              </div>
            )}
            <div className="flex-1 overflow-auto space-y-3 mb-3">
              {chatMessages.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  Ask questions about the material
                </div>
              ) : (
                chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-lg ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground ml-4"
                        : "bg-muted mr-4"
                    }`}
                  >
                    {msg.streaming && !msg.content ? (
                      <div className="flex gap-1">
                        <span className="animate-bounce">.</span>
                        <span className="animate-bounce" style={{ animationDelay: "0.1s" }}>.</span>
                        <span className="animate-bounce" style={{ animationDelay: "0.2s" }}>.</span>
                      </div>
                    ) : (
                      <>
                        <div className="text-base leading-relaxed whitespace-pre-wrap">
                          {msg.content.split('\n').map((line: string, lineIdx: number) => (
                            <div key={lineIdx}>
                              {line ? renderMarkdownText(line) : <br />}
                            </div>
                          ))}
                        </div>
                        {/* Citations */}
                        {msg.citations && msg.citations.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-border/50">
                            <div className="text-xs text-muted-foreground">
                              <span className="font-medium">Sources: </span>
                              {msg.citations.slice(0, 5).map((citation: Citation, citationIdx: number) => (
                                <button
                                  key={citationIdx}
                                  onClick={() => handleCitationClick(citation.page_start)}
                                  className="hover:underline hover:text-primary mr-2"
                                >
                                  {citation.page_start === citation.page_end
                                    ? `p. ${citation.page_start}`
                                    : `p. ${citation.page_start}-${citation.page_end}`}
                                </button>
                              ))}
                              {msg.citations.length > 5 && (
                                <span className="text-muted-foreground/70">
                                  +{msg.citations.length - 5} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <Textarea
                placeholder="Ask about the material..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChatMessage();
                  }
                }}
                className="resize-none text-base"
                rows={2}
                disabled={isStreaming || indexStatus !== "READY"}
              />
              {isStreaming ? (
                <Button size="icon" variant="destructive" disabled>
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button 
                  size="icon" 
                  onClick={() => sendChatMessage()} 
                  disabled={!chatInput.trim() || indexStatus !== "READY"}
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Study Assistant Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="bg-muted/50 p-3 rounded-lg text-sm">
              <p className="text-muted-foreground">
                ℹ️ This system prompt applies <strong>universally</strong> across all PDFs and modules.
                Changes saved here will affect the assistant's behavior everywhere.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">System Prompt</label>
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={6}
                placeholder="Customize how the assistant responds..."
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Define the assistant's personality, expertise level, and response style.
              </p>
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={() => {
                  handleSystemPromptChange(systemPrompt);
                  setShowSettings(false);
                }} 
                className="flex-1"
              >
                Save Changes
              </Button>
              <Button 
                variant="outline" 
                onClick={handleResetSystemPrompt}
              >
                Reset to Default
            </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
