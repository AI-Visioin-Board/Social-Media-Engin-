import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Play, CheckCircle2, Clock, AlertCircle, Loader2,
  Calendar, BarChart3, Eye, ThumbsUp, Globe, Zap,
  ChevronRight, RotateCcw, Instagram, Sparkles, BookOpen,
  TrendingUp, Shield, Video, Layers, Send, Settings, Info,
  ExternalLink, Download
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip, TooltipContent, TooltipTrigger
} from "@/components/ui/tooltip";

// ─── Types ────────────────────────────────────────────────────────────────────

type RunStatus =
  | "pending" | "discovering" | "scoring" | "researching"
  | "generating" | "assembling" | "review" | "posting"
  | "completed" | "failed";

interface ContentRun {
  id: number;
  runSlot: "monday" | "friday";
  status: RunStatus;
  topicsRaw: string | null;
  topicsShortlisted: string | null;
  topicsSelected: string | null;
  adminApproved: boolean;
  instagramPostId: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ScoredTopic {
  title: string;
  summary: string;
  source: string;
  url: string;
  scores: {
    businessOwnerImpact: number;
    generalPublicRelevance: number;
    viralPotential: number;
    worldImportance: number;
    interestingness: number;
    total: number;
  };
}

interface PublishedTopic {
  id: number;
  title: string;
  summary: string | null;
  publishedAt: Date;
  runId: number;
}

interface GeneratedSlide {
  id: number;
  slideIndex: number;
  headline: string | null;
  summary: string | null;
  videoUrl: string | null;
  assembledUrl: string | null;
  videoPrompt: string | null;
  status: string;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<RunStatus, { label: string; color: string; icon: React.ReactNode; progress: number }> = {
  pending:     { label: "Pending",      color: "bg-slate-100 text-slate-700",   icon: <Clock className="w-3 h-3" />,      progress: 0 },
  discovering: { label: "Discovering",  color: "bg-blue-100 text-blue-700",     icon: <Loader2 className="w-3 h-3 animate-spin" />, progress: 15 },
  scoring:     { label: "Scoring",      color: "bg-violet-100 text-violet-700", icon: <Loader2 className="w-3 h-3 animate-spin" />, progress: 30 },
  researching: { label: "Researching",  color: "bg-amber-100 text-amber-700",   icon: <Loader2 className="w-3 h-3 animate-spin" />, progress: 50 },
  generating:  { label: "Generating",   color: "bg-orange-100 text-orange-700", icon: <Loader2 className="w-3 h-3 animate-spin" />, progress: 65 },
  assembling:  { label: "Assembling",   color: "bg-cyan-100 text-cyan-700",     icon: <Loader2 className="w-3 h-3 animate-spin" />, progress: 80 },
  review:      { label: "Needs Review", color: "bg-yellow-100 text-yellow-800", icon: <Eye className="w-3 h-3" />,        progress: 40 },
  posting:     { label: "Posting",      color: "bg-indigo-100 text-indigo-700", icon: <Loader2 className="w-3 h-3 animate-spin" />, progress: 90 },
  completed:   { label: "Completed",    color: "bg-green-100 text-green-700",   icon: <CheckCircle2 className="w-3 h-3" />, progress: 100 },
  failed:      { label: "Failed",       color: "bg-red-100 text-red-700",       icon: <AlertCircle className="w-3 h-3" />, progress: 0 },
};

const PIPELINE_STEPS = [
  { key: "discovering", label: "Topic Discovery", desc: "Scanning YouTube, TikTok & Reddit" },
  { key: "scoring",     label: "AI Scoring",      desc: "GPT ranks topics on 5 criteria" },
  { key: "review",      label: "Your Review",     desc: "Approve or swap topics" },
  { key: "researching", label: "Deep Research",   desc: "GPT-4o web search verifies each story" },
  { key: "generating",  label: "Video Generation",desc: "Seedance creates B-roll clips" },
  { key: "assembling",  label: "Slide Assembly",  desc: "FFmpeg composites final slides" },
  { key: "posting",     label: "Instagram Post",  desc: "Make.com posts the carousel" },
];

const SCORE_CRITERIA = [
  { key: "businessOwnerImpact",    label: "Business Impact",  icon: <BarChart3 className="w-3.5 h-3.5" />,  color: "text-blue-600" },
  { key: "generalPublicRelevance", label: "Public Relevance", icon: <Globe className="w-3.5 h-3.5" />,      color: "text-green-600" },
  { key: "viralPotential",         label: "Viral Potential",  icon: <TrendingUp className="w-3.5 h-3.5" />, color: "text-pink-600" },
  { key: "worldImportance",        label: "World Impact",     icon: <Shield className="w-3.5 h-3.5" />,     color: "text-purple-600" },
  { key: "interestingness",        label: "Interestingness",  icon: <Sparkles className="w-3.5 h-3.5" />,   color: "text-amber-600" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RunStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function ScoreBar({ value, max = 10 }: { value: number; max?: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all"
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
      <span className="text-xs font-medium text-slate-600 w-4">{value}</span>
    </div>
  );
}

function TopicCard({
  topic,
  index,
  onSwap,
  showScores = true,
}: {
  topic: ScoredTopic;
  index: number;
  onSwap?: (index: number) => void;
  showScores?: boolean;
}) {
  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white hover:border-indigo-200 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-start gap-2">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">
            {index + 1}
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-800 leading-snug">{topic.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">{topic.summary}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant="outline" className="text-xs capitalize">{topic.source}</Badge>
          {topic.url && topic.url !== "#" && (
            <a href={topic.url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-indigo-600">
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {onSwap && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-slate-500 hover:text-red-600" onClick={() => onSwap(index)}>
              <RotateCcw className="w-3 h-3 mr-1" /> Swap
            </Button>
          )}
        </div>
      </div>
      {showScores && (
        <div className="mt-3 grid grid-cols-1 gap-1.5">
          {SCORE_CRITERIA.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <span className={`flex-shrink-0 ${c.color}`}>{c.icon}</span>
              <span className="text-xs text-slate-500 w-28">{c.label}</span>
              <ScoreBar value={(topic.scores as any)[c.key]} />
            </div>
          ))}
          <div className="flex items-center justify-between mt-1 pt-1 border-t border-slate-100">
            <span className="text-xs font-medium text-slate-600">Total Score</span>
            <span className="text-sm font-bold text-indigo-600">{topic.scores.total} / 50</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Swap Topic Dialog ────────────────────────────────────────────────────────

function SwapTopicDialog({
  open,
  onClose,
  topicIndex,
  runId,
  onSwapped,
}: {
  open: boolean;
  onClose: () => void;
  topicIndex: number | null;
  runId: number;
  onSwapped: () => void;
}) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [url, setUrl] = useState("");
  const [source, setSource] = useState("news");

  const swapTopic = trpc.contentStudio.swapTopic.useMutation({
    onSuccess: () => {
      toast.success("Topic swapped successfully!");
      setTitle(""); setSummary(""); setUrl(""); setSource("news");
      onSwapped();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Swap Topic #{(topicIndex ?? 0) + 1}</DialogTitle>
          <DialogDescription>
            Replace this AI-selected topic with your own idea. Your custom topic will go through the full pipeline — GPT-4o will research it using recent sources (last 15 days), then generate a video slide and post it to Instagram, just like any other topic.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs text-slate-600 mb-1 block">Topic Title *</Label>
            <Input
              placeholder="e.g. OpenAI launches GPT-5 with real-time reasoning"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs text-slate-600 mb-1 block">Summary (optional)</Label>
            <Textarea
              placeholder="Brief description of why this topic matters..."
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-600 mb-1 block">Source URL (optional)</Label>
              <Input
                placeholder="https://..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs text-slate-600 mb-1 block">Source Type</Label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="news">News</option>
                <option value="youtube">YouTube</option>
                <option value="reddit">Reddit</option>
                <option value="tiktok">TikTok</option>
              </select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!title.trim() || topicIndex === null) return;
              swapTopic.mutate({
                runId,
                topicIndex,
                newTopic: {
                  title: title.trim(),
                  summary: summary.trim() || "No summary provided.",
                  source,
                  url: url.trim() || "#",
                },
              });
            }}
            disabled={!title.trim() || swapTopic.isPending}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {swapTopic.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-2" />}
            Swap Topic
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Run Detail Dialog ────────────────────────────────────────────────────────

function RunDetailDialog({
  runId,
  open,
  onClose,
}: {
  runId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const [swapDialogOpen, setSwapDialogOpen] = useState(false);
  const [swapTopicIndex, setSwapTopicIndex] = useState<number | null>(null);

  const { data: run, refetch } = trpc.contentStudio.getRun.useQuery(
    { runId: runId! },
    {
      enabled: !!runId,
      refetchInterval: (data) => {
        const status = (data as any)?.status;
        return status && !["completed", "failed", "review"].includes(status) ? 3000 : false;
      },
    }
  );

  const approveTopics = trpc.contentStudio.approveTopics.useMutation({
    onSuccess: () => {
      toast.success("Topics approved! Deep research starting now...");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!run) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const selectedTopics: ScoredTopic[] = run.topicsSelected ? JSON.parse(run.topicsSelected) : [];
  const slides: GeneratedSlide[] = (run as any).slides ?? [];
  const cfg = STATUS_CONFIG[run.status as RunStatus] ?? STATUS_CONFIG.pending;

  const handleSwap = (index: number) => {
    setSwapTopicIndex(index);
    setSwapDialogOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600">
                #{run.id}
              </div>
              <div>
                <DialogTitle className="capitalize">{run.runSlot} Run</DialogTitle>
                <DialogDescription>{new Date(run.createdAt).toLocaleString()}</DialogDescription>
              </div>
              <div className="ml-auto">
                <StatusBadge status={run.status as RunStatus} />
              </div>
            </div>
          </DialogHeader>

          {/* Progress bar + pipeline steps */}
          <div className="px-1">
            <Progress value={cfg.progress} className="h-1.5 mb-2" />
            <div className="flex gap-1 flex-wrap">
              {PIPELINE_STEPS.map((step, i) => {
                const stepOrder = PIPELINE_STEPS.map((s) => s.key);
                const currentIdx = stepOrder.indexOf(run.status);
                const isDone = i < currentIdx || run.status === "completed";
                const isCurrent = step.key === run.status;
                return (
                  <div key={step.key} className="flex items-center gap-1 flex-shrink-0">
                    <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                      isDone ? "bg-green-100 text-green-700" :
                      isCurrent ? "bg-indigo-100 text-indigo-700 font-medium" :
                      "bg-slate-100 text-slate-400"
                    }`}>
                      {isDone ? <CheckCircle2 className="w-3 h-3" /> : isCurrent ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                      {step.label}
                    </div>
                    {i < PIPELINE_STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-slate-300 flex-shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>

          <Separator />

          <ScrollArea className="flex-1 min-h-0 pr-1">
            <div className="space-y-4">
              {/* Error */}
              {run.status === "failed" && run.errorMessage && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <strong>Error:</strong> {run.errorMessage}
                </div>
              )}

              {/* Discovering / scoring — loading state */}
              {["discovering", "scoring"].includes(run.status) && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
                  <p className="text-sm text-slate-600 font-medium">
                    {run.status === "discovering"
                      ? "Scanning YouTube, TikTok & Reddit for trending AI topics..."
                      : "GPT-4o is scoring and selecting the best 5 topics..."}
                  </p>
                  <p className="text-xs text-slate-400">This usually takes 30–60 seconds</p>
                </div>
              )}

              {/* Topics for review — empty state */}
              {run.status === "review" && selectedTopics.length === 0 && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Topic discovery returned 0 results</p>
                    <p className="text-xs text-amber-700 mt-1">This run had no topics to review. Please start a new run — the pipeline now uses GPT-4o web search as a fallback to find trending AI topics automatically.</p>
                  </div>
                </div>
              )}

              {/* Topics for review */}
              {run.status === "review" && selectedTopics.length > 0 && (
                <div>
                  {/* Sticky approve bar — always visible at top */}
                  <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border border-indigo-100 rounded-xl p-3 mb-4 flex items-center justify-between gap-3 shadow-sm">
                    <div className="flex items-center gap-2">
                      <Eye className="w-4 h-4 text-amber-500" />
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{selectedTopics.length} topics ready for review</p>
                        <p className="text-xs text-slate-500">Swap any topic or approve all to start deep research</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => approveTopics.mutate({ runId: run.id, selectedTopics })}
                      disabled={approveTopics.isPending}
                      className="bg-indigo-600 hover:bg-indigo-700 flex-shrink-0"
                      size="sm"
                    >
                      {approveTopics.isPending
                        ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        : <ThumbsUp className="w-4 h-4 mr-2" />}
                      Approve All
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {selectedTopics.map((topic, i) => (
                      <TopicCard key={i} topic={topic} index={i} showScores={true} onSwap={handleSwap} />
                    ))}
                  </div>
                </div>
              )}

              {/* In-progress: show selected topics */}
              {!["review", "completed", "pending", "discovering", "scoring"].includes(run.status) && selectedTopics.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-800 mb-3">Selected Topics</h3>
                  <div className="space-y-2">
                    {selectedTopics.map((topic, i) => (
                      <TopicCard key={i} topic={topic} index={i} showScores={false} />
                    ))}
                  </div>
                </div>
              )}

              {/* Completed slides */}
              {run.status === "completed" && slides.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <h3 className="text-sm font-semibold text-slate-800">Generated Slides</h3>
                    {run.instagramPostId && (
                      <Badge className="ml-auto bg-green-100 text-green-700 border-green-200 text-xs">
                        <Instagram className="w-3 h-3 mr-1" /> Posted
                      </Badge>
                    )}
                  </div>
                  <div className="space-y-2">
                    {slides.map((slide) => (
                      <div key={slide.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                          {slide.slideIndex === 0 ? "C" : slide.slideIndex}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{slide.headline}</p>
                          {slide.summary && <p className="text-xs text-slate-500 truncate">{slide.summary}</p>}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {slide.videoUrl && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a href={slide.videoUrl} target="_blank" rel="noopener noreferrer">
                                  <Video className="w-3.5 h-3.5 text-slate-400 hover:text-indigo-600" />
                                </a>
                              </TooltipTrigger>
                              <TooltipContent>View B-roll video</TooltipContent>
                            </Tooltip>
                          )}
                          {slide.assembledUrl && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a href={slide.assembledUrl} target="_blank" rel="noopener noreferrer">
                                  <Download className="w-3.5 h-3.5 text-slate-400 hover:text-green-600" />
                                </a>
                              </TooltipTrigger>
                              <TooltipContent>Download assembled slide</TooltipContent>
                            </Tooltip>
                          )}
                          <Badge variant="outline" className={`text-xs ${slide.status === "ready" ? "border-green-200 text-green-700" : "border-slate-200"}`}>
                            {slide.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          <DialogFooter className="pt-2 border-t">
            <Button variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {runId && (
        <SwapTopicDialog
          open={swapDialogOpen}
          onClose={() => setSwapDialogOpen(false)}
          topicIndex={swapTopicIndex}
          runId={runId}
          onSwapped={refetch}
        />
      )}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ContentStudio() {
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: runs = [], refetch: refetchRuns, isLoading } = trpc.contentStudio.getRuns.useQuery(
    { limit: 30 },
    { refetchInterval: 10000 }
  );

  const { data: publishedTopics = [] } = trpc.contentStudio.getPublishedTopics.useQuery(
    { days: 30 }
  );

  const triggerRun = trpc.contentStudio.triggerRun.useMutation({
    onSuccess: (data) => {
      toast.success(`Pipeline started! Run #${data.runId} is now discovering topics.`);
      refetchRuns();
      setSelectedRunId(data.runId);
      setDialogOpen(true);
    },
    onError: (e) => toast.error(`Failed to start pipeline: ${e.message}`),
  });

  const openRun = (runId: number) => {
    setSelectedRunId(runId);
    setDialogOpen(true);
  };

  const completedRuns = (runs as ContentRun[]).filter((r) => r.status === "completed");
  const pendingReview = (runs as ContentRun[]).filter((r) => r.status === "review");
  const inProgress = (runs as ContentRun[]).filter((r) =>
    !["completed", "failed", "pending", "review"].includes(r.status)
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Instagram className="w-6 h-6 text-pink-500" />
            Content Studio
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Automated AI news carousel pipeline — posts every Monday &amp; Friday
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => triggerRun.mutate({ runSlot: "monday", requireApproval: true })}
            disabled={triggerRun.isPending}
          >
            {triggerRun.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Monday Run
          </Button>
          <Button
            onClick={() => triggerRun.mutate({ runSlot: "friday", requireApproval: true })}
            disabled={triggerRun.isPending}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {triggerRun.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Friday Run
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Runs",   value: (runs as ContentRun[]).length, icon: <Calendar className="w-4 h-4 text-slate-500" />,    color: "text-slate-700" },
          { label: "Completed",    value: completedRuns.length,          icon: <CheckCircle2 className="w-4 h-4 text-green-500" />, color: "text-green-700" },
          { label: "Needs Review", value: pendingReview.length,          icon: <Eye className="w-4 h-4 text-amber-500" />,         color: "text-amber-700" },
          { label: "In Progress",  value: inProgress.length,             icon: <Loader2 className="w-4 h-4 text-indigo-500" />,    color: "text-indigo-700" },
        ].map((stat) => (
          <Card key={stat.label} className="border-slate-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">{stat.label}</span>
                {stat.icon}
              </div>
              <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="runs">
        <TabsList className="mb-4">
          <TabsTrigger value="runs">Pipeline Runs</TabsTrigger>
          <TabsTrigger value="topics">
            Published Topics
            {(publishedTopics as PublishedTopic[]).length > 0 && (
              <span className="ml-1.5 bg-slate-200 text-slate-600 text-xs rounded-full px-1.5">
                {(publishedTopics as PublishedTopic[]).length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="setup">Setup Guide</TabsTrigger>
        </TabsList>

        {/* ── Runs Tab ── */}
        <TabsContent value="runs">
          {pendingReview.length > 0 && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-800">
                  {pendingReview.length} run{pendingReview.length > 1 ? "s" : ""} waiting for your topic approval
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-amber-300 text-amber-700 hover:bg-amber-100"
                onClick={() => openRun(pendingReview[0].id)}
              >
                Review Now <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : (runs as ContentRun[]).length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
              <Instagram className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-medium">No runs yet</p>
              <p className="text-sm text-slate-400 mt-1 mb-4">
                Click "Monday Run" or "Friday Run" to start your first pipeline
              </p>
              <Button
                size="sm"
                onClick={() => triggerRun.mutate({ runSlot: "monday", requireApproval: true })}
                disabled={triggerRun.isPending}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                <Play className="w-3.5 h-3.5 mr-1.5" /> Start First Run
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {(runs as ContentRun[]).map((run) => (
                <div
                  key={run.id}
                  className="flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-lg hover:border-indigo-200 cursor-pointer transition-colors group"
                  onClick={() => openRun(run.id)}
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600">
                    #{run.id}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 capitalize">{run.runSlot} Run</span>
                      <StatusBadge status={run.status as RunStatus} />
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {new Date(run.createdAt).toLocaleString()}
                      {run.instagramPostId && (
                        <span className="ml-2 text-green-600 inline-flex items-center gap-0.5">
                          <Instagram className="w-3 h-3" /> Posted
                        </span>
                      )}
                    </p>
                  </div>
                  {!["completed", "failed"].includes(run.status) && (
                    <Progress value={STATUS_CONFIG[run.status as RunStatus]?.progress ?? 0} className="w-24 h-1.5" />
                  )}
                  <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0 group-hover:text-indigo-500 transition-colors" />
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Published Topics Tab ── */}
        <TabsContent value="topics">
          <div className="mb-3 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-slate-500" />
            <span className="text-sm text-slate-600">
              Topics published in the last 30 days — the pipeline automatically avoids repeating these.
            </span>
          </div>
          {(publishedTopics as PublishedTopic[]).length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-lg">
              <p className="text-slate-400 text-sm">No published topics yet — run your first pipeline to populate this list.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(publishedTopics as PublishedTopic[]).map((topic) => (
                <div key={topic.id} className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700">{topic.title}</p>
                    {topic.summary && <p className="text-xs text-slate-400 mt-0.5 truncate">{topic.summary}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-slate-400">{new Date(topic.publishedAt).toLocaleDateString()}</p>
                    <p className="text-xs text-slate-300">Run #{topic.runId}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Setup Guide Tab ── */}
        <TabsContent value="setup">
          <div className="space-y-4">
            {/* API Keys */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  API Keys & Configuration
                </CardTitle>
                <CardDescription>
                  OpenAI and Anthropic keys are active. Only Seedance is needed for full video generation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  {
                    key: "OPENAI_API_KEY",
                    label: "OpenAI (GPT-4o Web Search)",
                    desc: "Stage 4: Real-time web research with citations — replaces Perplexity. Already configured.",
                    link: "https://platform.openai.com/api-keys",
                    linkLabel: "platform.openai.com",
                    active: true,
                  },
                  {
                    key: "ANTHROPIC_API_KEY",
                    label: "Anthropic (Claude — Topic Scoring)",
                    desc: "Stage 3: Scores and selects the top 5 topics from candidates. Already configured.",
                    link: "https://console.anthropic.com/",
                    linkLabel: "console.anthropic.com",
                    active: true,
                  },
                  {
                    key: "SEEDANCE_API_KEY",
                    label: "Seedance 2.0 (ByteDance VolcEngine)",
                    desc: "Stage 5: AI video B-roll generation. US availability limited — check volcengine.com.",
                    link: "https://www.volcengine.com/",
                    linkLabel: "Get key at volcengine.com",
                    active: false,
                  },
                  {
                    key: "MAKE_WEBHOOK_URL",
                    label: "Make.com Instagram Webhook",
                    desc: "Stage 7: Triggers your Make.com scenario to post the carousel to @suggestedbygpt. Already configured.",
                    link: "https://www.make.com/",
                    linkLabel: "Set up at make.com",
                    active: true,
                  },
                ].map((item: any) => (
                  <div key={item.key} className={`flex items-start gap-3 p-3 border rounded-lg ${
                    item.active ? "border-green-200 bg-green-50" : "border-slate-200"
                  }`}>
                    <div className={`flex-shrink-0 w-2 h-2 rounded-full mt-1.5 ${
                      item.active ? "bg-green-500" : "bg-amber-400"
                    }`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">{item.key}</code>
                        <span className={`text-xs font-medium ${
                          item.active ? "text-green-600" : "text-amber-600"
                        }`}>{item.active ? "✓ Active" : "Needed"}</span>
                        <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline flex items-center gap-0.5">
                          {item.linkLabel} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Pipeline Overview */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  Pipeline Overview
                </CardTitle>
                <CardDescription>7-stage fully automated content production workflow</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {PIPELINE_STEPS.map((step, i) => (
                    <div key={step.key} className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium text-slate-700">{step.label}</p>
                        <p className="text-xs text-slate-400">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Slide Format */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Video className="w-4 h-4" />
                  Slide Format (evolving.ai style)
                </CardTitle>
                <CardDescription>Split-screen vertical video carousel — 1080×1920 MP4</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Each Post</p>
                    {[
                      "6 slides: 1 cover + 5 content slides",
                      "1080×1920 vertical MP4 format",
                      "5 seconds per slide at 30fps",
                    ].map((item) => (
                      <div key={item} className="flex items-center gap-2 text-xs text-slate-600">
                        <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
                        {item}
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Each Slide</p>
                    {[
                      "Top 45%: black bg + white headline text",
                      "Bottom 55%: Seedance B-roll video",
                      "Brand watermark + slide counter",
                    ].map((item) => (
                      <div key={item} className="flex items-center gap-2 text-xs text-slate-600">
                        <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* No-Repeat Logic */}
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="p-4">
                <div className="flex items-start gap-2">
                  <Zap className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">No-Repeat Logic Active</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      The pipeline automatically tracks all published topics for 14 days and excludes them from future runs.
                      Monday and Friday posts will always cover different stories.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Make.com Setup */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Send className="w-4 h-4" />
                  Make.com Instagram Setup
                </CardTitle>
                <CardDescription>Configure your Make.com scenario to receive slide URLs and post to Instagram</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  {[
                    "Create a new scenario in Make.com",
                    "Add a Webhook trigger module — copy the webhook URL",
                    "Add an Instagram for Business module → Create a Carousel Post",
                    "Map payload: slides[].url → media URLs, caption → post caption",
                    "Paste the webhook URL as MAKE_WEBHOOK_URL in Settings → Secrets",
                  ].map((text, i) => (
                    <div key={i} className="flex items-start gap-3 text-xs text-slate-600">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-200 text-slate-600 font-bold flex items-center justify-center text-xs">{i + 1}</span>
                      {text}
                    </div>
                  ))}
                </div>
                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                  <p className="text-xs font-mono text-slate-600">
                    Webhook payload shape:<br />
                    {"{ runId, caption, slides: [{ url, headline }], scheduledFor }"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Run Detail Dialog */}
      <RunDetailDialog
        runId={selectedRunId}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
