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
  posted_both: { label: "Posted (IG + X)", color: "bg-green-500" },
};

// ─── Types ──────────────────────────────────────────────────────────────────

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
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function EditorialCalendar() {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalDate, setAddModalDate] = useState("");
  const [editEntry, setEditEntry] = useState<CalendarEntry | null>(null);
  const [detailEntry, setDetailEntry] = useState<CalendarEntry | null>(null);
  const [formType, setFormType] = useState<"carousel" | "reel">("carousel");
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
    setFormType(entry.contentType as "carousel" | "reel");
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
              <Film className="h-5 w-5" />
              {detailEntry?.topicTitle || "Reel Details"}
            </DialogTitle>
          </DialogHeader>
          {detailEntry && (
            <div className="space-y-5">
              {/* Video Preview / Upload */}
              <div>
                <label className="text-sm font-medium mb-2 block">Video</label>
                {detailEntry.uploadedVideoUrl ? (
                  <div className="space-y-2">
                    <video
                      src={detailEntry.uploadedVideoUrl}
                      controls
                      className="w-full max-h-[300px] rounded-lg bg-black"
                    />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      <span>{detailEntry.uploadedVideoName}</span>
                    </div>
                    <VideoUploadButton
                      entryId={detailEntry.id}
                      onUpload={handleFileUpload}
                      loading={uploadVideo.isPending}
                      label="Replace Video"
                      variant="outline"
                    />
                  </div>
                ) : (
                  <VideoUploadButton
                    entryId={detailEntry.id}
                    onUpload={handleFileUpload}
                    loading={uploadVideo.isPending}
                    label="Upload Video"
                    variant="default"
                    large
                  />
                )}
              </div>

              {/* Caption Editor */}
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  Instagram Caption
                </label>
                <Textarea
                  placeholder="Write the Instagram caption for this Reel..."
                  value={captionText}
                  onChange={(e) => setCaptionText(e.target.value)}
                  rows={4}
                />
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
                    {saveCaption.isPending ? "Saving..." : "Save Caption"}
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
                <Button
                  onClick={() => {
                    if (detailEntry) {
                      // Pass caption directly — backend saves it and posts in one call (no race condition)
                      postToInstagram.mutate({
                        id: detailEntry.id,
                        caption: captionText || undefined,
                      });
                    }
                  }}
                  disabled={
                    !detailEntry.uploadedVideoUrl ||
                    postToInstagram.isPending ||
                    detailEntry.postStatus === "posted_ig" ||
                    detailEntry.postStatus === "posted_both"
                  }
                  className="flex-1"
                >
                  <Instagram className="h-4 w-4 mr-2" />
                  {postToInstagram.isPending
                    ? "Posting..."
                    : detailEntry.postStatus === "posted_ig"
                    ? "Posted to Instagram"
                    : "Post to Instagram"}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    if (detailEntry) {
                      postToTwitter.mutate({
                        id: detailEntry.id,
                        caption: captionText || undefined,
                      });
                    }
                  }}
                  disabled={
                    !detailEntry.uploadedVideoUrl ||
                    postToTwitter.isPending ||
                    detailEntry.postStatus === "posted_x" ||
                    detailEntry.postStatus === "posted_both"
                  }
                >
                  <Send className="h-4 w-4 mr-2" />
                  {postToTwitter.isPending
                    ? "Posting..."
                    : detailEntry.postStatus === "posted_x" || detailEntry.postStatus === "posted_both"
                    ? "Posted to X"
                    : "Post to X/Twitter"}
                </Button>
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
  const hasVideo = !!entry.uploadedVideoUrl;
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
              : "bg-purple-500/10 text-purple-600 border-purple-500/20"
          }`}
        >
          {entry.contentType === "carousel" ? (
            <><Instagram className="h-2.5 w-2.5 mr-0.5" /> Carousel</>
          ) : (
            <><Video className="h-2.5 w-2.5 mr-0.5" /> Reel</>
          )}
        </Badge>
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${statusInfo.color}`}
        />
        <span className="text-muted-foreground truncate">{statusInfo.label}</span>
        {/* Post status badge for reels with video */}
        {isReel && hasVideo && postInfo && (
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

      {/* Video indicator for reels */}
      {isReel && hasVideo && (
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
