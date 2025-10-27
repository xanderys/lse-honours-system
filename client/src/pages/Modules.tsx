import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, FolderOpen, Pencil, LayoutGrid, List, ArrowUpDown } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PRESET_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#10b981", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
];

type SortOption = "name" | "created" | "modified";
type ViewMode = "grid" | "list";

export default function Modules() {
  const [, setLocation] = useLocation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [moduleName, setModuleName] = useState("");
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  
  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameModuleId, setRenameModuleId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameColor, setRenameColor] = useState(PRESET_COLORS[0]);

  // View and sort state with localStorage persistence
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    const saved = localStorage.getItem("modules-sort");
    return (saved as SortOption) || "name";
  });
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("modules-view");
    return (saved as ViewMode) || "grid";
  });

  const utils = trpc.useUtils();
  const { data: modules = [], isLoading } = trpc.modules.list.useQuery();

  const createMutation = trpc.modules.create.useMutation({
    onSuccess: () => {
      utils.modules.list.invalidate();
      setIsDialogOpen(false);
      setModuleName("");
      setSelectedColor(PRESET_COLORS[0]);
      toast.success("Module created successfully");
    },
    onError: () => {
      toast.error("Failed to create module");
    },
  });

  const renameMutation = trpc.modules.update.useMutation({
    onSuccess: () => {
      utils.modules.list.invalidate();
      setRenameDialogOpen(false);
      toast.success("Module renamed successfully");
    },
    onError: () => {
      toast.error("Failed to rename module");
    },
  });

  const deleteMutation = trpc.modules.delete.useMutation({
    onSuccess: () => {
      utils.modules.list.invalidate();
      toast.success("Module deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete module");
    },
  });

  const handleCreate = () => {
    if (!moduleName.trim()) {
      toast.error("Please enter a module name");
      return;
    }
    createMutation.mutate({ name: moduleName, color: selectedColor });
  };

  const handleRename = () => {
    if (!renameValue.trim()) {
      toast.error("Please enter a module name");
      return;
    }
    if (renameModuleId === null) return;
    renameMutation.mutate({ id: renameModuleId, name: renameValue, color: renameColor });
  };

  const openRenameDialog = (id: number, currentName: string, currentColor: string) => {
    setRenameModuleId(id);
    setRenameValue(currentName);
    setRenameColor(currentColor);
    setRenameDialogOpen(true);
  };

  const handleDelete = (id: number, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"? This will also delete all associated PDF files.`)) {
      deleteMutation.mutate({ id });
    }
  };

  // Handle sort change
  const handleSortChange = (newSort: SortOption) => {
    setSortBy(newSort);
    localStorage.setItem("modules-sort", newSort);
  };

  // Handle view mode change
  const handleViewModeChange = (newView: ViewMode) => {
    setViewMode(newView);
    localStorage.setItem("modules-view", newView);
  };

  // Sort modules based on selected option
  const sortedModules = [...modules].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "created":
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case "modified":
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      default:
        return 0;
    }
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading modules...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container max-w-6xl py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Study Modules</h1>
            <p className="text-muted-foreground mt-2">Organize your lecture slides by module</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Sort dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="lg" className="gap-2">
                  <ArrowUpDown className="h-4 w-4" />
                  Sort: {sortBy === "name" ? "Name" : sortBy === "created" ? "Created" : "Modified"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleSortChange("name")}>
                  Sort by Name
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSortChange("created")}>
                  Sort by Created
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSortChange("modified")}>
                  Sort by Modified
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* View mode toggle */}
            <div className="flex gap-1 border rounded-lg p-1">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => handleViewModeChange("grid")}
                className="h-9 w-9 p-0"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => handleViewModeChange("list")}
                className="h-9 w-9 p-0"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button size="lg" className="gap-2">
                  <Plus className="h-5 w-5" />
                  New Module
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Module</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Module Name</label>
                  <Input
                    placeholder="e.g., Microeconomics"
                    value={moduleName}
                    onChange={(e) => setModuleName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Color</label>
                  <div className="flex gap-2">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        className={`w-10 h-10 rounded-lg transition-all ${
                          selectedColor === color ? "ring-2 ring-offset-2 ring-slate-900 dark:ring-slate-100" : ""
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => setSelectedColor(color)}
                      />
                    ))}
                  </div>
                </div>
                <Button onClick={handleCreate} className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating..." : "Create Module"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {sortedModules.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <FolderOpen className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No modules yet</h3>
              <p className="text-muted-foreground text-center mb-4">
                Create your first module to start organizing your lecture slides
              </p>
            </CardContent>
          </Card>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sortedModules.map((module) => (
              <Card
                key={module.id}
                className="group hover:shadow-lg transition-all cursor-pointer border-2"
                style={{ borderColor: module.color }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: module.color }}
                      />
                      <CardTitle className="text-xl">{module.name}</CardTitle>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          openRenameDialog(module.id, module.name, module.color);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(module.id, module.name);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setLocation(`/module/${module.id}`)}
                  >
                    View Files
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          // List view
          <div className="space-y-3">
            {sortedModules.map((module) => (
              <Card
                key={module.id}
                className="group hover:shadow-md transition-all cursor-pointer border-l-4"
                style={{ borderLeftColor: module.color }}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1">
                      <div
                        className="w-4 h-4 rounded-full flex-shrink-0"
                        style={{ backgroundColor: module.color }}
                      />
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold">{module.name}</h3>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          Created {new Date(module.createdAt).toLocaleDateString()} • 
                          Updated {new Date(module.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setLocation(`/module/${module.id}`)}
                      >
                        View Files
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          openRenameDialog(module.id, module.name, module.color);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(module.id, module.name);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Module</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Module Name</label>
              <Input
                placeholder="Enter new module name"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Color</label>
              <div className="flex gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`w-10 h-10 rounded-lg transition-all ${
                      renameColor === color ? "ring-2 ring-offset-2 ring-slate-900 dark:ring-slate-100" : ""
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setRenameColor(color)}
                  />
                ))}
              </div>
            </div>
            <Button onClick={handleRename} className="w-full" disabled={renameMutation.isPending}>
              {renameMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

