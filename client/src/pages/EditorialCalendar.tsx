import { trpc } from "@/lib/trpc";
import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Play,
  Pencil,
  Trash2,
  Instagram,
  Video,
  FileText,
  CalendarDays,
  Upload,
  Send,
  CheckCircle2,
  Film,
  Twitter,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  planned: { label: "Planned", color: "bg-gray-500" },
  discovering: { label: "Discovering", color: "bg-blue-500" },
  scoring: { label: "Scoring", color: "bg-blue-500" },
  researching: { label: "Researching", color: "bg-blue-500" },
  generating: { label: "Generating", color: "bg-yellow-500" },
  assembling: { label: "Assembling", color: "bg-yellow-500" },
  review: { label: "Ready to Review", color: "bg-orange-500" },
  ready_to_review: { label: "Ready to Review", color: "bg-orange-500" },
  ready_to_post: { label: "Ready to Post", color: "bg-cyan-500" },
  pending_post: { label: "Ready to Post", color: "bg-cyan-500" },
  posted: { label: "Posted", color: "bg-green-500" },
  completed: { label: "Posted", color: "bg-green-500" },
  failed: { label: "Failed", color: "bg-red-500" },
};

const POST_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-gray-500" },
  ready: { label: "Ready to Post", color: "bg-cyan-500" },
  posted_ig: { label: "Posted (IG)", color: "bg-green-500" },
  posted_x: { label: "Posted (X)", color: "bg-green-500" },
  posted_yt: { label: "Posted (YT)", color: "bg-green-500" },
  posted_tt: { label: "Posted (TikTok)", color: "bg-green-500" },
  posted_li: { label: "Posted (LinkedIn)", color: "bg-green-500" },
  posted_both: { label: "Posted (IG + X)", color: "bg-green-500" },
};

// ─── Types ──────────────────────────────────────────────────────────────────

type MediaItem = { type: "image" | "video"; url: string; name?: string };

type CalendarEntry = {
  id: number;
  scheduledDate: string;
  contentType: string;
  topicTitle: string | null;
  topicContext: string | null;
  status: string;
  pipelineRunId: number | null;
  pipelineType: string | null;
  notes: string | null;
  uploadedVideoUrl: string | null;
  uploadedVideoName: string | null;
  instagramCaption: string | null;
  postStatus: string | null;
  mediaItems: string | null;        // JSON: MediaItem[]
  targetPlatform: string | null;    // instagram | tiktok | youtube | x | linkedin
  zernioPostId: string | null;
  tweetId?: string | null;
  tweetUrl?: string | null;
  tweetIds?: string | null;
};

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  twitter: "X / Twitter",
  linkedin: "LinkedIn",
};

// Platforms currently connected in Zernio (verified live 2026-05-20):
// instagram, twitter, youtube. LinkedIn + TikTok show but warn until connected.
const CONNECTED_PLATFORMS = new Set(["instagram", "twitter", "youtube"]);

/** Parse the mediaItems JSON column safely. */
function parseMedia(entry: CalendarEntry | null): MediaItem[] {
  if (!entry?.mediaItems) return [];
  try {
    return JSON.parse(entry.mediaItems) as MediaItem[];
  } catch {
    return [];
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function EditorialCalendar() {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalDate, setAddModalDate] = useState("");
  const [editEntry, setEditEntry] = useState<CalendarEntry | null>(null);
  const [detailEntry, setDetailEntry] = useState<CalendarEntry | null>(null);
  const [formType, setFormType] = useState<"carousel" | "reel" | "x_post">("carousel");
  const [formTitle, setFormTitle] = useState("");
  const [formContext, setFormContext] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [captionText, setCaptionText] = useState("");

  const weekStartStr = formatDate(weekStart);
  const { data: entries = [], refetch } = trpc.calendar.getWeek.useQuery(
    { weekStart: weekStartStr },
    { refetchInterval: 10_000 },
  );

  const createEntry = trpc.calendar.create.useMutation({
    onSuccess: () => {
      toast.success("Added to calendar!");
      setAddModalOpen(false);
      resetForm();
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateEntry = trpc.calendar.update.useMutation({
    onSuccess: () => {
      toast.success("Updated!");
      setEditEntry(null);
      resetForm();
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteEntry = trpc.calendar.delete.useMutation({
    onSuccess: () => {
      toast.success("Removed from calendar");
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const triggerEntry = trpc.calendar.trigger.useMutation({
    onSuccess: (data: any) => {
      toast.success(`Pipeline triggered! Run ID: ${data.runId}`);
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const uploadVideo = trpc.calendar.uploadVideo.useMutation({
    onSuccess: (data: any) => {
      toast.success("Video uploaded!");
      refetch();
      // Update detail modal immediately with new video URL (don't wait for refetch)
      if (detailEntry) {
        setDetailEntry({
          ...detailEntry,
          uploadedVideoUrl: data.videoUrl,
          uploadedVideoName: data.entry?.uploadedVideoName ?? detailEntry.uploadedVideoName,
          postStatus: "ready",
        });
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const saveCaption = trpc.calendar.saveCaption.useMutation({
    onSuccess: () => {
      toast.success("Caption saved!");
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const postToInstagram = trpc.calendar.postToInstagram.useMutation({
    onSuccess: (data: any) => {
      if (data.success) {
        toast.success("Posted to Instagram!");
        if (detailEntry) {
          setDetailEntry({ ...detailEntry, postStatus: data.postStatus ?? "posted_ig" });
        }
      } else {
        toast.error("Webhook failed — check Make.com");
      }
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const postToTwitter = trpc.calendar.postToTwitter.useMutation({
    onSuccess: (data: any) => {
      if (data.success) {
        toast.success(`Posted to X/Twitter! Tweet ID: ${data.tweetId}`);
        if (detailEntry) {
          setDetailEntry({ ...detailEntry, postStatus: data.postStatus ?? "posted_x" });
        }
      }
      refetch();
    },
    onError: (e: any) => toast.error(`Twitter post failed: ${e.message}`),
  });

  // ─── Unified media + Zernio publishing ──────────────────────────────────
  const uploadMedia = trpc.calendar.uploadMedia.useMutation({
    onSuccess: (data: any) => {
      toast.success("Media uploaded!");
      if (detailEntry) {
        setDetailEntry({
          ...detailEntry,
          mediaItems: JSON.stringify(data.mediaItems),
          postStatus: "ready",
        });
      }
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removeMedia = trpc.calendar.removeMedia.useMutation({
    onSuccess: (data: any) => {
      if (detailEntry) {
        setDetailEntry({ ...detailEntry, mediaItems: JSON.stringify(data.mediaItems) });
      }
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setPlatform = trpc.calendar.setPlatform.useMutation({
    onSuccess: (data: any) => {
      if (detailEntry) setDetailEntry({ ...detailEntry, targetPlatform: data.targetPlatform });
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const postViaZernio = trpc.calendar.postViaZernio.useMutation({
    onSuccess: (data: any) => {
      const label = PLATFORM_LABELS[data.platform] ?? data.platform;
      toast.success(`Posted to ${label}! (${data.status ?? "published"})`);
      if (detailEntry) {
        const statusMap: Record<string, string> = {
          instagram: "posted_ig", tiktok: "posted_tt", youtube: "posted_yt", x: "posted_x", linkedin: "posted_li",
        };
        setDetailEntry({ ...detailEntry, postStatus: statusMap[data.platform] ?? "posted", zernioPostId: data.zernioPostId ?? null });
      }
      refetch();
    },
    onError: (e: any) => toast.error(`Publish failed: ${e.message}`),
  });

  /** Read multiple files → base64 → uploadMedia. */
  const handleMediaUpload = useCallback((id: number, files: FileList) => {
    const readers = Array.from(files).map(
      (file) =>
        new Promise<{ base64: string; fileName: string; mimeType: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve({
              base64: result.split(",")[1] ?? "",
              fileName: file.name,
              mimeType: file.type || "application/octet-stream",
            });
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        }),
    );
    Promise.all(readers)
      .then((filePayloads) => uploadMedia.mutate({ id, files: filePayloads }))
      .catch(() => toast.error("Failed to read files"));
  }, [uploadMedia]);

  const postXText = trpc.calendar.postXText.useMutation({
    onSuccess: (data: any) => {
      if (data.success) {
        const url = data.tweetUrl ? ` — ${data.tweetUrl}` : "";
        toast.success(`Posted to X!${url}`);
        if (detailEntry) {
          setDetailEntry({ ...detailEntry, postStatus: "posted_x", tweetId: data.tweetId, tweetUrl: data.tweetUrl });
        }
      }
      refetch();
    },
    onError: (e: any) => toast.error(`X post failed: ${e.message}`),
  });

  const postXThread = trpc.calendar.postXThread.useMutation({
    onSuccess: (data: any) => {
      if (data.success) {
        toast.success(`Thread posted to X! (${data.tweetIds.length} tweets)`);
        if (detailEntry) {
          setDetailEntry({ ...detailEntry, postStatus: "posted_x", tweetUrl: data.tweetUrl });
        }
      }
      refetch();
    },
    onError: (e: any) => toast.error(`Thread post failed: ${e.message}`),
  });

  function resetForm() {
    setFormType("carousel");
    setFormTitle("");
    setFormContext("");
    setFormNotes("");
  }

  function openAddModal(date: string) {
    resetForm();
    setAddModalDate(date);
    setAddModalOpen(true);
  }

  function openEditModal(entry: CalendarEntry) {
    setFormType(entry.contentType as "carousel" | "reel" | "x_post");
    setFormTitle(entry.topicTitle ?? "");
    setFormContext(entry.topicContext ?? "");
    setFormNotes(entry.notes ?? "");
    setEditEntry(entry);
  }

  function openDetailModal(entry: CalendarEntry) {
    setCaptionText(entry.instagramCaption ?? "");
    setDetailEntry(entry);
  }

  function handleSubmitAdd() {
    createEntry.mutate({
      scheduledDate: addModalDate,
      contentType: formType,
      topicTitle: formTitle || undefined,
      topicContext: formContext || undefined,
      notes: formNotes || undefined,
    });
  }

  function handleSubmitEdit() {
    if (!editEntry) return;
    updateEntry.mutate({
      id: editEntry.id,
      topicTitle: formTitle || undefined,
      topicContext: formContext || undefined,
      notes: formNotes || undefined,
    });
  }

  const handleFileUpload = useCallback(async (entryId: number, file: File) => {
    if (!file.type.startsWith("video/")) {
      toast.error("Please upload a video file (.mp4, .mov, etc.)");
      return;
    }
    // Express JSON body limit is 200MB; base64 inflates ~33%, so cap at ~140MB
    if (file.size > 140 * 1024 * 1024) {
      toast.error("File too large (max 140MB). Compress the video first.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadVideo.mutate({
        id: entryId,
        videoBase64: base64,
        fileName: file.name,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  }, [uploadVideo]);

  // Build days of the week
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const dateStr = formatDate(date);
    const dayEntries = entries.filter((e: CalendarEntry) => e.scheduledDate === dateStr);
    const isToday = formatDate(new Date()) === dateStr;
    return { date, dateStr, dayEntries, isToday, dayName: DAY_NAMES[i] };
  });

  const monthLabel = weekStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Editorial Calendar</h1>
        </div>
        <div className="text-sm text-muted-foreground">{monthLabel}</div>
      </div>

      {/* Week Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Prev Week
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setWeekStart(getMonday(new Date()))}
        >
          This Week
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
        >
          Next Week <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => (
          <div
            key={day.dateStr}
            className={`min-h-[220px] rounded-lg border p-2 flex flex-col ${
              day.isToday
                ? "border-primary bg-primary/5"
                : "border-border bg-card"
            }`}
          >
            {/* Day Header */}
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-xs font-medium text-muted-foreground">
                  {day.dayName}
                </span>
                <span
                  className={`ml-1.5 text-sm font-semibold ${
                    day.isToday ? "text-primary" : ""
                  }`}
                >
                  {day.date.getDate()}
                </span>
              </div>
              <button
                onClick={() => openAddModal(day.dateStr)}
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted transition-colors"
              >
                <Plus className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>

            {/* Entry Cards */}
            <div className="flex-1 space-y-1.5 overflow-y-auto">
              {day.dayEntries.map((entry: CalendarEntry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  onEdit={() => openEditModal(entry)}
                  onDelete={() => {
                    if (confirm("Remove this from the calendar?")) {
                      deleteEntry.mutate({ id: entry.id });
                    }
                  }}
                  onTrigger={() => triggerEntry.mutate({ id: entry.id })}
                  onOpenDetail={() => openDetailModal(entry)}
                  onFileUpload={handleFileUpload}
                  triggerLoading={triggerEntry.isPending}
                  uploadLoading={uploadVideo.isPending}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Add Modal */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Add Content for{" "}
              {addModalDate &&
                new Date(addModalDate + "T12:00:00").toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Content Type</label>
              <div className="flex gap-2">
                <Button
                  variant={formType === "carousel" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFormType("carousel")}
                >
                  <Instagram className="h-4 w-4 mr-1.5" /> Carousel
                </Button>
                <Button
                  variant={formType === "reel" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFormType("reel")}
                >
                  <Video className="h-4 w-4 mr-1.5" /> Reel
                </Button>
                <Button
                  variant={formType === "x_post" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFormType("x_post")}
                >
                  <Twitter className="h-4 w-4 mr-1.5" /> X Post
                </Button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Topic Title</label>
              <Input
                placeholder="e.g., Wayfair's AI layoffs"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Topic Context (optional)
              </label>
              <Textarea
                placeholder="Additional context or angle for this topic..."
                value={formContext}
                onChange={(e) => setFormContext(e.target.value)}
                rows={2}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Notes (optional)</label>
              <Input
                placeholder="Internal notes..."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAddModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmitAdd} disabled={createEntry.isPending}>
                {createEntry.isPending ? "Adding..." : "Add to Calendar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={!!editEntry} onOpenChange={(open) => !open && setEditEntry(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Topic Title</label>
              <Input
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Topic Context</label>
              <Textarea
                value={formContext}
                onChange={(e) => setFormContext(e.target.value)}
                rows={2}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Notes</label>
              <Input
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditEntry(null)}>
                Cancel
              </Button>
              <Button onClick={handleSubmitEdit} disabled={updateEntry.isPending}>
                {updateEntry.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail / Upload / Post Modal */}
      <Dialog open={!!detailEntry} onOpenChange={(open) => !open && setDetailEntry(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detailEntry?.contentType === "x_post" ? (
                <Twitter className="h-5 w-5" />
              ) : (
                <Film className="h-5 w-5" />
              )}
              {detailEntry?.topicTitle || (detailEntry?.contentType === "x_post" ? "X Post Details" : "Reel Details")}
            </DialogTitle>
          </DialogHeader>
          {detailEntry && (
            <div className="space-y-5">
              {/* Unified Media — images, video, carousel, mixed (not for x_post) */}
              {detailEntry.contentType !== "x_post" && (() => {
                const media = parseMedia(detailEntry);
                // Legacy reel entries: surface the single uploaded video too.
                const legacyVideo = media.length === 0 && detailEntry.uploadedVideoUrl
                  ? [{ type: "video" as const, url: detailEntry.uploadedVideoUrl, name: detailEntry.uploadedVideoName ?? "video" }]
                  : [];
                const shown = media.length > 0 ? media : legacyVideo;
                return (
                  <div>
                    <label className="text-sm font-medium mb-2 block">
                      Media {shown.length > 0 && <span className="text-muted-foreground">({shown.length} {shown.length === 1 ? "item" : "items"} · carousel order)</span>}
                    </label>
                    {shown.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {shown.map((m, i) => (
                          <div key={i} className="relative group rounded-lg overflow-hidden bg-black aspect-[4/5]">
                            {m.type === "video" ? (
                              <video src={m.url} className="w-full h-full object-cover" muted playsInline />
                            ) : (
                              <img src={m.url} className="w-full h-full object-cover" alt={m.name ?? `slide ${i + 1}`} />
                            )}
                            <span className="absolute top-1 left-1 text-[10px] font-bold bg-black/70 text-white rounded px-1.5 py-0.5">
                              {i + 1}{m.type === "video" ? " ▶" : ""}
                            </span>
                            {media.length > 0 && (
                              <button
                                onClick={() => removeMedia.mutate({ id: detailEntry.id, index: i })}
                                className="absolute top-1 right-1 bg-red-500/90 text-white rounded-full h-5 w-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition"
                                title="Remove"
                              >×</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <MediaUploadButton
                      entryId={detailEntry.id}
                      onUpload={handleMediaUpload}
                      loading={uploadMedia.isPending}
                      label={shown.length > 0 ? "Add more media" : "Upload media (images / video / carousel)"}
                      variant={shown.length > 0 ? "outline" : "default"}
                      large={shown.length === 0}
                    />
                  </div>
                );
              })()}

              {/* Platform selector */}
              {detailEntry.contentType !== "x_post" && (
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Publish to</label>
                  <div className="flex flex-wrap gap-2">
                    {(["instagram", "twitter", "youtube", "linkedin", "tiktok"] as const).map((p) => {
                      const active = (detailEntry.targetPlatform ?? "instagram") === p;
                      const connected = CONNECTED_PLATFORMS.has(p);
                      return (
                        <Button
                          key={p}
                          size="sm"
                          variant={active ? "default" : "outline"}
                          onClick={() => setPlatform.mutate({ id: detailEntry.id, platform: p })}
                          disabled={setPlatform.isPending}
                          title={connected ? undefined : "Not connected in Zernio yet"}
                        >
                          {PLATFORM_LABELS[p]}{!connected && " ·"}
                        </Button>
                      );
                    })}
                  </div>
                  {!CONNECTED_PLATFORMS.has(detailEntry.targetPlatform ?? "instagram") && (
                    <p className="text-xs text-orange-400 mt-1.5">
                      {PLATFORM_LABELS[detailEntry.targetPlatform ?? ""]} isn't connected in Zernio yet — connect it in the Zernio dashboard and publishing will light up automatically (no further setup).
                    </p>
                  )}
                </div>
              )}

              {/* Caption / Tweet Text Editor */}
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  {detailEntry.contentType === "x_post" ? "Tweet Text" : "Instagram Caption"}
                </label>
                <Textarea
                  placeholder={
                    detailEntry.contentType === "x_post"
                      ? "Write your tweet..."
                      : "Write the caption for this post..."
                  }
                  value={captionText}
                  onChange={(e) => setCaptionText(e.target.value)}
                  rows={detailEntry.contentType === "x_post" ? 6 : 4}
                  maxLength={detailEntry.contentType === "x_post" ? 280 : undefined}
                />
                {detailEntry.contentType === "x_post" && (
                  <p className="text-xs text-muted-foreground mt-1 text-right">
                    {captionText.length}/280
                  </p>
                )}
                <div className="flex justify-end mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (detailEntry) {
                        saveCaption.mutate({ id: detailEntry.id, caption: captionText });
                      }
                    }}
                    disabled={saveCaption.isPending}
                  >
                    {saveCaption.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>

              {/* Post Status */}
              {detailEntry.postStatus && detailEntry.postStatus !== "draft" && (
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      POST_STATUS_CONFIG[detailEntry.postStatus]?.color ?? "bg-gray-500"
                    }`}
                  />
                  <span className="text-sm">
                    {POST_STATUS_CONFIG[detailEntry.postStatus]?.label ?? detailEntry.postStatus}
                  </span>
                </div>
              )}

              {/* Post Buttons */}
              <div className="flex gap-3 pt-2 border-t">
                {detailEntry.contentType === "x_post" || detailEntry.contentType === "x_thread" ? (
                  /* X Post or Thread — Post to X button */
                  <div className="flex flex-col gap-2 flex-1">
                    <Button
                      className="w-full"
                      onClick={() => {
                        if (detailEntry) {
                          if (detailEntry.contentType === "x_thread") {
                            postXThread.mutate({ id: detailEntry.id });
                          } else {
                            postXText.mutate({
                              id: detailEntry.id,
                              text: captionText || undefined,
                            });
                          }
                        }
                      }}
                      disabled={
                        (detailEntry.contentType === "x_post" && !captionText.trim()) ||
                        postXText.isPending ||
                        postXThread.isPending ||
                        detailEntry.postStatus === "posted_x"
                      }
                    >
                      <Twitter className="h-4 w-4 mr-2" />
                      {postXText.isPending || postXThread.isPending
                        ? "Posting..."
                        : detailEntry.postStatus === "posted_x"
                        ? "Posted to X"
                        : detailEntry.contentType === "x_thread"
                        ? "Post Thread to X"
                        : "Post to X"}
                    </Button>
                    {(detailEntry as any).tweetUrl && (
                      <a
                        href={(detailEntry as any).tweetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline text-center"
                      >
                        View on X →
                      </a>
                    )}
                  </div>
                ) : (() => {
                  /* Carousel / Reel — publish via Zernio to the selected platform */
                  const media = parseMedia(detailEntry);
                  const hasMedia = media.length > 0 || !!detailEntry.uploadedVideoUrl;
                  const platform = detailEntry.targetPlatform ?? "instagram";
                  const alreadyPosted = ["posted_ig", "posted_tt", "posted_yt", "posted_li", "posted_x", "posted_both"].includes(detailEntry.postStatus ?? "");
                  return (
                    <div className="flex flex-col gap-2 flex-1">
                      <Button
                        className="w-full"
                        onClick={() => {
                          if (detailEntry) {
                            postViaZernio.mutate({ id: detailEntry.id, caption: captionText || undefined });
                          }
                        }}
                        disabled={!hasMedia || postViaZernio.isPending || alreadyPosted}
                      >
                        <Instagram className="h-4 w-4 mr-2" />
                        {postViaZernio.isPending
                          ? "Publishing..."
                          : alreadyPosted
                          ? `Posted to ${PLATFORM_LABELS[platform] ?? platform}`
                          : `Post to ${PLATFORM_LABELS[platform] ?? platform}`}
                      </Button>
                      {!hasMedia && (
                        <p className="text-xs text-muted-foreground text-center">Upload media first to enable publishing.</p>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Video Upload Button ─────────────────────────────────────────────────────

function VideoUploadButton({
  entryId,
  onUpload,
  loading,
  label,
  variant = "default",
  large = false,
}: {
  entryId: number;
  onUpload: (id: number, file: File) => void;
  loading: boolean;
  label: string;
  variant?: "default" | "outline";
  large?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(entryId, file);
          e.target.value = "";
        }}
      />
      <Button
        variant={variant}
        size={large ? "default" : "sm"}
        className={large ? "w-full h-20 border-dashed border-2" : ""}
        onClick={() => inputRef.current?.click()}
        disabled={loading}
      >
        <Upload className={`${large ? "h-5 w-5" : "h-3.5 w-3.5"} mr-2`} />
        {loading ? "Uploading..." : label}
      </Button>
    </>
  );
}

// ─── Media Upload Button (multi-file: images + videos) ───────────────────────

function MediaUploadButton({
  entryId,
  onUpload,
  loading,
  label,
  variant = "default",
  large = false,
}: {
  entryId: number;
  onUpload: (id: number, files: FileList) => void;
  loading: boolean;
  label: string;
  variant?: "default" | "outline";
  large?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onUpload(entryId, e.target.files);
          e.target.value = "";
        }}
      />
      <Button
        variant={variant}
        size={large ? "default" : "sm"}
        className={large ? "w-full h-20 border-dashed border-2" : "w-full"}
        onClick={() => inputRef.current?.click()}
        disabled={loading}
      >
        <Upload className={`${large ? "h-5 w-5" : "h-3.5 w-3.5"} mr-2`} />
        {loading ? "Uploading..." : label}
      </Button>
    </>
  );
}

// ─── Entry Card ─────────────────────────────────────────────────────────────

function EntryCard({
  entry,
  onEdit,
  onDelete,
  onTrigger,
  onOpenDetail,
  onFileUpload,
  triggerLoading,
  uploadLoading,
}: {
  entry: CalendarEntry;
  onEdit: () => void;
  onDelete: () => void;
  onTrigger: () => void;
  onOpenDetail: () => void;
  onFileUpload: (id: number, file: File) => void;
  triggerLoading: boolean;
  uploadLoading: boolean;
}) {
  const statusInfo = STATUS_CONFIG[entry.status] ?? {
    label: entry.status,
    color: "bg-gray-500",
  };

  const isReel = entry.contentType === "reel";
  const isXPost = entry.contentType === "x_post";
  const hasVideo = !!entry.uploadedVideoUrl;
  const media = parseMedia(entry);
  const hasMedia = media.length > 0;
  const postInfo = entry.postStatus
    ? POST_STATUS_CONFIG[entry.postStatus]
    : null;

  return (
    <div className="rounded-md border bg-background p-2 space-y-1.5 text-xs">
      {/* Type + Status */}
      <div className="flex items-center gap-1.5">
        <Badge
          variant="secondary"
          className={`text-[10px] px-1.5 py-0 ${
            entry.contentType === "carousel"
              ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
              : entry.contentType === "x_post"
              ? "bg-slate-500/10 text-slate-600 border-slate-500/20"
              : "bg-purple-500/10 text-purple-600 border-purple-500/20"
          }`}
        >
          {entry.contentType === "carousel" ? (
            <><Instagram className="h-2.5 w-2.5 mr-0.5" /> Carousel</>
          ) : entry.contentType === "x_post" ? (
            <><Twitter className="h-2.5 w-2.5 mr-0.5" /> X Post</>
          ) : (
            <><Video className="h-2.5 w-2.5 mr-0.5" /> Reel</>
          )}
        </Badge>
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${statusInfo.color}`}
        />
        <span className="text-muted-foreground truncate">{statusInfo.label}</span>
        {/* Post status badge for reels with video */}
        {((isReel && hasVideo) || isXPost) && postInfo && (
          <>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${postInfo.color}`} />
            <span className="text-muted-foreground truncate">{postInfo.label}</span>
          </>
        )}
      </div>

      {/* Title */}
      {entry.topicTitle && (
        <p className="font-medium text-foreground truncate leading-tight">
          {entry.topicTitle}
        </p>
      )}

      {/* Media preview strip — first 3 thumbnails + count (carousel/reel) */}
      {hasMedia && (
        <div className="flex items-center gap-1">
          {media.slice(0, 3).map((m, i) => (
            <div key={i} className="relative h-10 w-8 rounded overflow-hidden bg-black shrink-0">
              {m.type === "video" ? (
                <video src={m.url} className="h-full w-full object-cover" muted playsInline />
              ) : (
                <img src={m.url} className="h-full w-full object-cover" alt="" />
              )}
              {m.type === "video" && (
                <span className="absolute inset-0 flex items-center justify-center text-white text-[8px]">▶</span>
              )}
            </div>
          ))}
          {media.length > 3 && (
            <span className="text-[10px] text-muted-foreground font-medium">+{media.length - 3}</span>
          )}
          <span className="text-[10px] text-muted-foreground ml-0.5">
            {media.length} {media.length === 1 ? "item" : "items"}
          </span>
        </div>
      )}

      {/* Video indicator for legacy reels (no mediaItems yet) */}
      {isReel && hasVideo && !hasMedia && (
        <div className="flex items-center gap-1 text-green-600">
          <Film className="h-2.5 w-2.5" />
          <span className="truncate">{entry.uploadedVideoName ?? "Video uploaded"}</span>
        </div>
      )}

      {/* Notes */}
      {entry.notes && (
        <p className="text-muted-foreground truncate">{entry.notes}</p>
      )}

      {/* Action Buttons */}
      <div className="flex gap-1 pt-0.5 flex-wrap">
        {entry.status === "planned" && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={onTrigger}
              disabled={triggerLoading}
            >
              <Play className="h-2.5 w-2.5 mr-0.5" />
              Run
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px]"
              onClick={onEdit}
            >
              <Pencil className="h-2.5 w-2.5" />
            </Button>
          </>
        )}

        {/* Reel: Upload / Open detail */}
        {isReel && (
          <Button
            variant={hasVideo ? "outline" : "default"}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={onOpenDetail}
          >
            {hasVideo ? (
              <><Film className="h-2.5 w-2.5 mr-0.5" /> View</>
            ) : (
              <><Upload className="h-2.5 w-2.5 mr-0.5" /> Upload</>
            )}
          </Button>
        )}

        {/* Carousel: Upload media / open detail to publish */}
        {entry.contentType === "carousel" && (
          <Button
            variant={hasMedia ? "outline" : "default"}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={onOpenDetail}
          >
            {hasMedia ? (
              <><Instagram className="h-2.5 w-2.5 mr-0.5" /> {entry.postStatus?.startsWith("posted") ? "View" : "Post"}</>
            ) : (
              <><Upload className="h-2.5 w-2.5 mr-0.5" /> Media</>
            )}
          </Button>
        )}

        {/* X Post: Open detail to write/post tweet */}
        {isXPost && (
          <Button
            variant={entry.postStatus === "posted_x" ? "outline" : "default"}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={onOpenDetail}
          >
            <Twitter className="h-2.5 w-2.5 mr-0.5" />
            {entry.postStatus === "posted_x" ? "View" : "Write"}
          </Button>
        )}

        {entry.pipelineRunId && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            <FileText className="h-2.5 w-2.5 mr-0.5" />
            Run #{entry.pipelineRunId}
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[10px] ml-auto text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-2.5 w-2.5" />
        </Button>
      </div>
    </div>
  );
}
