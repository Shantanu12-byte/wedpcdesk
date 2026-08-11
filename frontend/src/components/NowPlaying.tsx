import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, Music } from 'lucide-react';
import { controlMedia } from '../utils/api';

export interface MediaState {
  active: boolean;
  appId?: string;
  title?: string;
  artist?: string;
  album?: string;
  status?: 'Playing' | 'Paused' | 'Stopped' | 'Unknown';
  positionMs?: number;
  durationMs?: number;
  thumbnail?: string; // base64
}

interface NowPlayingProps {
  media: MediaState | null;
}

export const NowPlaying: React.FC<NowPlayingProps> = ({ media }) => {
  const [localPos, setLocalPos] = useState<number>(0);
  const [isFading, setIsFading] = useState<boolean>(false);
  const [displayThumbnail, setDisplayThumbnail] = useState<string | undefined>('');
  
  const lastTitleRef = useRef<string | undefined>('');

  // Handle title and thumbnail transitions (crossfade)
  useEffect(() => {
    if (media?.active) {
      if (media.title !== lastTitleRef.current) {
        setIsFading(true);
        const timer = setTimeout(() => {
          setDisplayThumbnail(media.thumbnail);
          setIsFading(false);
        }, 200);
        lastTitleRef.current = media.title;
        return () => clearTimeout(timer);
      } else if (media.thumbnail !== displayThumbnail) {
        // Thumbnail updated but title didn't (e.g. late load)
        setDisplayThumbnail(media.thumbnail);
      }
    } else {
      setDisplayThumbnail('');
      lastTitleRef.current = '';
    }
  }, [media?.title, media?.thumbnail, media?.active, displayThumbnail]);

  // Handle local position interpolation when media is playing
  useEffect(() => {
    if (media) {
      setLocalPos(media.positionMs || 0);
    }
  }, [media?.positionMs, media?.status]);

  useEffect(() => {
    if (media?.status === 'Playing') {
      const interval = setInterval(() => {
        setLocalPos((prev) => {
          if (media.durationMs && prev >= media.durationMs) {
            return media.durationMs;
          }
          return prev + 250;
        });
      }, 250);
      return () => clearInterval(interval);
    }
  }, [media?.status, media?.durationMs]);

  if (!media || !media.active) {
    return (
      <div className="now-playing-container" style={{ width: '100%', maxWidth: '360px', minHeight: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="now-playing-content" style={{ gap: '12px' }}>
          <Music size={32} style={{ color: 'rgba(255,255,255,0.2)', animation: 'pulse 2s infinite' }} />
          <div className="now-playing-artist">No Media Active</div>
        </div>
      </div>
    );
  }

  const { title, artist, album, status, durationMs } = media;
  const progressPercent = durationMs && durationMs > 0 ? (localPos / durationMs) * 100 : 0;

  const formatTime = (ms: number) => {
    if (isNaN(ms) || ms < 0) return '0:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const handleAction = async (action: 'play' | 'pause' | 'next' | 'previous') => {
    try {
      await controlMedia(action);
    } catch (e) {
      console.error('Failed to execute playback action:', e);
    }
  };

  const displayTitle = title || 'Unknown Title';
  const showMarquee = displayTitle.length > 24;

  const artUrl = displayThumbnail ? `data:image/jpeg;base64,${displayThumbnail}` : null;
  const blurUrl = media.thumbnail ? `data:image/jpeg;base64,${media.thumbnail}` : null;

  return (
    <div className="now-playing-container" style={{ width: '100%', maxWidth: '360px' }}>
      {blurUrl && (
        <div 
          className="now-playing-blur-bg" 
          style={{ backgroundImage: `url(${blurUrl})` }}
        />
      )}
      <div className="now-playing-content">
        {/* Album Art centered, rounded 16px, square 140px */}
        <div className="now-playing-album-art-wrapper">
          {artUrl ? (
            <img 
              src={artUrl} 
              alt="Album Art" 
              className={`now-playing-album-art ${isFading ? 'fade-out' : ''}`}
            />
          ) : (
            <div className="now-playing-fallback-art">
              <Music size={48} />
            </div>
          )}
        </div>

        {/* Track Title and Artist centered directly below */}
        <div className="now-playing-meta">
          <div className="now-playing-title-container">
            {showMarquee ? (
              <div className="now-playing-marquee">
                {displayTitle} &nbsp;&bull;&nbsp; {displayTitle}
              </div>
            ) : (
              <div className="now-playing-title-static">{displayTitle}</div>
            )}
          </div>
          <div className="now-playing-artist">
            {artist || 'Unknown Artist'}{album ? ` — ${album}` : ''}
          </div>
        </div>

        {/* Thin progress bar with time on either side */}
        <div className="now-playing-scrubber-row">
          <span>{formatTime(localPos)}</span>
          <div className="now-playing-scrubber-track">
            <div 
              className="now-playing-scrubber-progress" 
              style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
            />
            <div 
              className="now-playing-scrubber-handle" 
              style={{ left: `${Math.min(100, Math.max(0, progressPercent))}%` }}
            />
          </div>
          <span>{formatTime(durationMs || 0)}</span>
        </div>

        {/* Playback Controls centered below progress bar */}
        <div className="now-playing-controls">
          <button className="now-playing-btn" onClick={() => handleAction('previous')} title="Previous">
            <SkipBack size={20} fill="currentColor" stroke="none" />
          </button>
          
          <button 
            className="now-playing-btn play-pause" 
            onClick={() => handleAction(status === 'Playing' ? 'pause' : 'play')}
            title={status === 'Playing' ? 'Pause' : 'Play'}
          >
            {status === 'Playing' ? (
              <Pause size={22} fill="currentColor" stroke="none" />
            ) : (
              <Play size={22} fill="currentColor" stroke="none" style={{ transform: 'translateX(1.5px)' }} />
            )}
          </button>

          <button className="now-playing-btn" onClick={() => handleAction('next')} title="Next">
            <SkipForward size={20} fill="currentColor" stroke="none" />
          </button>
        </div>
      </div>
    </div>
  );
};
