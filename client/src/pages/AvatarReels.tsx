import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Play, CheckCircle2, Clock, AlertCircle, Loader2,
  Video, Mic, MicOff, RefreshCw, Send, ExternalLink,
  ChevronDown, ChevronUp, Shield, Zap, Eye, X,
  Pencil, Image as ImageIcon, RotateCcw,
  Plus, Trash2, SkipForward, Lightbulb, Rocket, Bookmark,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Types ──────────────────────────────────────────────────

type AvatarRunStatus =
  | "pending" | "topic_discovery" | "topic_review"
  | "scripting" | "generating_assets" | "generating_avatar"
  | "assembling" | "video_review" | "revision"
  | "posting" | "completed" | "failed" | "cancelled";

interface AvatarRun {
  id: number;
  status: AvatarRunStatus;
  statusDetail: string | null;
  topic: string | null;
  topicCandidates: string | null;
  sourceArticles: string | null;
  extractedFacts: string | null;
  verificationStatus: string | null;
  viralityScore: number | null;
  scriptJson: string | null;
  assetMap: string | null;
  assembledVideoUrl: string | null;
  finalVideoUrl: string | null;
  instagramCaption: string | null;
  feedbackHistory: string | null;
  revisionCount: number;
  dayNumber: number | null;
  contentBucket: string | null;
  errorMessage: string | null;
  heygenCreditsUsed: number;
  instagramPostId: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface TopicCandidate {
  title: string;
  url: string;
  weightedScore: number;
  summary: string;
  verificationStatus: string;
  sources: Array<{ url: string; domain: string; title: string; credibilityTier: string }>;
  facts: Array<{ fact: string; sourceUrl: string }>;
  scores: Record<string, number>;
}

interface Beat {
  id: number;
  startSec: number;
  durationSec: number;
  narration: string;
  visualType: string;
  visualPrompt: string;
  captionEmphasis?: string[];
}

interface SuggestedTopic {
  id: number;
  topic: string;
  notes: string | null;
  status: "pending" | "running" | "used" | "skipped";
  avatarRunId: number | null;
  createdAt: string | Date;
}

// ─── Status Helpers ─────────────────────────────────────────

const STATUS_CONFIG: Record<AvatarRunStatus, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: "Pending", color: "bg-gray-500", icon: Clock },
  topic_discovery: { label: "Discovering", color: "bg-blue-500", icon: Loader2 },
  topic_review: { label: "Review Topics", color: "bg-yellow-500", icon: Eye },
  scripting: { label: "Scripting", color: "bg-blue-500", icon: Loader2 },
  generating_assets: { label: "Gen Assets", color: "bg-blue-500", icon: Loader2 },
  generating_avatar: { label: "Gen Avatar", color: "bg-purple-500", icon: Loader2 },
  assembling: { label: "Assembling", color: "bg-blue-500", icon: Loader2 },
  video_review: { label: "Review Video", color: "bg-yellow-500", icon: Eye },
  revision: { label: "Revising", color: "bg-orange-500", icon: RefreshCw },
  posting: { label: "Posting", color: "bg-green-500", icon: Send },
  completed: { label: "Completed", color: "bg-green-600", icon: CheckCircle2 },
  failed: { label: "Failed", color: "bg-red-500", icon: AlertCircle },
  cancelled: { label: "Cancelled", color: "bg-gray-400", icon: X },
};

function StatusBadge({ status }: { status: AvatarRunStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = config.icon;
  const isAnimating = ["topic_discovery", "scripting", "generating_assets", "generating_avatar", "assembling", "revision"].includes(status);
  return (
    <Badge variant="secondary" className={`${config.color} text-white text-xs`}>
      <Icon className={`w-3 h-3 mr-1 ${isAnimating ? "animate-spin" : ""}`} />
      {config.label}
    </Badge>
  );
}

function isRunning(status: AvatarRunStatus) {
  return ["pending", "topic_discovery", "scripting", "generating_assets", "generating_avatar", "assembling", "revision", "posting"].includes(status);
}

function isReview(status: AvatarRunStatus) {
  return ["topic_review", "video_review"].includes(status);
}

// ─── Pipeline Progress ──────────────────────────────────────

const STAGES = ["topic_discovery", "topic_review", "scripting", "generating_assets", "assembling", "video_review"];
function getProgress(status: AvatarRunStatus): number {
  const idx = STAGES.indexOf(status);
  if (status === "completed") return 100;
  if (status === "failed" || status === "cancelled") return 0;
  if (idx === -1) return 10;
  return Math.round(((idx + 1) / STAGES.length) * 100);
}

// ─── Main Component ─────────────────────────────────────────

export default function AvatarReels() {
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("all");

  const runsQuery = trpc.avatarReels.getRuns.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const runDetailQuery = trpc.avatarReels.getRun.useQuery(
    { runId: selectedRunId! },
    { enabled: !!selectedRunId, refetchInterval: 3000 },
  );

  const triggerMut = trpc.avatarReels.triggerRun.useMutation({
    onSuccess: (data) => {
      toast.success(`Reel pipeline started (Run #${data.runId})`);
      runsQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const runs = (runsQuery.data ?? []) as unknown as AvatarRun[];

  // Filter runs by tab
  const filteredRuns = runs.filter(r => {
    if (activeTab === "all") return true;
    if (activeTab === "running") return isRunning(r.status);
    if (activeTab === "review") return isReview(r.status);
    if (activeTab === "completed") return r.status === "completed";
    if (activeTab === "failed") return r.status === "failed" || r.status === "cancelled";
    return true;
  });

  // Stats
  const total = runs.length;
  const running = runs.filter(r => isRunning(r.status)).length;
  const inReview = runs.filter(r => isReview(r.status)).length;
  const completed = runs.filter(r => r.status === "completed").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Avatar Reels</h1>
          <p className="text-muted-foreground text-sm">Quinn AI news reels pipeline</p>
        </div>
        <Button
          onClick={() => triggerMut.mutate({})}
          disabled={triggerMut.isPending}
        >
          {triggerMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Video className="w-4 h-4 mr-2" />}
          New Reel
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatsCard title="Total" value={total} icon={<Video className="w-4 h-4" />} />
        <StatsCard title="Running" value={running} icon={<Loader2 className="w-4 h-4" />} />
        <StatsCard title="Needs Review" value={inReview} icon={<Eye className="w-4 h-4" />} color="text-yellow-500" />
        <StatsCard title="Completed" value={completed} icon={<CheckCircle2 className="w-4 h-4" />} color="text-green-500" />
      </div>

      {/* Suggested Topics Bank */}
      <TopicBank
        onRunTopic={(id) => triggerMut.mutate({ suggestedTopicId: id })}
        isRunning={triggerMut.isPending}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All ({total})</TabsTrigger>
          <TabsTrigger value="running">Running ({running})</TabsTrigger>
          <TabsTrigger value="review">Review ({inReview})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({completed})</TabsTrigger>
          <TabsTrigger value="failed">Failed</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {filteredRuns.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No runs found</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {filteredRuns.map(run => (
                <RunCard key={run.id} run={run} onClick={() => setSelectedRunId(run.id)} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Run Detail Dialog */}
      {selectedRunId && (
        <RunDetailDialog
          run={runDetailQuery.data as AvatarRun | null}
          open={!!selectedRunId}
          onClose={() => setSelectedRunId(null)}
          onRefresh={() => { runsQuery.refetch(); runDetailQuery.refetch(); }}
        />
      )}
    </div>
  );
}

// ─── Stats Card ─────────────────────────────────────────────

function StatsCard({ title, value, icon, color }: { title: string; value: number; icon: React.ReactNode; color?: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className={`text-2xl font-bold ${color ?? ""}`}>{value}</p>
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}

// ─── Topic Bank ─────────────────────────────────────────────

function TopicBank({ onRunTopic, isRunning: parentRunning }: { onRunTopic: (id: number) => void; isRunning: boolean }) {
  const [newTopic, setNewTopic] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const topicsQuery = trpc.avatarReels.getSuggestedTopics.useQuery(undefined, {
    refetchInterval: 10000,
  });

  const addMut = trpc.avatarReels.addSuggestedTopic.useMutation({
    onSuccess: () => {
      toast.success("Topic added to bank");
      setNewTopic("");
      setNewNotes("");
      setShowNotes(false);
      topicsQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const skipMut = trpc.avatarReels.skipSuggestedTopic.useMutation({
    onSuccess: () => topicsQuery.refetch(),
  });

  const deleteMut = trpc.avatarReels.deleteSuggestedTopic.useMutation({
    onSuccess: () => topicsQuery.refetch(),
  });

  const topics = (topicsQuery.data ?? []) as unknown as SuggestedTopic[];
  const pendingTopics = topics.filter(t => t.status === "pending");
  const otherTopics = topics.filter(t => t.status !== "pending");

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-yellow-500" />
            Topic Suggestions
            {pendingTopics.length > 0 && (
              <Badge variant="secondary" className="text-xs">{pendingTopics.length} pending</Badge>
            )}
          </CardTitle>
          <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3">
          {/* Add topic input */}
          <div className="flex gap-2">
            <div className="flex-1 space-y-2">
              <Input
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                placeholder="Suggest a topic to research... e.g. 'Apple's new AI features in iOS 20'"
                className="text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTopic.trim().length >= 3) {
                    addMut.mutate({ topic: newTopic.trim(), notes: newNotes.trim() || undefined });
                  }
                }}
              />
              {showNotes && (
                <Input
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Optional notes: angle, context, why it matters..."
                  className="text-sm text-muted-foreground"
                />
              )}
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setShowNotes(!showNotes)}
                title="Add notes"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                className="h-9"
                disabled={newTopic.trim().length < 3 || addMut.isPending}
                onClick={() => addMut.mutate({ topic: newTopic.trim(), notes: newNotes.trim() || undefined })}
              >
                {addMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {/* Pending topics list */}
          {pendingTopics.length > 0 && (
            <div className="space-y-1.5">
              {pendingTopics.map(topic => (
                <div
                  key={topic.id}
                  className="flex items-center gap-2 p-2 rounded-md bg-accent/30 hover:bg-accent/50 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{topic.topic}</p>
                    {topic.notes && (
                      <p className="text-xs text-muted-foreground truncate">{topic.notes}</p>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={parentRunning}
                          onClick={() => onRunTopic(topic.id)}
                        >
                          <Rocket className="w-3.5 h-3.5 text-green-600" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Research & run this topic</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => skipMut.mutate({ id: topic.id })}
                        >
                          <SkipForward className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Skip this topic</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => deleteMut.mutate({ id: topic.id })}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete</TooltipContent>
                    </Tooltip>
                  </div>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">
                    {new Date(topic.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Used/skipped topics (collapsed) */}
          {otherTopics.length > 0 && (
            <details className="text-xs">
              <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
                {otherTopics.length} used/skipped topics
              </summary>
              <div className="mt-1 space-y-1">
                {otherTopics.map(topic => (
                  <div key={topic.id} className="flex items-center gap-2 p-1.5 rounded opacity-60">
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                      {topic.status}
                    </Badge>
                    <span className="truncate">{topic.topic}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 ml-auto"
                      onClick={() => deleteMut.mutate({ id: topic.id })}
                    >
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </Button>
                  </div>
                ))}
              </div>
            </details>
          )}

          {pendingTopics.length === 0 && otherTopics.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              No topics yet. Suggest topics you want Quinn to cover — they still go through full research verification.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ─── Run Card ───────────────────────────────────────────────

function RunCard({ run, onClick }: { run: AvatarRun; onClick: () => void }) {
  return (
    <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={onClick}>
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusBadge status={run.status} />
          <div>
            <p className="font-medium text-sm">
              {run.dayNumber ? `Day ${run.dayNumber}: ` : ""}
              {run.topic ?? `Run #${run.id}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {run.statusDetail?.slice(0, 80) ?? ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {run.contentBucket && <Badge variant="outline" className="text-xs">{run.contentBucket}</Badge>}
          <span>{new Date(run.createdAt).toLocaleDateString()}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Run Detail Dialog ──────────────────────────────────────

function RunDetailDialog({
  run, open, onClose, onRefresh,
}: {
  run: AvatarRun | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  if (!run) return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StatusBadge status={run.status} />
            <span>{run.topic ?? `Run #${run.id}`}</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4 pb-4">
            {/* Progress Bar */}
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{run.statusDetail}</span>
                <span>{getProgress(run.status)}%</span>
              </div>
              <Progress value={getProgress(run.status)} />
            </div>

            {/* Topic Review Panel */}
            {run.status === "topic_review" && (
              <TopicReviewPanel run={run} onRefresh={onRefresh} />
            )}

            {/* Pipeline Progress Panel */}
            {isRunning(run.status) && run.status !== "topic_discovery" && (
              <PipelineProgressPanel run={run} />
            )}

            {/* Video Review Panel */}
            {run.status === "video_review" && (
              <VideoReviewPanel run={run} onRefresh={onRefresh} />
            )}

            {/* Completed Panel */}
            {run.status === "completed" && (
              <CompletedPanel run={run} />
            )}

            {/* Error Panel */}
            {run.status === "failed" && run.errorMessage && (
              <Card className="border-red-500/50">
                <CardContent className="p-4">
                  <p className="text-red-500 text-sm font-mono">{run.errorMessage}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ─── Topic Review Panel ─────────────────────────────────────

function TopicReviewPanel({ run, onRefresh }: { run: AvatarRun; onRefresh: () => void }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedSources, setExpandedSources] = useState<number | null>(null);
  const [savedIndices, setSavedIndices] = useState<Set<number>>(new Set());

  const approveMut = trpc.avatarReels.approveTopic.useMutation({
    onSuccess: () => { toast.success("Topic approved! Pipeline continuing..."); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });
  const reselectMut = trpc.avatarReels.reselectTopics.useMutation({
    onSuccess: () => { toast.success("Re-discovering topics..."); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });
  const saveMut = trpc.avatarReels.addSuggestedTopic.useMutation({
    onSuccess: (_data, vars) => {
      toast.success("Topic saved to bank!");
      const topic = vars.topic;
      const idx = candidates.findIndex(c => c.title === topic);
      if (idx >= 0) setSavedIndices(prev => new Set(prev).add(idx));
    },
    onError: (err) => toast.error(err.message),
  });

  const candidates: TopicCandidate[] = JSON.parse(run.topicCandidates ?? "[]");

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-sm">Select a Topic</h3>
      <div className="max-h-[50vh] overflow-y-auto space-y-2 pr-1">
        {candidates.map((topic, i) => (
          <Card
            key={i}
            className={`cursor-pointer transition-colors ${selectedIndex === i ? "ring-2 ring-primary" : "hover:bg-accent/30"}`}
            onClick={() => {
              if (selectedIndex === i) {
                // Clicking the already-selected card collapses sources
                setExpandedSources(null);
                setSelectedIndex(-1);
              } else {
                setSelectedIndex(i);
                setExpandedSources(null);
              }
            }}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="font-medium text-sm">{topic.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{topic.summary}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="secondary" className="text-xs">
                    <Zap className="w-3 h-3 mr-1" />
                    {topic.weightedScore?.toFixed(1)}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-xs ${topic.verificationStatus === "verified_3plus" ? "border-green-500 text-green-600" : "border-yellow-500 text-yellow-600"}`}
                  >
                    <Shield className="w-3 h-3 mr-1" />
                    {topic.sources?.length ?? 0} sources
                  </Badge>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`h-6 px-2 text-[11px] ${savedIndices.has(i) ? "text-green-600" : "text-muted-foreground hover:text-foreground"}`}
                        disabled={savedIndices.has(i) || saveMut.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          saveMut.mutate({ topic: topic.title, notes: topic.summary?.slice(0, 200) });
                        }}
                      >
                        <Bookmark className="w-3 h-3 mr-1" />
                        {savedIndices.has(i) ? "Saved" : "Save"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Save to topic bank for later</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {/* Expandable sources — toggle on click */}
              <button
                className="text-xs text-muted-foreground mt-2 flex items-center gap-1 hover:text-foreground"
                onClick={(e) => { e.stopPropagation(); setExpandedSources(expandedSources === i ? null : i); }}
              >
                {expandedSources === i ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {expandedSources === i ? "Hide" : "Show"} sources
              </button>
              {expandedSources === i && topic.sources && (
                <div className="mt-2 space-y-1 max-h-[200px] overflow-y-auto">
                  {topic.sources.map((src, j) => (
                    <a
                      key={j}
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-500 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="w-3 h-3" />
                      <Badge variant={src.credibilityTier === "tier1" ? "default" : "outline"} className="text-[10px] px-1 py-0">
                        {src.credibilityTier === "tier1" ? "Tier 1" : "Other"}
                      </Badge>
                      {src.domain}: {src.title?.slice(0, 60)}
                    </a>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2">
        <Button onClick={() => approveMut.mutate({ runId: run.id, topicIndex: selectedIndex })} disabled={approveMut.isPending || selectedIndex < 0}>
          {approveMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
          Approve Topic
        </Button>
        <Button variant="outline" onClick={() => reselectMut.mutate({ runId: run.id })} disabled={reselectMut.isPending}>
          <RotateCcw className="w-4 h-4 mr-2" />
          Re-discover
        </Button>
      </div>
    </div>
  );
}

// ─── Pipeline Progress Panel ────────────────────────────────

function PipelineProgressPanel({ run }: { run: AvatarRun }) {
  const cancelMut = trpc.avatarReels.cancelRun.useMutation({
    onSuccess: () => toast.success("Pipeline cancelled"),
  });

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            <span className="text-sm">{run.statusDetail}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => cancelMut.mutate({ runId: run.id })}>
            <X className="w-4 h-4 mr-1" />Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Video Review Panel ─────────────────────────────────────

function VideoReviewPanel({ run, onRefresh }: { run: AvatarRun; onRefresh: () => void }) {
  const [caption, setCaption] = useState(run.instagramCaption ?? "");
  const [feedbackText, setFeedbackText] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [editingBeat, setEditingBeat] = useState<{ index: number; type: "broll" | "narration" } | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const recognitionRef = useRef<any>(null);

  const approveMut = trpc.avatarReels.approvePost.useMutation({
    onSuccess: () => { toast.success("Video approved & posting!"); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });
  const feedbackMut = trpc.avatarReels.submitFeedback.useMutation({
    onSuccess: () => { toast.success("Feedback submitted — revising..."); setShowFeedback(false); setFeedbackText(""); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });
  const swapMut = trpc.avatarReels.swapBroll.useMutation({
    onSuccess: () => { toast.success("B-roll swap started..."); setEditingBeat(null); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });
  const narrationMut = trpc.avatarReels.editNarration.useMutation({
    onSuccess: () => { toast.success("Narration edit started (uses HeyGen credits)..."); setEditingBeat(null); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  const script = JSON.parse(run.scriptJson ?? "{}");
  const beats: Beat[] = script.beats ?? [];

  // Speech-to-Text
  const toggleSTT = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition not supported in this browser");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setFeedbackText(prev => (prev ? prev + " " : "") + transcript);
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening]);

  return (
    <div className="space-y-4">
      {/* Video Player */}
      {run.assembledVideoUrl && (
        <Card>
          <CardContent className="p-4">
            <video
              src={run.assembledVideoUrl}
              controls
              className="w-full max-h-[400px] rounded-lg bg-black"
              style={{ aspectRatio: "9/16", maxWidth: "300px", margin: "0 auto", display: "block" }}
            />
          </CardContent>
        </Card>
      )}

      {/* Caption Editor */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Instagram Caption</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            className="text-sm"
          />
        </CardContent>
      </Card>

      {/* Sources Accordion */}
      {run.sourceArticles && (
        <SourcesAccordion sources={JSON.parse(run.sourceArticles)} />
      )}

      {/* Beat Timeline */}
      {beats.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Beat Timeline (click to edit)</CardTitle>
          </CardHeader>
          <CardContent>
            <BeatTimeline
              beats={beats}
              totalDuration={script.totalDurationSec ?? 60}
              onEditBroll={(i) => { setEditingBeat({ index: i, type: "broll" }); setEditPrompt(beats[i]?.visualPrompt ?? ""); }}
              onEditNarration={(i) => { setEditingBeat({ index: i, type: "narration" }); setEditPrompt(beats[i]?.narration ?? ""); }}
            />
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button onClick={() => approveMut.mutate({ runId: run.id, caption })} disabled={approveMut.isPending}>
          {approveMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
          Approve & Post
        </Button>
        <Button variant="outline" onClick={() => setShowFeedback(!showFeedback)}>
          <Pencil className="w-4 h-4 mr-2" />
          Give Feedback
        </Button>
      </div>

      {/* Feedback Dialog */}
      {showFeedback && (
        <Card className="border-orange-500/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Describe what you'd like changed..."
                rows={3}
                className="flex-1 text-sm"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isListening ? "destructive" : "outline"}
                    size="icon"
                    onClick={toggleSTT}
                  >
                    {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isListening ? "Stop listening" : "Speak feedback"}</TooltipContent>
              </Tooltip>
            </div>
            <Button
              size="sm"
              onClick={() => feedbackMut.mutate({ runId: run.id, feedback: feedbackText, fromStt: false })}
              disabled={!feedbackText.trim() || feedbackMut.isPending}
            >
              {feedbackMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              Submit Feedback
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Beat Edit Dialog */}
      {editingBeat && (
        <Dialog open={!!editingBeat} onOpenChange={() => setEditingBeat(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingBeat.type === "broll" ? "Edit B-Roll" : "Edit Narration"} — Beat {editingBeat.index + 1}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {editingBeat.type === "narration" && (
                <p className="text-xs text-yellow-600 bg-yellow-50 p-2 rounded">
                  Narration edits require re-generating the full avatar video (uses HeyGen credits).
                </p>
              )}
              <Textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                rows={4}
                placeholder={editingBeat.type === "broll" ? "Describe the new visual..." : "New narration text..."}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingBeat(null)}>Cancel</Button>
              <Button onClick={() => {
                if (editingBeat.type === "broll") {
                  swapMut.mutate({ runId: run.id, beatIndex: editingBeat.index, newPrompt: editPrompt });
                } else {
                  narrationMut.mutate({ runId: run.id, beatIndex: editingBeat.index, newText: editPrompt });
                }
              }}>
                {editingBeat.type === "broll" ? <ImageIcon className="w-4 h-4 mr-2" /> : <Pencil className="w-4 h-4 mr-2" />}
                {editingBeat.type === "broll" ? "Swap B-Roll" : "Update Narration"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Beat Timeline ──────────────────────────────────────────

function BeatTimeline({
  beats, totalDuration, onEditBroll, onEditNarration,
}: {
  beats: Beat[];
  totalDuration: number;
  onEditBroll: (index: number) => void;
  onEditNarration: (index: number) => void;
}) {
  const [hoveredBeat, setHoveredBeat] = useState<number | null>(null);

  const typeColors: Record<string, string> = {
    named_person: "bg-purple-400",
    product_logo_ui: "bg-blue-400",
    cinematic_concept: "bg-indigo-400",
    generic_action: "bg-green-400",
    data_graphic: "bg-yellow-400",
    screen_capture: "bg-gray-400",
  };

  return (
    <div className="space-y-2">
      {/* Timeline bar */}
      <div className="flex gap-[2px] h-10 rounded overflow-hidden">
        {beats.map((beat, i) => {
          const widthPct = (beat.durationSec / totalDuration) * 100;
          const color = typeColors[beat.visualType] ?? "bg-gray-400";
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <div
                  className={`${color} hover:opacity-80 cursor-pointer transition-opacity relative group`}
                  style={{ width: `${widthPct}%`, minWidth: "20px" }}
                  onMouseEnter={() => setHoveredBeat(i)}
                  onMouseLeave={() => setHoveredBeat(null)}
                >
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white font-bold">
                    {i + 1}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="font-bold text-xs">Beat {i + 1} ({beat.startSec}s-{beat.startSec + beat.durationSec}s)</p>
                <p className="text-xs mt-1">{beat.narration?.slice(0, 100)}</p>
                <p className="text-xs text-muted-foreground mt-1">{beat.visualType}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Edit buttons for hovered/selected beat */}
      {hoveredBeat !== null && (
        <div className="flex gap-2 text-xs">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onEditBroll(hoveredBeat)}>
            <ImageIcon className="w-3 h-3 mr-1" />Edit B-Roll
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onEditNarration(hoveredBeat)}>
            <Pencil className="w-3 h-3 mr-1" />Edit Narration
          </Button>
          <span className="text-muted-foreground self-center">
            Beat {hoveredBeat + 1}: {beats[hoveredBeat]?.narration?.slice(0, 40)}...
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Sources Accordion ──────────────────────────────────────

function SourcesAccordion({ sources }: { sources: Array<{ url: string; domain: string; title: string; credibilityTier: string }> }) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardContent className="p-3">
        <button
          className="flex items-center gap-2 text-sm font-medium w-full"
          onClick={() => setOpen(!open)}
        >
          <Shield className="w-4 h-4 text-green-500" />
          {sources.length} Verified Sources
          {open ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
        </button>
        {open && (
          <div className="mt-2 space-y-1">
            {sources.map((src, i) => (
              <a
                key={i}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-blue-500 hover:underline py-1"
              >
                <Badge variant={src.credibilityTier === "tier1" ? "default" : "outline"} className="text-[10px] px-1 py-0">
                  {src.credibilityTier === "tier1" ? "Tier 1" : "Other"}
                </Badge>
                <span className="font-medium">{src.domain}</span>
                <span className="text-muted-foreground truncate">{src.title?.slice(0, 50)}</span>
                <ExternalLink className="w-3 h-3 ml-auto flex-shrink-0" />
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Completed Panel ────────────────────────────────────────

function CompletedPanel({ run }: { run: AvatarRun }) {
  return (
    <div className="space-y-4">
      {run.finalVideoUrl && (
        <Card>
          <CardContent className="p-4">
            <video
              src={run.finalVideoUrl}
              controls
              className="w-full max-h-[400px] rounded-lg bg-black"
              style={{ aspectRatio: "9/16", maxWidth: "300px", margin: "0 auto", display: "block" }}
            />
          </CardContent>
        </Card>
      )}
      {run.instagramCaption && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm whitespace-pre-wrap">{run.instagramCaption}</p>
          </CardContent>
        </Card>
      )}
      {run.instagramPostId && (
        <p className="text-xs text-muted-foreground">Instagram Post ID: {run.instagramPostId}</p>
      )}
    </div>
  );
}
