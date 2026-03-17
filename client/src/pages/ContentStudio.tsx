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
  ChevronRight, ChevronLeft, RotateCcw, Instagram, Sparkles, BookOpen,
  TrendingUp, Shield, Video, Layers, Send, Settings, Info,
  ExternalLink, Download, Maximize2, X, RefreshCw, Music2, Copy
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true if the URL points to a static image (not a video). */
function isImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const clean = url.split("?")[0].toLowerCase();
  return clean.endsWith(".png") || clean.endsWith(".jpg") || clean.endsWith(".jpeg") || clean.endsWith(".webp");
}

// ─── Types ────────────────────────────────────────────────────────────────────

type RunStatus =
  | "pending" | "discovering" | "scoring" | "researching"
  | "generating" | "assembling" | "review" | "pending_post" | "posting"
  | "completed" | "failed";

interface ContentRun {
  id: number;
  runSlot: "monday" | "friday";
  status: RunStatus;
  statusDetail: string | null;
  topicsRaw: string | null;
  topicsShortlisted: string | null;
  topicsSelected: string | null;
  adminApproved: boolean;
  instagramCaption: string | null;
  postApproved: boolean;
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
  // Accept any score field names — legacy runs may use different keys
  scores: Record<string, number>;
}

// Normalize any score field names to the canonical pipeline fields
function normalizeTopicScores(topics: ScoredTopic[]): ScoredTopic[] {
  return topics.map((t) => {
    const s = t.scores as Record<string, number>;
    return {
      ...t,
      scores: {
        shareability:    s.shareability    ?? s.viralPotential        ?? s.generalPublicRelevance ?? 5,
        saveWorthiness:  s.saveWorthiness  ?? s.businessOwnerImpact   ?? 5,
        debatePotential: s.debatePotential ?? s.worldImportance       ?? 5,
        informationGap:  s.informationGap  ?? s.interestingness       ?? 5,
        personalImpact:  s.personalImpact  ?? 5,
        total:           s.total           ?? 70,
      },
    };
  });
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
  isVideoSlide: number;
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
  review:      { label: "Needs Review",  color: "bg-yellow-100 text-yellow-800",  icon: <Eye className="w-3 h-3" />,         progress: 40 },
  pending_post:{ label: "Ready to Post", color: "bg-purple-100 text-purple-700",  icon: <Instagram className="w-3 h-3" />,   progress: 90 },
  posting:     { label: "Posting",       color: "bg-indigo-100 text-indigo-700", icon: <Loader2 className="w-3 h-3 animate-spin" />, progress: 95 },
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
  { key: "pending_post",label: "Your Approval",   desc: "Preview & approve before posting" },
  { key: "posting",     label: "Instagram Post",  desc: "Make.com posts the carousel" },
];

const SCORE_CRITERIA = [
  { key: "shareability",     label: "Shareability (5x)",  icon: <BarChart3 className="w-3.5 h-3.5" />,  color: "text-blue-600" },
  { key: "saveWorthiness",  label: "Save-Worthy (3.5x)", icon: <Globe className="w-3.5 h-3.5" />,      color: "text-green-600" },
  { key: "debatePotential", label: "Debate (2.5x)",      icon: <TrendingUp className="w-3.5 h-3.5" />, color: "text-pink-600" },
  { key: "informationGap",  label: "Info Gap (2x)",       icon: <Shield className="w-3.5 h-3.5" />,     color: "text-purple-600" },
  { key: "personalImpact",  label: "Personal (1x)",       icon: <Sparkles className="w-3.5 h-3.5" />,   color: "text-amber-600" },
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

// ─── CTA Slide Toggle (shown in pending_post section) ─────────────────────────

function CtaSlideToggle({ runId, slides, onUpdate }: { runId: number; slides: GeneratedSlide[]; onUpdate: () => void }) {
  const { data: ctaData } = trpc.contentStudio.getCtaSlide.useQuery();
  const appendCta = trpc.contentStudio.appendCtaSlide.useMutation({
    onSuccess: () => { toast.success("CTA slide added to carousel!"); onUpdate(); },
    onError: (e) => toast.error(e.message),
  });
  const removeCta = trpc.contentStudio.removeCtaSlide.useMutation({
    onSuccess: () => { toast.success("CTA slide removed"); onUpdate(); },
    onError: (e) => toast.error(e.message),
  });

  const hasCta = slides.some(s => s.headline === "CTA_SLIDE");
  const ctaUrl = ctaData?.url;

  if (!ctaUrl) return null;

  return (
    <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg mb-2">
      {ctaUrl && (
        <img src={ctaUrl} alt="CTA slide" className="w-12 h-15 object-cover rounded border border-amber-300" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-800">Sales / CTA Slide</p>
        <p className="text-xs text-amber-600">{hasCta ? "Added as last slide" : "Add your promo slide to the end"}</p>
      </div>
      <Button
        size="sm"
        variant={hasCta ? "destructive" : "outline"}
        className="text-xs"
        disabled={appendCta.isPending || removeCta.isPending}
        onClick={() => hasCta ? removeCta.mutate({ runId }) : appendCta.mutate({ runId })}
      >
        {(appendCta.isPending || removeCta.isPending) ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : hasCta ? "Remove" : "Add to Carousel"}
      </Button>
    </div>
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
  const [editCaption, setEditCaption] = useState<string | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [lightboxSlide, setLightboxSlide] = useState<number | null>(null);
  const [regeneratingSlideId, setRegeneratingSlideId] = useState<number | null>(null);

  const { data: run, refetch } = trpc.contentStudio.getRun.useQuery(
    { runId: runId! },
    {
      enabled: !!runId,
      refetchInterval: (data) => {
        const status = (data as any)?.status;
        return status && !["completed", "failed", "review", "pending_post"].includes(status) ? 3000 : false;
      },
    }
  );

  const reassembleRun = trpc.reassembleRun.useMutation({
    onSuccess: (data) => {
      toast.success(`Re-assembled ${data.updated}/${data.total} slides with text overlays ✅`);
      refetch();
    },
    onError: (e) => toast.error(`Reassemble failed: ${e.message}`),
  });

  const approvePost = trpc.contentStudio.approvePost.useMutation({
    onSuccess: (data) => {
      if (data.posted) {
        toast.success("Posted to Instagram! 🎉");
      } else {
        toast.error("Webhook failed — check your Make.com URL in Setup Guide");
      }
      setEditCaption(null);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const resendWebhook = trpc.contentStudio.resendWebhook.useMutation({
    onSuccess: (data) => {
      if (data.posted) {
        toast.success("Webhook resent to Instagram! 🎉");
      } else {
        toast.error("Webhook failed — check your Make.com scenario is active");
      }
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const approveTopics = trpc.contentStudio.approveTopics.useMutation({
    onSuccess: () => {
      toast.success("Topics approved! Deep research starting now...");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const regenerateSlide = trpc.contentStudio.regenerateSlide.useMutation({
    onSuccess: (data) => {
      toast.success(`Slide ${data.slideIndex === 0 ? "Cover" : data.slideIndex} regenerated!`);
      setRegeneratingSlideId(null);
      refetch();
    },
    onError: (e) => {
      toast.error(`Regeneration failed: ${e.message}`);
      setRegeneratingSlideId(null);
    },
  });

  const { data: musicSuggestion } = trpc.contentStudio.getMusicSuggestion.useQuery(
    { runId: runId! },
    { enabled: !!runId && run?.status === "pending_post", staleTime: 5 * 60 * 1000 }
  );

  if (!run) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Loading run details</DialogTitle>
          </DialogHeader>
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
        <DialogContent className="max-w-5xl w-[90vw] h-[90vh] flex flex-col overflow-hidden">
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

            {/* Live status detail — shows what the pipeline is doing right now */}
            {run.statusDetail && !["completed", "failed"].includes(run.status) && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-md">
                <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin flex-shrink-0" />
                <span className="text-xs text-indigo-700 font-medium truncate">{run.statusDetail}</span>
              </div>
            )}
            {run.statusDetail && run.status === "failed" && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-red-50 border border-red-100 rounded-md">
                <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                <span className="text-xs text-red-700 font-medium truncate">{run.statusDetail}</span>
              </div>
            )}
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
                      onClick={() => approveTopics.mutate({ runId: run.id, selectedTopics: normalizeTopicScores(selectedTopics) })}
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

              {/* Instagram Preview & Approval — pending_post status */}
              {run.status === "pending_post" && (
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-center gap-2 p-3 bg-purple-50 border border-purple-200 rounded-xl">
                    <Instagram className="w-5 h-5 text-purple-600 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-purple-900">Carousel ready for your review</p>
                      <p className="text-xs text-purple-700">Preview all slides and the caption below. Edit the caption if needed, then approve to post.</p>
                    </div>
                  </div>

                  {/* Carousel preview — Interactive with arrows, dots, and lightbox */}
                  {slides.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Carousel Slides ({slides.length})</p>
                        <p className="text-xs text-slate-400">{activeSlide === 0 ? "Cover" : `Slide ${activeSlide}`} · Click any slide to enlarge</p>
                      </div>

                      {/* Main featured slide */}
                      <div className="relative flex items-center gap-3 mb-4">
                        {/* Prev arrow */}
                        <button
                          onClick={() => setActiveSlide(Math.max(0, activeSlide - 1))}
                          disabled={activeSlide === 0}
                          className="flex-shrink-0 w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 disabled:opacity-30 flex items-center justify-center transition-colors"
                        >
                          <ChevronLeft className="w-5 h-5 text-slate-700" />
                        </button>

                        {/* Featured slide — large */}
                        <div
                          className="flex-1 flex justify-center cursor-zoom-in"
                          onClick={() => setLightboxSlide(activeSlide)}
                          title="Click to enlarge"
                        >
                          {(() => {
                            const slide = slides[activeSlide];
                            const src = slide?.assembledUrl || slide?.videoUrl;
                            return (
                              <div className="relative w-[270px] h-[338px] bg-black rounded-2xl overflow-hidden border-2 border-indigo-500 shadow-xl ring-2 ring-indigo-400/30">
                                {src ? (
                                  isImageUrl(src) ? (
                                    <img key={src} src={src} className="w-full h-full object-contain" alt={slide?.headline || "slide"} />
                                  ) : (
                                    <video
                                      key={src}
                                      src={src}
                                      className="w-full h-full object-contain"
                                      autoPlay
                                      muted
                                      playsInline
                                    />
                                  )
                                ) : (
                                  <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center p-4 gap-2">
                                    <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center">
                                      <span className="text-indigo-400 text-sm font-bold">{slide?.slideIndex === 0 ? "C" : slide?.slideIndex}</span>
                                    </div>
                                    <p className="text-white text-xs text-center font-medium leading-tight">{slide?.headline}</p>
                                  </div>
                                )}
                                {/* Enlarge icon */}
                                <div className="absolute top-2 left-2 bg-black/50 rounded-full p-1">
                                  <Maximize2 className="w-3 h-3 text-white" />
                                </div>
                                {/* Slide badge */}
                                <div className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center">
                                  <span className="text-white text-xs font-bold">{slide?.slideIndex === 0 ? "C" : slide?.slideIndex}</span>
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Next arrow */}
                        <button
                          onClick={() => setActiveSlide(Math.min(slides.length - 1, activeSlide + 1))}
                          disabled={activeSlide === slides.length - 1}
                          className="flex-shrink-0 w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 disabled:opacity-30 flex items-center justify-center transition-colors"
                        >
                          <ChevronRight className="w-5 h-5 text-slate-700" />
                        </button>
                      </div>

                      {/* Dot indicators */}
                      <div className="flex justify-center gap-1.5 mb-3">
                        {slides.map((_, i) => (
                          <button
                            key={i}
                            onClick={() => setActiveSlide(i)}
                            className={`w-2 h-2 rounded-full transition-all ${
                              i === activeSlide ? "bg-indigo-500 w-4" : "bg-slate-300 hover:bg-slate-400"
                            }`}
                          />
                        ))}
                      </div>

                      {/* Thumbnail strip with Regenerate buttons */}
                      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent">
                        {slides.map((slide, i) => {
                          const src = slide.assembledUrl || slide.videoUrl;
                          const isRegenerating = regeneratingSlideId === slide.id;
                          return (
                            <div key={slide.id} className="flex-shrink-0 flex flex-col items-center gap-1">
                              {/* Thumbnail */}
                              <button
                                onClick={() => setActiveSlide(i)}
                                className={`relative w-16 h-[80px] rounded-lg overflow-hidden border-2 transition-all ${
                                  i === activeSlide ? "border-indigo-500 shadow-md" : "border-slate-200 hover:border-slate-400 opacity-70 hover:opacity-100"
                                }`}
                              >
                                {isRegenerating ? (
                                  <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center gap-1">
                                    <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                                    <span className="text-[9px] text-indigo-300 font-medium">Regen...</span>
                                  </div>
                                ) : src ? (
                                  isImageUrl(src) ? (
                                    <img src={src} className="w-full h-full object-cover" alt="slide thumbnail" />
                                  ) : (
                                    <video src={src} className="w-full h-full object-cover" muted playsInline />
                                  )
                                ) : (
                                  <div className="w-full h-full bg-slate-800 flex items-center justify-center">
                                    <span className="text-white text-xs font-bold">{slide.slideIndex === 0 ? "C" : slide.slideIndex}</span>
                                  </div>
                                )}
                              </button>
                              {/* Regenerate button */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => {
                                      if (isRegenerating || regeneratingSlideId !== null) return;
                                      setRegeneratingSlideId(slide.id);
                                      regenerateSlide.mutate({ runId: run.id, slideId: slide.id });
                                    }}
                                    disabled={isRegenerating || regeneratingSlideId !== null}
                                    className={`w-16 h-6 rounded text-[10px] font-medium flex items-center justify-center gap-0.5 transition-colors ${
                                      isRegenerating
                                        ? "bg-indigo-100 text-indigo-400 cursor-not-allowed"
                                        : regeneratingSlideId !== null
                                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                        : "bg-slate-100 hover:bg-indigo-100 text-slate-500 hover:text-indigo-600"
                                    }`}
                                  >
                                    {isRegenerating ? (
                                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                    ) : (
                                      <RefreshCw className="w-2.5 h-2.5" />
                                    )}
                                    {isRegenerating ? "..." : "Regen"}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs">
                                  {isRegenerating
                                    ? "Regenerating this slide..."
                                    : regeneratingSlideId !== null
                                    ? "Wait for current regeneration to finish"
                                    : `Re-generate ${slide.slideIndex === 0 ? "cover" : `slide ${slide.slideIndex}`} media + composite`}
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Lightbox */}
                  {lightboxSlide !== null && (() => {
                    const slide = slides[lightboxSlide];
                    const src = slide?.assembledUrl || slide?.videoUrl;
                    return (
                      <div
                        className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
                        onClick={() => setLightboxSlide(null)}
                      >
                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                          {/* Close */}
                          <button
                            onClick={() => setLightboxSlide(null)}
                            className="absolute -top-10 right-0 text-white/80 hover:text-white text-sm flex items-center gap-1"
                          >
                            <X className="w-4 h-4" /> Close
                          </button>
                          {/* Prev */}
                          <button
                            onClick={() => setLightboxSlide(Math.max(0, lightboxSlide - 1))}
                            disabled={lightboxSlide === 0}
                            className="absolute left-[-52px] top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center"
                          >
                            <ChevronLeft className="w-6 h-6 text-white" />
                          </button>
                          {/* Slide — 4:5 ratio matching 1080x1350 Instagram portrait */}
                          <div className="w-[405px] h-[506px] bg-black rounded-3xl overflow-hidden border-4 border-white/20 shadow-2xl">
                            {src ? (
                              isImageUrl(src) ? (
                                <img key={src} src={src} className="w-full h-full object-contain" alt="slide" />
                              ) : (
                                <video
                                  key={src}
                                  src={src}
                                  className="w-full h-full object-contain"
                                  autoPlay
                                  controls
                                  playsInline
                                />
                              )
                            ) : (
                              <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center p-6 gap-3">
                                <span className="text-indigo-400 text-2xl font-bold">{slide?.slideIndex === 0 ? "Cover" : `Slide ${slide?.slideIndex}`}</span>
                                <p className="text-white text-sm text-center leading-relaxed">{slide?.headline}</p>
                              </div>
                            )}
                          </div>
                          {/* Next */}
                          <button
                            onClick={() => setLightboxSlide(Math.min(slides.length - 1, lightboxSlide + 1))}
                            disabled={lightboxSlide === slides.length - 1}
                            className="absolute right-[-52px] top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center"
                          >
                            <ChevronRight className="w-6 h-6 text-white" />
                          </button>
                          {/* Label */}
                          <p className="text-center text-white/60 text-sm mt-3">
                            {slide?.slideIndex === 0 ? "Cover" : `Slide ${slide?.slideIndex}`} · {lightboxSlide + 1} of {slides.length}
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Music Suggestion Card */}
                  {musicSuggestion && (
                    <div className="p-3 bg-gradient-to-r from-slate-900 to-slate-800 border border-slate-700 rounded-xl">
                      <div className="flex items-center gap-2 mb-2">
                        <Music2 className="w-4 h-4 text-purple-400 flex-shrink-0" />
                        <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Recommended Background Track</p>
                        <span className="ml-auto text-[10px] text-slate-500 bg-slate-700 px-1.5 py-0.5 rounded">Add manually in IG</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-white">{musicSuggestion.name}</p>
                          <p className="text-xs text-slate-400">{musicSuggestion.artist}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[10px] bg-purple-900/60 text-purple-300 px-1.5 py-0.5 rounded-full">{musicSuggestion.mood}</span>
                            <span className="text-[10px] text-slate-500">{musicSuggestion.bpm} BPM</span>
                            <span className="text-[10px] text-slate-600">{musicSuggestion.license}</span>
                          </div>
                        </div>
                        <a
                          href={musicSuggestion.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" /> Preview
                        </a>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-2 italic">{musicSuggestion.note}</p>
                    </div>
                  )}

                  {/* Caption editor */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Instagram Caption</p>
                      <button
                        onClick={() => setEditCaption(editCaption !== null ? null : (run.instagramCaption ?? ""))}
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        {editCaption !== null ? "Cancel edit" : "Edit caption"}
                      </button>
                    </div>
                    {editCaption !== null ? (
                      <Textarea
                        value={editCaption}
                        onChange={(e) => setEditCaption(e.target.value)}
                        className="text-sm font-mono min-h-[120px] resize-y"
                        placeholder="Write your Instagram caption..."
                      />
                    ) : (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                          {run.instagramCaption ?? "Caption not generated yet."}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* CTA Slide Toggle */}
                  <CtaSlideToggle runId={run.id} slides={slides} onUpdate={refetch} />

                  {/* Fix text overlays button */}
                  <Button
                    variant="outline"
                    className="w-full border-slate-300 text-slate-600 hover:bg-slate-50 text-sm mb-2"
                    disabled={reassembleRun.isPending}
                    onClick={() => reassembleRun.mutate({ runId: run.id })}
                  >
                    {reassembleRun.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Re-assembling slides...</>
                    ) : (
                      <><RefreshCw className="w-4 h-4 mr-2" /> Fix Text Overlays (Re-assemble)</>
                    )}
                  </Button>
                  {/* Approve to Post button */}
                  <Button
                    className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold py-3 text-base"
                    disabled={approvePost.isPending}
                    onClick={() => approvePost.mutate({
                      runId: run.id,
                      caption: editCaption !== null ? editCaption : (run.instagramCaption ?? ""),
                    })}
                  >
                    {approvePost.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Posting to Instagram...</>
                    ) : (
                      <><Instagram className="w-4 h-4 mr-2" /> Approve & Post to Instagram</>
                    )}
                  </Button>
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
                    <Button
                      size="sm"
                      variant="outline"
                      className={`${run.instagramPostId ? "" : "ml-auto "}text-xs`}
                      disabled={resendWebhook.isPending}
                      onClick={() => resendWebhook.mutate({ runId: run.id })}
                    >
                      {resendWebhook.isPending ? (
                        <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Sending...</>
                      ) : (
                        <><Send className="w-3 h-3 mr-1" /> Resend to Instagram</>
                      )}
                    </Button>
                  </div>
                  {/* Slide thumbnail grid */}
                  <div className="grid grid-cols-5 gap-2 mb-3">
                    {slides.filter(s => s.assembledUrl).map((slide) => (
                      <div key={slide.id} className="relative group cursor-pointer rounded-lg overflow-hidden border border-slate-200 bg-slate-100 aspect-[4/5]"
                        onClick={() => slide.assembledUrl && window.open(slide.assembledUrl, "_blank")}
                      >
                        <img
                          src={slide.assembledUrl!}
                          alt={slide.headline ?? `Slide ${slide.slideIndex}`}
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] font-bold flex items-center justify-center">
                          {slide.slideIndex === 0 ? "C" : slide.slideIndex}
                        </div>
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <a
                            href={slide.assembledUrl!}
                            download={`slide-${slide.slideIndex}.${slide.assembledUrl!.includes(".mp4") ? "mp4" : "png"}`}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-white rounded-full p-1.5 shadow-lg"
                          >
                            <Download className="w-3.5 h-3.5 text-slate-700" />
                          </a>
                        </div>
                        {slide.isVideoSlide === 1 && (
                          <div className="absolute top-1 right-1 bg-indigo-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                            VIDEO
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Caption display (persists after approval) */}
                  {run.instagramCaption && (
                    <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Instagram Caption</h4>
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs h-6 px-2"
                            onClick={() => {
                              navigator.clipboard.writeText(run.instagramCaption!);
                            }}
                          >
                            <Copy className="w-3 h-3 mr-1" /> Copy
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs h-6 px-2"
                            onClick={() => {
                              const blob = new Blob([run.instagramCaption!], { type: "text/plain" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `run-${run.id}-caption.txt`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                          >
                            <Download className="w-3 h-3 mr-1" /> Save
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{run.instagramCaption}</p>
                    </div>
                  )}
                  {/* Download all button */}
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => {
                        slides.filter(s => s.assembledUrl).forEach((slide, i) => {
                          setTimeout(() => {
                            const a = document.createElement("a");
                            a.href = slide.assembledUrl!;
                            a.download = `run-${run.id}-slide-${slide.slideIndex}.${slide.assembledUrl!.includes(".mp4") ? "mp4" : "png"}`;
                            a.click();
                          }, i * 300);
                        });
                      }}
                    >
                      <Download className="w-3 h-3 mr-1" /> Download All Slides
                    </Button>
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

// ─── Kling Credentials Card ─────────────────────────────────────────────────

function KlingCredentialsCard() {
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [saved, setSaved] = useState(false);

  const utils = trpc.useUtils();
  const { data: klingStatus } = trpc.contentStudio.getKlingStatus.useQuery();
  const saveKling = trpc.contentStudio.saveKlingCredentials.useMutation({
    onSuccess: () => {
      setSaved(true);
      setAccessKey("");
      setSecretKey("");
      utils.contentStudio.getKlingStatus.invalidate();
      setTimeout(() => setSaved(false), 3000);
      toast.success("Kling API credentials saved! Video generation is now active.");
    },
    onError: (e) => toast.error(`Failed to save credentials: ${e.message}`),
  });

  const isActive = klingStatus?.active ?? false;

  return (
    <Card className={`border-2 ${isActive ? "border-purple-200 bg-purple-50" : "border-amber-200 bg-amber-50"}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Video className="w-4 h-4 text-purple-600" />
          Kling 2.5 Turbo — AI Video Generation
          <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
            isActive ? "bg-purple-100 text-purple-700" : "bg-amber-100 text-amber-700"
          }`}>
            {isActive ? "✓ Active" : "Not configured"}
          </span>
        </CardTitle>
        <CardDescription>
          {isActive
            ? "Kling 2.5 Turbo is active. Each content slide gets a 5-second AI-generated video clip (~$0.28/clip). Nano Banana images are used as fallback."
            : "Add your Kling API credentials to enable AI video B-roll for content slides. Without keys, Nano Banana images are used instead (free, still looks great)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pricing note */}
        <div className="flex items-start gap-2 p-3 bg-white border border-slate-200 rounded-lg">
          <Info className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-slate-600 space-y-1">
            <p><strong>Cost:</strong> ~$0.28 per 5-second clip (pro mode) · 5 slides × 2 runs/week ≈ <strong>$11/month</strong></p>
            <p><strong>Start with:</strong> $9.79 trial pack (100 units) to test before committing.</p>
            <a href="https://app.klingai.com/global/dev/document-api/quickStart/authorization" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline flex items-center gap-0.5 mt-1">
              Get API keys at klingai.com <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Show confirmation when already saved */}
        {isActive && klingStatus?.maskedKey && (
          <div className="flex items-center gap-2 p-2.5 bg-purple-50 border border-purple-200 rounded-lg">
            <CheckCircle2 className="w-4 h-4 text-purple-600 flex-shrink-0" />
            <p className="text-xs text-purple-700">Credentials saved — Access Key ending in <strong className="font-mono">{klingStatus.maskedKey}</strong>. Enter new keys below to update.</p>
          </div>
        )}

        {/* Credential inputs */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="kling-ak" className="text-xs font-medium text-slate-700">{isActive ? "New Access Key (leave blank to keep current)" : "Access Key"}</Label>
            <div className="relative">
              <Input
                id="kling-ak"
                type={showKeys ? "text" : "password"}
                placeholder="Paste your Kling Access Key"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                className="pr-10 font-mono text-sm"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kling-sk" className="text-xs font-medium text-slate-700">Secret Key</Label>
            <div className="relative">
              <Input
                id="kling-sk"
                type={showKeys ? "text" : "password"}
                placeholder="Paste your Kling Secret Key"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="pr-10 font-mono text-sm"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowKeys(!showKeys)}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
            >
              <Shield className="w-3 h-3" />
              {showKeys ? "Hide keys" : "Show keys"}
            </button>
            <Button
              size="sm"
              disabled={(!isActive && (!accessKey.trim() || !secretKey.trim())) || saveKling.isPending}
              onClick={() => {
                // If active and fields are empty, don't re-save (no-op)
                if (isActive && !accessKey.trim() && !secretKey.trim()) return;
                saveKling.mutate({ accessKey: accessKey.trim(), secretKey: secretKey.trim() });
              }}
              className="ml-auto bg-purple-600 hover:bg-purple-700"
            >
              {saveKling.isPending ? (
                <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Saving...</>
              ) : saved ? (
                <><CheckCircle2 className="w-3 h-3 mr-1.5" /> Saved!</>
              ) : (
                <><Zap className="w-3 h-3 mr-1.5" /> Save & Activate</>
              )}
            </Button>
          </div>
        </div>

        {/* Fallback note */}
        <p className="text-xs text-slate-400 border-t pt-3">
          <strong>Fallback:</strong> When Kling is unavailable, Nano Banana (Google Imagen) generates a cinematic still image for each slide — free and built-in.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Google CSE Credentials Card ─────────────────────────────────────────────

function GoogleCseCredentialsCard() {
  const [apiKey, setApiKey] = useState("");
  const [cseId, setCseId] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [saved, setSaved] = useState(false);

  const utils = trpc.useUtils();
  const { data: cseStatus } = trpc.contentStudio.getGoogleCseStatus.useQuery();
  const saveCse = trpc.contentStudio.saveGoogleCseCredentials.useMutation({
    onSuccess: () => {
      setSaved(true);
      setApiKey("");
      setCseId("");
      utils.contentStudio.getGoogleCseStatus.invalidate();
      setTimeout(() => setSaved(false), 3000);
      toast.success("Google CSE credentials saved! Image search is now active.");
    },
    onError: (e) => toast.error(`Failed to save credentials: ${e.message}`),
  });

  const isActive = cseStatus?.active ?? false;

  return (
    <Card className={`border-2 ${isActive ? "border-blue-200 bg-blue-50" : "border-amber-200 bg-amber-50"}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-600" />
          Google Custom Search — Real Image Sourcing
          <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
            isActive ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
          }`}>
            {isActive ? "✓ Active" : "Not configured"}
          </span>
        </CardTitle>
        <CardDescription>
          {isActive
            ? "Google CSE is active. The pipeline searches for real product/company images before falling back to AI generation. 100 free queries/day."
            : "Add your Google Custom Search credentials to enable real image sourcing for slides. Without it, AI-generated images are used instead (still looks great)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 p-3 bg-white border border-slate-200 rounded-lg">
          <Info className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-slate-600 space-y-1">
            <p><strong>Cost:</strong> Free — 100 queries/day included (plenty for 2 posts/week).</p>
            <p><strong>Fallback chain:</strong> Logo library → Google Image Search → AI generation.</p>
            <a href="https://programmablesearchengine.google.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline flex items-center gap-0.5 mt-1">
              Manage search engine at Google CSE <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {isActive && cseStatus?.maskedKey && (
          <div className="flex items-center gap-2 p-2.5 bg-blue-50 border border-blue-200 rounded-lg">
            <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <p className="text-xs text-blue-700">Credentials saved — API Key ending in <strong className="font-mono">{cseStatus.maskedKey}</strong>. Enter new keys below to update.</p>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cse-key" className="text-xs font-medium text-slate-700">{isActive ? "New API Key (leave blank to keep current)" : "Google API Key"}</Label>
            <Input
              id="cse-key"
              type={showKeys ? "text" : "password"}
              placeholder="Paste your Google Custom Search API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono text-sm"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cse-id" className="text-xs font-medium text-slate-700">Search Engine ID</Label>
            <Input
              id="cse-id"
              type={showKeys ? "text" : "password"}
              placeholder="Paste your Search Engine ID (cx)"
              value={cseId}
              onChange={(e) => setCseId(e.target.value)}
              className="font-mono text-sm"
              autoComplete="off"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowKeys(!showKeys)}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
            >
              <Shield className="w-3 h-3" />
              {showKeys ? "Hide keys" : "Show keys"}
            </button>
            <Button
              size="sm"
              disabled={(!isActive && (!apiKey.trim() || !cseId.trim())) || saveCse.isPending}
              onClick={() => {
                if (isActive && !apiKey.trim() && !cseId.trim()) return;
                saveCse.mutate({ apiKey: apiKey.trim(), cseId: cseId.trim() });
              }}
              className="ml-auto bg-blue-600 hover:bg-blue-700"
            >
              {saveCse.isPending ? (
                <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Saving...</>
              ) : saved ? (
                <><CheckCircle2 className="w-3 h-3 mr-1.5" /> Saved!</>
              ) : (
                <><Zap className="w-3 h-3 mr-1.5" /> Save & Activate</>
              )}
            </Button>
          </div>
        </div>

        <p className="text-xs text-slate-400 border-t pt-3">
          <strong>Fallback:</strong> When Google CSE is unavailable, Nano Banana (Google Imagen) generates a cinematic image for each slide — free and built-in.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── CTA / Sales Slide Settings ─────────────────────────────────────────────

function CtaSlideSettings() {
  const [ctaUrl, setCtaUrl] = useState("");
  const utils = trpc.useUtils();
  const { data: ctaData } = trpc.contentStudio.getCtaSlide.useQuery();
  const saveCta = trpc.contentStudio.saveCtaSlide.useMutation({
    onSuccess: () => {
      toast.success("CTA slide saved! It will appear as an option before posting.");
      setCtaUrl("");
      utils.contentStudio.getCtaSlide.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const currentUrl = ctaData?.url;

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-500" />
          CTA / Sales Slide
          {currentUrl && (
            <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
              ✓ Saved
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Upload a promo/sales image that gets appended as the last slide in your carousel. You can toggle it on/off per run before posting.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {currentUrl && (
          <div className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg border border-slate-200">
            <img src={currentUrl} alt="Current CTA" className="w-16 h-20 object-cover rounded border" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            <div className="flex-1">
              <p className="text-xs font-medium text-slate-700">Current CTA Slide</p>
              <p className="text-xs text-slate-500 truncate">{currentUrl}</p>
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="cta-url" className="text-xs font-medium text-slate-700">
            {currentUrl ? "Replace with new image URL" : "Image URL (public, direct link to PNG/JPG)"}
          </Label>
          <div className="flex gap-2">
            <Input
              id="cta-url"
              placeholder="https://example.com/your-cta-slide.png"
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              className="text-sm"
            />
            <Button
              size="sm"
              disabled={!ctaUrl.trim() || saveCta.isPending}
              onClick={() => saveCta.mutate({ imageUrl: ctaUrl.trim() })}
            >
              {saveCta.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Paste the public URL of your sales slide image. This gets added as the final carousel slide when you toggle it on before approving a post.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Make.com Webhook Card ──────────────────────────────────────────────────

function MakeWebhookCard() {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const utils = trpc.useUtils();

  const { data: webhookStatus } = trpc.contentStudio.getWebhookStatus.useQuery();

  const saveWebhook = trpc.contentStudio.saveWebhookUrl.useMutation({
    onSuccess: () => {
      setWebhookUrl("");
      utils.contentStudio.getWebhookStatus.invalidate();
      toast.success("Webhook URL saved! Auto-posting is now active.");
    },
    onError: (e) => toast.error(`Failed to save: ${e.message}`),
  });

  const testWebhook = trpc.contentStudio.testWebhook.useMutation({
    onSuccess: (data) => {
      setTesting(false);
      if (data.success) {
        toast.success(`Ping sent! Make.com responded with HTTP ${data.statusCode}. Your scenario is connected.`);
      } else {
        toast.error(`Make.com returned HTTP ${data.statusCode}. Check your scenario is active.`);
      }
    },
    onError: (e) => {
      setTesting(false);
      toast.error(`Ping failed: ${e.message}`);
    },
  });

  const isConfigured = webhookStatus?.configured ?? false;

  const PAYLOAD_EXAMPLE = `{
  "type": "carousel_post",
  "instagram_page": "suggestedbygpt",
  "run_id": 42,
  "caption": "5 AI stories that broke the internet this week...",
  "slide_count": 5,
  "has_video": true,
  "slides": [
    {
      "slide_index": 0,
      "media_type": "IMAGE",
      "image_url": "https://cdn.../slide0.png",
      "video_url": "https://cdn.../slide0.png",
      "headline": "OpenAI just released..."
    },
    {
      "slide_index": 1,
      "media_type": "VIDEO",
      "image_url": "https://cdn.../slide1.mp4",
      "video_url": "https://cdn.../slide1.mp4",
      "headline": "Google DeepMind..."
    }
  ],
  "posted_at": "2026-03-05T04:00:00.000Z"
}`;

  return (
    <Card className={`border-2 ${isConfigured ? "border-green-200 bg-green-50" : "border-slate-200"}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="w-4 h-4 text-indigo-600" />
          Make.com Instagram Auto-Post
          <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
            isConfigured ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"
          }`}>
            {isConfigured ? "✓ Connected" : "Not configured"}
          </span>
        </CardTitle>
        <CardDescription>
          {isConfigured
            ? "Webhook is active. Approved carousels will auto-post to Instagram via Make.com."
            : "Paste your Make.com webhook URL to enable fully automated Instagram posting after you approve each carousel."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Status row */}
        {isConfigured && webhookStatus?.maskedUrl && (
          <div className="flex items-center gap-2 p-2.5 bg-green-50 border border-green-200 rounded-lg">
            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
            <p className="text-xs text-green-700 font-mono">{webhookStatus.maskedUrl}</p>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto text-xs h-7 border-green-300 text-green-700 hover:bg-green-100"
              disabled={testing || testWebhook.isPending}
              onClick={() => { setTesting(true); testWebhook.mutate(); }}
            >
              {testWebhook.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Zap className="w-3 h-3 mr-1" />}
              Test Ping
            </Button>
          </div>
        )}

        {/* URL input */}
        <div className="space-y-1.5">
          <Label htmlFor="webhook-url" className="text-xs font-medium text-slate-700">
            {isConfigured ? "Update Webhook URL" : "Make.com Webhook URL"}
          </Label>
          <div className="flex gap-2">
            <Input
              id="webhook-url"
              type="url"
              placeholder="https://hook.make.com/your-webhook-id"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="font-mono text-xs"
            />
            <Button
              onClick={() => saveWebhook.mutate({ webhookUrl })}
              disabled={!webhookUrl.trim() || saveWebhook.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 shrink-0"
            >
              {saveWebhook.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>

        {/* Step-by-step Make.com instructions */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">How to set up your Make.com scenario</p>
          {[
            { step: 1, text: "In Make.com, create a new scenario. Add a Webhooks → Custom webhook trigger. Copy the webhook URL it gives you." },
            { step: 2, text: "Add an Iterator module. Set the array to map(slides, 'slide_index') — this loops over each slide in the payload." },
            { step: 3, text: "Add an Array Aggregator after the Iterator. Set Target Structure → Custom. Map: media_type, image_url, video_url from the iterator output." },
            { step: 4, text: "Add Instagram for Business → Create a Carousel Post. Map: slides array from aggregator, caption from webhook payload." },
            { step: 5, text: "⚠️ Video aspect ratio: Instagram carousel videos must be 4:5 (1080×1350). Add a video conversion step if any slides have media_type = VIDEO." },
            { step: 6, text: "Activate the scenario, then paste the webhook URL above and click Save. Use Test Ping to verify the connection." },
          ].map(({ step, text }) => (
            <div key={step} className="flex items-start gap-3 text-xs text-slate-600">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs">{step}</span>
              {text}
            </div>
          ))}
        </div>

        {/* Payload reference */}
        <div>
          <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">Webhook payload shape (reference)</p>
          <div className="p-3 bg-slate-900 rounded-lg overflow-x-auto">
            <pre className="text-xs text-green-400 font-mono whitespace-pre">{PAYLOAD_EXAMPLE}</pre>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            <strong>media_type</strong> is always <code className="bg-slate-100 px-1 rounded">"IMAGE"</code> or <code className="bg-slate-100 px-1 rounded">"VIDEO"</code>.
            Both <code className="bg-slate-100 px-1 rounded">image_url</code> and <code className="bg-slate-100 px-1 rounded">video_url</code> are always set to the same URL — Make.com uses the correct one based on <code className="bg-slate-100 px-1 rounded">media_type</code>.
          </p>
        </div>

      </CardContent>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ContentStudio() {
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: runs = [], refetch: refetchRuns, isLoading } = trpc.contentStudio.getRuns.useQuery(
    { limit: 30 },
    {
      refetchInterval: (data) => {
        const list = Array.isArray(data) ? data : [];
        // Poll every 3s if any run is actively processing (not in a terminal/waiting state)
        const TERMINAL_STATUSES = ["completed", "failed", "review", "pending_post"];
        const hasActive = list.some((r: any) => !TERMINAL_STATUSES.includes(r.status));
        return hasActive ? 3000 : 30000; // 3s when active, 30s when idle
      },
    }
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
    // Refresh the list immediately so the badge in the background is current
    refetchRuns();
    setSelectedRunId(runId);
    setDialogOpen(true);
  };

  const completedRuns = (runs as ContentRun[]).filter((r) => r.status === "completed");
  const pendingReview = (runs as ContentRun[]).filter((r) => r.status === "review");
  const inProgress = (runs as ContentRun[]).filter((r) =>
    !["completed", "failed", "pending", "review", "pending_post"].includes(r.status)
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
                    {run.statusDetail && !["completed", "failed"].includes(run.status) && (
                      <p className="text-xs text-indigo-500 mt-0.5 truncate max-w-xs animate-pulse">
                        {run.statusDetail}
                      </p>
                    )}
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
            {/* API Keys Status */}
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  API Keys & Configuration
                </CardTitle>
                <CardDescription>
                  OpenAI and Anthropic are active. Add Kling keys for AI video and Google CSE keys for real image sourcing below.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  {
                    key: "OPENAI_API_KEY",
                    label: "OpenAI (GPT-4o Web Search + Cover Image)",
                    desc: "Stage 4: Real-time web research with 15-day recency bias. Stage 5 cover: GPT-4o writes the scroll-stopping image prompt. Already configured.",
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
                    key: "NANO_BANANA",
                    label: "Nano Banana / Imagen (Cover + Fallback Visuals)",
                    desc: "Stage 5: Generates the sci-fi scroll-stopping cover image from all 5 topics. Also used as fallback for content slides when Kling is unavailable. Built-in — no key needed.",
                    link: "https://manus.im",
                    linkLabel: "Built-in via Manus",
                    active: true,
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

            {/* Kling AI Video Credentials */}
            <KlingCredentialsCard />

            {/* Google CSE Image Search Credentials */}
            <GoogleCseCredentialsCard />

            {/* CTA / Sales Slide */}
            <CtaSlideSettings />

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
                      "10 seconds per video slide (5s clip × 2 loops)",
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
            <MakeWebhookCard />
          </div>
        </TabsContent>
      </Tabs>

      {/* Run Detail Dialog */}
      <RunDetailDialog
        runId={selectedRunId}
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          // Immediately refresh the list so status badges are accurate after closing
          refetchRuns();
        }}
      />
    </div>
  );
}
