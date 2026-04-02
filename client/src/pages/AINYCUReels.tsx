import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CheckCircle2, Clock, AlertCircle, Loader2,
  Video, RefreshCw, Send, Eye, X,
  Zap, BookOpen, ThumbsUp,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

// ─── Types ──────────────────────────────────────────────────

type RunStatus =
  | "pending" | "topic_discovery" | "topic_review"
  | "scripting" | "generating_assets" | "generating_avatar"
  | "assembling" | "video_review" | "revision"
  | "posting" | "completed" | "failed" | "cancelled";

interface AinycuRun {
  id: number;
  status: RunStatus;
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
  draftDay: number | null;
  finalDay: number | null;
  topicAngle: string | null;
  topicSourceUrl: string | null;
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
  angle: string;
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
  layout: string;
  visualType: string;
  visualPrompt: string;
  captionEmphasis?: string[];
  textCardText?: string;
  sectionMarker?: string;
}

// ─── Status Helpers ─────────────────────────────────────────

const STATUS_CONFIG: Record<RunStatus, { label: string; color: string; icon: typeof Clock }> = {
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

function StatusBadge({ status }: { status: RunStatus }) {
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

function isRunning(status: RunStatus) {
  return ["pending", "topic_discovery", "scripting", "generating_assets", "generating_avatar", "assembling", "revision", "posting"].includes(status);
}

function isReview(status: RunStatus) {
  return ["topic_review", "video_review"].includes(status);
}

const STAGES = ["topic_discovery", "topic_review", "scripting", "generating_assets", "assembling", "video_review"];
function getProgress(status: RunStatus): number {
  const idx = STAGES.indexOf(status);
  if (status === "completed") return 100;
  if (status === "failed" || status === "cancelled") return 0;
  if (idx === -1) return 10;
  return Math.round(((idx + 1) / STAGES.length) * 100);
}

// ─── Main Component ─────────────────────────────────────────

export default function AINYCUReels() {
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("all");

  const runsQuery = trpc.ainycuReels.getRuns.useQuery(undefined, { refetchInterval: 5000 });
  const dayQuery = trpc.ainycuReels.getNextDayNumber.useQuery(undefined, { refetchInterval: 10000 });

  const runDetailQuery = trpc.ainycuReels.getRun.useQuery(
    { runId: selectedRunId! },
    { enabled: !!selectedRunId, refetchInterval: 3000 },
  );

  const triggerMut = trpc.ainycuReels.triggerRun.useMutation({
    onSuccess: (data) => {
      toast.success(`Episode started (Run #${data.runId}, Day ${data.dayNumber})`);
      runsQuery.refetch();
      dayQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const runs = (runsQuery.data ?? []) as unknown as AinycuRun[];
  const nextDay = (dayQuery.data as unknown as number) ?? null;

  const filteredRuns = runs.filter(r => {
    if (activeTab === "all") return true;
    if (activeTab === "running") return isRunning(r.status);
    if (activeTab === "review") return isReview(r.status);
    if (activeTab === "completed") return r.status === "completed";
    if (activeTab === "failed") return r.status === "failed" || r.status === "cancelled";
    return true;
  });

  const total = runs.length;
  const running = runs.filter(r => isRunning(r.status)).length;
  const inReview = runs.filter(r => isReview(r.status)).length;
  const completed = runs.filter(r => r.status === "completed").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="w-6 h-6" style={{ color: "#e89b06" }} />
            AI News You Can Use
          </h1>
          <p className="text-muted-foreground text-sm">
            Educational Reel Series — Next: <span className="font-semibold" style={{ color: "#e89b06" }}>Day {nextDay ?? "..."}</span> of 30
          </p>
        </div>
        <Button
          onClick={() => triggerMut.mutate({})}
          disabled={triggerMut.isPending}
          style={{ backgroundColor: "#e89b06", color: "black" }}
          className="hover:brightness-110"
        >
          {triggerMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
          New Episode (Day {nextDay ?? "?"})
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatsCard title="Episodes" value={total} icon={<Video className="w-4 h-4" />} />
        <StatsCard title="Running" value={running} icon={<Loader2 className="w-4 h-4" />} />
        <StatsCard title="Needs Review" value={inReview} icon={<Eye className="w-4 h-4" />} color="text-yellow-500" />
        <StatsCard title="Posted" value={completed} icon={<CheckCircle2 className="w-4 h-4" />} color="text-green-500" />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All ({total})</TabsTrigger>
          <TabsTrigger value="running">Running ({running})</TabsTrigger>
          <TabsTrigger value="review">Review ({inReview})</TabsTrigger>
          <TabsTrigger value="completed">Posted ({completed})</TabsTrigger>
          <TabsTrigger value="failed">Failed</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {filteredRuns.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No episodes found</CardContent></Card>
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
          run={runDetailQuery.data as AinycuRun | null}
          open={!!selectedRunId}
          onClose={() => setSelectedRunId(null)}
          onRefresh={() => { runsQuery.refetch(); runDetailQuery.refetch(); dayQuery.refetch(); }}
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

// ─── Run Card ───────────────────────────────────────────────

function RunCard({ run, onClick }: { run: AinycuRun; onClick: () => void }) {
  return (
    <Card className="cursor-pointer hover:bg-accent/30 transition-colors" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-mono text-muted-foreground flex-shrink-0">#{run.id}</span>
            {run.draftDay && (
              <Badge variant="outline" className="flex-shrink-0 text-xs font-semibold" style={{ borderColor: "#e89b06", color: "#e89b06" }}>
                Day {run.draftDay}
              </Badge>
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{run.topic || "Discovering topics..."}</p>
              {run.topicAngle && (
                <p className="text-xs text-muted-foreground truncate">{run.topicAngle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <StatusBadge status={run.status} />
            <Progress value={getProgress(run.status)} className="w-20 h-1.5" />
          </div>
        </div>
        {run.statusDetail && (
          <p className="text-xs text-muted-foreground mt-1 ml-8 truncate">{run.statusDetail}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Run Detail Dialog ──────────────────────────────────────

function RunDetailDialog({ run, open, onClose, onRefresh }: {
  run: AinycuRun | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [feedbackText, setFeedbackText] = useState("");

  const approveTopic = trpc.ainycuReels.approveTopic.useMutation({
    onSuccess: () => { toast.success("Topic approved!"); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  const approvePost = trpc.ainycuReels.approvePost.useMutation({
    onSuccess: () => { toast.success("Posted! Day counter advanced."); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  const rejectVideo = trpc.ainycuReels.rejectVideo.useMutation({
    onSuccess: () => { toast.success("Video rejected. Day counter unchanged."); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  const submitFeedback = trpc.ainycuReels.submitFeedback.useMutation({
    onSuccess: () => { toast.success("Revision started!"); setFeedbackText(""); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  const reselectTopics = trpc.ainycuReels.reselectTopics.useMutation({
    onSuccess: () => { toast.success("Re-discovering topics..."); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  const cancelRun = trpc.ainycuReels.cancelRun.useMutation({
    onSuccess: () => { toast.success("Run cancelled"); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  if (!run) return null;

  let script: { beats: Beat[]; totalDurationSec: number; caption: string } | null = null;
  try { script = JSON.parse(run.scriptJson ?? "null"); } catch {}

  let candidates: TopicCandidate[] = [];
  try { candidates = JSON.parse(run.topicCandidates ?? "[]"); } catch {}

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {run.draftDay && (
              <Badge className="text-sm font-bold px-3 py-1" style={{ backgroundColor: "#e89b06", color: "black" }}>
                Day {run.draftDay}
              </Badge>
            )}
            <DialogTitle className="text-lg">{run.topic || "Discovering..."}</DialogTitle>
          </div>
          {run.topicAngle && (
            <p className="text-sm" style={{ color: "#e89b06" }}>🎯 {run.topicAngle}</p>
          )}
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-4">
          <div className="space-y-4">
            {/* Status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusBadge status={run.status} />
                <span className="text-xs text-muted-foreground">{run.statusDetail}</span>
              </div>
              {isRunning(run.status) && (
                <Button variant="ghost" size="sm" onClick={() => cancelRun.mutate({ runId: run.id })}>
                  <X className="w-3 h-3 mr-1" /> Cancel
                </Button>
              )}
            </div>

            {run.errorMessage && (
              <div className="p-2 rounded bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 text-xs">
                {run.errorMessage}
              </div>
            )}

            <Progress value={getProgress(run.status)} className="h-2" />

            {/* Topic Review */}
            {run.status === "topic_review" && candidates.length > 0 && (
              <Card className="border-2" style={{ borderColor: "#e89b06" }}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm" style={{ color: "#e89b06" }}>Select a Topic for Day {run.draftDay}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {candidates.map((cand, i) => (
                    <div key={i} className="p-3 rounded-lg border hover:bg-accent/30 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{cand.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">{cand.summary}</p>
                          {cand.angle && (
                            <p className="text-xs mt-1" style={{ color: "#e89b06" }}>🎯 {cand.angle}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-muted-foreground">Score: {cand.weightedScore?.toFixed(1)}</span>
                            <Badge variant="outline" className="text-[10px] px-1">{cand.verificationStatus}</Badge>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          disabled={approveTopic.isPending}
                          onClick={() => approveTopic.mutate({ runId: run.id, topicIndex: i })}
                          style={{ backgroundColor: "#e89b06", color: "black" }}
                        >
                          Use This
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => reselectTopics.mutate({ runId: run.id })}
                    disabled={reselectTopics.isPending}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" /> Find New Topics
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Script Preview */}
            {script && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Script — {script.beats?.length} beats, {script.totalDurationSec}s
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {(script.beats ?? []).map((beat) => (
                      <div key={beat.id} className="p-2.5 rounded-md bg-accent/30 text-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-mono text-muted-foreground">#{beat.id}</span>
                          <Badge variant="outline" className="text-[10px] px-1">{beat.layout}</Badge>
                          <Badge variant="outline" className="text-[10px] px-1">{beat.visualType}</Badge>
                          <span className="text-[10px] text-muted-foreground">{beat.durationSec}s</span>
                          {beat.sectionMarker && (
                            <Badge className="text-[10px] px-1" style={{ backgroundColor: "#e89b06", color: "black" }}>
                              {beat.sectionMarker}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm">{beat.narration}</p>
                        <p className="text-[10px] text-muted-foreground mt-1 italic">{beat.visualPrompt}</p>
                      </div>
                    ))}
                  </div>
                  {script.caption && (
                    <div className="mt-3 p-2 rounded bg-accent/20">
                      <p className="text-[10px] font-semibold text-muted-foreground mb-1">Instagram Caption</p>
                      <p className="text-xs whitespace-pre-wrap">{script.caption}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Video Preview */}
            {run.finalVideoUrl && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Video Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <video
                    src={run.finalVideoUrl}
                    controls
                    className="w-full rounded-lg"
                    style={{ maxHeight: "400px" }}
                  />
                </CardContent>
              </Card>
            )}

            {/* Video Review Actions */}
            {run.status === "video_review" && (
              <Card className="border-2" style={{ borderColor: "#e89b06" }}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm" style={{ color: "#e89b06" }}>
                    Review Day {run.draftDay}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Button
                      onClick={() => approvePost.mutate({ runId: run.id })}
                      disabled={approvePost.isPending}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      {approvePost.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                      Approve & Post (→ Day {(run.draftDay ?? 0) + 1})
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => rejectVideo.mutate({ runId: run.id })}
                      disabled={rejectVideo.isPending}
                    >
                      <X className="w-4 h-4 mr-1" />
                      Reject (keeps Day {run.draftDay})
                    </Button>
                  </div>

                  <div>
                    <Textarea
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder="Feedback for revision..."
                      className="text-sm"
                      rows={3}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      disabled={!feedbackText.trim() || submitFeedback.isPending}
                      onClick={() => submitFeedback.mutate({ runId: run.id, feedback: feedbackText.trim() })}
                    >
                      {submitFeedback.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                      Send Feedback & Revise
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Completed */}
            {run.status === "completed" && (
              <Card className="border-green-600">
                <CardContent className="p-4 space-y-3">
                  {run.finalDay ? (
                    <p className="text-green-600 font-semibold">
                      ✅ Day {run.finalDay} — Approved & Posted
                    </p>
                  ) : (
                    <p className="font-semibold" style={{ color: "#e89b06" }}>
                      Day {run.draftDay} — Assets Ready (not yet approved)
                    </p>
                  )}

                  {/* Approve for Posting — only shows if NOT yet approved */}
                  {!run.finalDay && (
                    <Button
                      onClick={() => approvePost.mutate({ runId: run.id })}
                      disabled={approvePost.isPending}
                      className="w-full text-white font-semibold py-3"
                      style={{ backgroundColor: "#e89b06" }}
                    >
                      {approvePost.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <ThumbsUp className="w-4 h-4 mr-2" />
                      )}
                      Approve for Posting (Day {run.draftDay} → {(run.draftDay ?? 0) + 1})
                    </Button>
                  )}

                  {run.assetMap && run.scriptJson && (
                    <a
                      href={`/api/download-assets/ainycu/${run.id}`}
                      download
                      className="flex items-center justify-center gap-2 w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      Download B-Roll + Script (.zip)
                    </a>
                  )}
                  {run.instagramCaption && (
                    <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{run.instagramCaption}</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
