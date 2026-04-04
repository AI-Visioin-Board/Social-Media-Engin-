import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const WELCOME_SEEN_KEY = "portal-welcome-seen";
const VIDEO_URL = "/uploads/portal/welcome.mp4";
const AUTO_SHOW_DELAY_MS = 3000;

/**
 * WelcomeVideoModal
 *
 * First login:  auto-opens 3 s after mount (dark overlay + centered video).
 * After close:  collapses to a small "Intro Video" pill in the top-left.
 * Clicking the pill re-opens the modal at any time.
 */
export function WelcomeVideoModal() {
  const [open, setOpen] = useState(false);
  const [hasSeen, setHasSeen] = useState(() =>
    localStorage.getItem(WELCOME_SEEN_KEY) === "true",
  );
  const videoRef = useRef<HTMLVideoElement>(null);

  // Auto-open on first visit, 3 s after mount
  useEffect(() => {
    if (hasSeen) return;
    const timer = setTimeout(() => setOpen(true), AUTO_SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasSeen]);

  // Auto-play when modal opens, pause when it closes
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (open) {
      vid.currentTime = 0;
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }, [open]);

  const handleClose = useCallback(() => {
    setOpen(false);
    if (!hasSeen) {
      localStorage.setItem(WELCOME_SEEN_KEY, "true");
      setHasSeen(true);
    }
  }, [hasSeen]);

  return (
    <>
      {/* ── Small "Intro Video" pill (visible after first dismiss) ── */}
      {hasSeen && (
        <button
          onClick={() => setOpen(true)}
          className="fixed top-3 left-3 z-40 flex items-center gap-1.5 rounded-full bg-primary/90 px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-md backdrop-blur transition-all hover:bg-primary hover:shadow-lg hover:scale-105 active:scale-95"
        >
          <Play className="h-3 w-3" />
          Intro Video
        </button>
      )}

      {/* ── Video modal ── */}
      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
        <DialogContent
          className="max-w-3xl w-[90vw] p-0 overflow-hidden border-0 bg-black/95 shadow-2xl gap-0"
          showCloseButton={true}
        >
          {/* Accessible title (visually hidden) */}
          <DialogTitle className="sr-only">Welcome to Your Portal</DialogTitle>

          <video
            ref={videoRef}
            src={VIDEO_URL}
            controls
            playsInline
            preload="auto"
            className="w-full aspect-video rounded-lg"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
