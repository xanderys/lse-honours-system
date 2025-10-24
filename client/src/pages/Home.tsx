import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { BookOpen, Brain, Highlighter } from "lucide-react";

export default function Home() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="container max-w-6xl py-20">
        <div className="text-center mb-16">
          <h1 className="text-6xl font-bold tracking-tight mb-6 bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
            LSE Honours Study System
          </h1>
          <p className="text-xl text-slate-300 mb-8 max-w-2xl mx-auto">
            Your intelligent companion for mastering Economics at LSE. Organize lecture slides, annotate PDFs, and study smarter with AI assistance.
          </p>
          <Button size="lg" onClick={() => setLocation("/modules")} className="text-lg px-8 py-6">
            Get Started
          </Button>
        </div>

        <div className="grid md:grid-cols-3 gap-8 mt-20">
          <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-6">
            <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center mb-4">
              <BookOpen className="h-6 w-6 text-blue-400" />
            </div>
            <h3 className="text-xl font-semibold mb-2 text-white">Organize by Module</h3>
            <p className="text-slate-400">
              Create custom modules for each subject and upload your lecture slides with drag-and-drop simplicity.
            </p>
          </div>

          <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-6">
            <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center mb-4">
              <Highlighter className="h-6 w-6 text-violet-400" />
            </div>
            <h3 className="text-xl font-semibold mb-2 text-white">Deep Focus Mode</h3>
            <p className="text-slate-400">
              Annotate PDFs with highlights and pen tools. Your changes are saved automatically and persist across sessions.
            </p>
          </div>

          <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-6">
            <div className="w-12 h-12 rounded-lg bg-pink-500/10 flex items-center justify-center mb-4">
              <Brain className="h-6 w-6 text-pink-400" />
            </div>
            <h3 className="text-xl font-semibold mb-2 text-white">AI Study Assistant</h3>
            <p className="text-slate-400">
              Ask questions about your lecture material with a RAG-powered chatbot that understands your PDFs.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
