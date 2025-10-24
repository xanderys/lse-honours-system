import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ZoomIn, ZoomOut, Highlighter, Pen, Send, Settings, X } from "lucide-react";
import { toast } from "sonner";
import * as pdfjsLib from "pdfjs-dist";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type Annotation = {
  type: "highlight" | "pen";
  pageNumber: number;
  data: any;
};

type Question = {
  id: string;
  text: string;
  timestamp: number;
};

export default function DeepFocus() {
  const { id } = useParams<{ id: string }>();
  const fileId = parseInt(id);
  const [, setLocation] = useLocation();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [tool, setTool] = useState<"none" | "highlight" | "pen">("none");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionInput, setQuestionInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful study assistant. Help the student understand the lecture material.");
  const [showSettings, setShowSettings] = useState(false);

  const utils = trpc.useUtils();
  const { data: file } = trpc.pdfFiles.getById.useQuery({ id: fileId });

  const updateAnnotationsMutation = trpc.pdfFiles.updateAnnotations.useMutation({
    onError: () => {
      toast.error("Failed to save annotations");
    },
  });

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
            setAnnotations(JSON.parse(file.annotations));
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

  // Render current page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    const renderPage = async () => {
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current!;
      const context = canvas.getContext("2d")!;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      await page.render(renderContext).promise;

      // Render annotations for current page
      const pageAnnotations = annotations.filter((a) => a.pageNumber === currentPage);
      pageAnnotations.forEach((annotation) => {
        if (annotation.type === "highlight") {
          context.fillStyle = "rgba(255, 255, 0, 0.3)";
          context.fillRect(
            annotation.data.x,
            annotation.data.y,
            annotation.data.width,
            annotation.data.height
          );
        } else if (annotation.type === "pen") {
          context.strokeStyle = annotation.data.color || "#000";
          context.lineWidth = annotation.data.width || 2;
          context.beginPath();
          annotation.data.points.forEach((point: any, index: number) => {
            if (index === 0) {
              context.moveTo(point.x, point.y);
            } else {
              context.lineTo(point.x, point.y);
            }
          });
          context.stroke();
        }
      });
    };

    renderPage();
  }, [pdfDoc, currentPage, scale, annotations]);

  // Save annotations
  const saveAnnotations = () => {
    updateAnnotationsMutation.mutate({
      id: fileId,
      annotations: JSON.stringify(annotations),
    });
  };

  useEffect(() => {
    if (annotations.length > 0) {
      const timeout = setTimeout(saveAnnotations, 1000);
      return () => clearTimeout(timeout);
    }
  }, [annotations]);

  // Canvas interaction handlers
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === "none") return;
    setIsDrawing(true);

    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (tool === "pen") {
      setAnnotations((prev) => [
        ...prev,
        {
          type: "pen",
          pageNumber: currentPage,
          data: { points: [{ x, y }], color: "#000", width: 2 },
        },
      ]);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || tool === "none") return;

    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (tool === "pen") {
      setAnnotations((prev) => {
        const newAnnotations = [...prev];
        const lastAnnotation = newAnnotations[newAnnotations.length - 1];
        if (lastAnnotation && lastAnnotation.type === "pen") {
          lastAnnotation.data.points.push({ x, y });
        }
        return newAnnotations;
      });
    }
  };

  const handleCanvasMouseUp = () => {
    setIsDrawing(false);
  };

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

  const chatMutation = trpc.chat.sendMessage.useMutation({
    onSuccess: (data) => {
      setChatMessages((prev) => [...prev, { role: "assistant", content: data.message }]);
    },
    onError: (error) => {
      toast.error(`Chat error: ${error.message}`);
    },
  });

  const sendChatMessage = () => {
    if (!chatInput.trim()) return;
    const userMessage = chatInput;
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    
    chatMutation.mutate({
      fileId,
      messages: [...chatMessages, { role: "user", content: userMessage }],
      systemPrompt,
    });
  };

  if (!file) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation(`/module/${file.moduleId}`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="font-semibold">{file.fileName}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={tool === "highlight" ? "default" : "outline"}
            size="icon"
            onClick={() => setTool(tool === "highlight" ? "none" : "highlight")}
          >
            <Highlighter className="h-4 w-4" />
          </Button>
          <Button
            variant={tool === "pen" ? "default" : "outline"}
            size="icon"
            onClick={() => setTool(tool === "pen" ? "none" : "pen")}
          >
            <Pen className="h-4 w-4" />
          </Button>
          <div className="h-6 w-px bg-border mx-2" />
          <Button variant="outline" size="icon" onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground min-w-[60px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button variant="outline" size="icon" onClick={() => setScale((s) => Math.min(3, s + 0.25))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* PDF Viewer - 2/3 */}
        <div className="w-2/3 border-r overflow-auto bg-slate-50 dark:bg-slate-900" ref={containerRef}>
          <div className="p-8 flex justify-center">
            <canvas
              ref={canvasRef}
              className="shadow-lg bg-white cursor-crosshair"
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
            />
          </div>
          {totalPages > 0 && (
            <div className="sticky bottom-4 flex justify-center gap-2 pb-4">
              <Button
                variant="secondary"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <div className="flex items-center px-4 bg-background rounded-md border">
                <span className="text-sm">
                  Page {currentPage} of {totalPages}
                </span>
              </div>
              <Button
                variant="secondary"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </div>

        {/* Right sidebar - 1/3 */}
        <div className="w-1/3 flex flex-col">
          {/* Questions section - top half */}
          <div className="h-1/2 border-b flex flex-col p-4">
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
                className="resize-none"
                rows={2}
              />
            </div>
            <div className="flex-1 overflow-auto space-y-2">
              {questions.map((q) => (
                <Card key={q.id} className="p-3 group relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100"
                    onClick={() => removeQuestion(q.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                  <p className="text-sm pr-8">{q.text}</p>
                </Card>
              ))}
            </div>
          </div>

          {/* Chat section - bottom half */}
          <div className="h-1/2 flex flex-col p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Study Assistant</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)}>
                <Settings className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto space-y-3 mb-3">
              {chatMessages.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  Ask questions about the material
                </div>
              ) : (
                chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground ml-4"
                        : "bg-muted mr-4"
                    }`}
                  >
                    <p className="text-sm">{msg.content}</p>
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
                className="resize-none"
                rows={2}
              />
              <Button size="icon" onClick={sendChatMessage}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assistant Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div>
              <label className="text-sm font-medium mb-2 block">System Prompt</label>
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                placeholder="Customize how the assistant responds..."
              />
            </div>
            <Button onClick={() => setShowSettings(false)} className="w-full">
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

