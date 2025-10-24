import { useCallback, useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Upload, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function ModuleFiles() {
  const { id } = useParams<{ id: string }>();
  const moduleId = parseInt(id);
  const [, setLocation] = useLocation();
  const [uploading, setUploading] = useState(false);

  const utils = trpc.useUtils();
  const { data: modules = [] } = trpc.modules.list.useQuery();
  const { data: files = [], isLoading } = trpc.pdfFiles.listByModule.useQuery({ moduleId });

  const module = modules.find((m) => m.id === moduleId);

  const uploadMutation = trpc.pdfFiles.upload.useMutation({
    onSuccess: () => {
      utils.pdfFiles.listByModule.invalidate({ moduleId });
      toast.success("PDF uploaded successfully");
      setUploading(false);
    },
    onError: (error) => {
      toast.error(`Upload failed: ${error.message}`);
      setUploading(false);
    },
  });

  const deleteMutation = trpc.pdfFiles.delete.useMutation({
    onSuccess: () => {
      utils.pdfFiles.listByModule.invalidate({ moduleId });
      toast.success("PDF deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete PDF");
    },
  });

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.type !== "application/pdf") {
        toast.error("Please upload a PDF file");
        return;
      }

      setUploading(true);

      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        uploadMutation.mutate({
          moduleId,
          fileName: file.name,
          fileData: base64,
        });
      };
      reader.onerror = () => {
        toast.error("Failed to read file");
        setUploading(false);
      };
      reader.readAsDataURL(file);
    },
    [moduleId, uploadMutation]
  );

  const handleDelete = (fileId: number, fileName: string) => {
    if (confirm(`Are you sure you want to delete "${fileName}"?`)) {
      deleteMutation.mutate({ id: fileId });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading files...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container max-w-6xl py-12">
        <div className="mb-8">
          <Button variant="ghost" onClick={() => setLocation("/modules")} className="mb-4 gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Modules
          </Button>
          <div className="flex items-center gap-3 mb-2">
            {module && (
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: module.color }} />
            )}
            <h1 className="text-4xl font-bold tracking-tight">{module?.name || "Module"}</h1>
          </div>
          <p className="text-muted-foreground">Manage your lecture slides</p>
        </div>

        <div className="mb-6">
          <label htmlFor="file-upload">
            <Button asChild disabled={uploading} size="lg" className="gap-2">
              <span>
                <Upload className="h-5 w-5" />
                {uploading ? "Uploading..." : "Upload PDF"}
              </span>
            </Button>
          </label>
          <input
            id="file-upload"
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleFileUpload}
            disabled={uploading}
          />
        </div>

        {files.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <FileText className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No files yet</h3>
              <p className="text-muted-foreground text-center mb-4">
                Upload your first PDF to get started
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {files.map((file) => (
              <Card key={file.id} className="group hover:shadow-lg transition-all">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <h3 className="font-medium truncate">{file.fileName}</h3>
                        <p className="text-xs text-muted-foreground">
                          {(file.fileSize / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      onClick={() => handleDelete(file.id, file.fileName)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setLocation(`/focus/${file.id}`)}
                  >
                    Deep Focus
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

