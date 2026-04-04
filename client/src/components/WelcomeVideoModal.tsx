import { Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const WELCOME_SEEN_KEY = "portal-welcome-seen";
const VIDEO_URL = "/uploads/portal/welcome.mp4";
const AUTO_SHOW_DELAY_MS = 3000;

/**
 * WelcomeVideoModal
 *
 * First login:  auto-opens 3s after mount with dark overlay + centered video.
 * After close:  collapses to a small "Intro Video" pill in the top-left.
 * Clicking the pill re-opens the modal at any time.
 */
export function WelcomeVideoModal() {
  const [open, setOpen] = useState(false);
  const [hasSeen, setHasSeen] = useState(() =>
    localStorage.getItem(WELCOME_SEEN_KEY) === "true",
  );
  const videoRef = useRef<HTMLVideoElement>(null);

  // Auto-open on first visit, 3s after mount
  useEffect(() => {
    if (hasSeen) return;
    const timer = setTimeout(() => setOpen(true), AUTO_SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasSeen]);

  // Auto-play when modal opens, pause when it closes
  useEffect(() => {
    if (!open) return;
    // Small delay to let the DOM render, then play
    const timer = setTimeout(() => {
      const vid = videoRef.current;
      if (vid) {
        vid.currentTime = 0;
        vid.play().catch(() => {});
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [open]);

  // Pause on close
  useEffect(() => {
    if (open) return;
    videoRef.current?.pause();
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
      {hasSeen && !open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed top-3 left-3 z-[60] flex items-center gap-1.5 rounded-full bg-primary/90 px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-md backdrop-blur transition-all hover:bg-primary hover:shadow-lg hover:scale-105 active:scale-95"
        >
          <Play className="h-3 w-3" />
          Intro Video
        </button>
      )}

      {/* ── Full-screen overlay + video modal ── */}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ animation: "fadeIn 0.3s ease-out" }}
        >
          {/* Dark backdrop — click to close */}
          <div
            className="absolute inset-0 bg-black/80"
            onClick={handleClose}
          />

          {/* Video container */}
          <div
            className="relative z-10 w-[90vw] max-w-4xl"
            style={{ animation: "scaleIn 0.3s ease-out" }}
          >
            {/* Close button — top right, always visible */}
            <button
              onClick={handleClose}
              className="absolute -top-10 right-0 flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-sm font-medium text-white backdrop-blur-sm transition-all hover:bg-white/30 hover:scale-105"
            >
              <X className="h-4 w-4" />
              Close
            </button>

            {/* Video player */}
            <video
              ref={videoRef}
              src={VIDEO_URL}
              controls
              playsInline
              preload="auto"
              className="w-full rounded-xl shadow-2xl"
              style={{ aspectRatio: "16/9" }}
            />
          </div>
        </div>
      )}

      {/* Inline keyframe animations */}
      {open && (
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes scaleIn {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
          }
        `}</style>
      )}
    </>
  );
}
