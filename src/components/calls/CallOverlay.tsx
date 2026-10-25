import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  ShieldCheck,
  Video,
  VideoOff,
} from 'lucide-react';
import { useCall } from '../../context/CallContext';
import { formatCallDuration, initials } from '../../lib/format';

function AttachStream({
  stream,
  muted = false,
  className,
  video = true,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
  video?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  return (
    <video
      ref={ref}
      className={className}
      autoPlay
      playsInline
      muted={muted}
      aria-label={video ? 'Call video' : 'Call audio'}
    />
  );
}

export function CallOverlay() {
  const {
    call,
    localStream,
    remoteStream,
    muted,
    cameraOn,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
  } = useCall();
  const [elapsed, setElapsed] = useState('0:00');

  useEffect(() => {
    if (call.status !== 'active' || !call.startedAt) {
      setElapsed('0:00');
      return;
    }
    const update = () => setElapsed(formatCallDuration(call.startedAt ?? Date.now(), Date.now()));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [call.startedAt, call.status]);

  useEffect(() => {
    if (call.status === 'idle') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [call.status]);

  if (call.status === 'idle') return null;

  const incoming = call.status === 'incoming';
  const active = call.status === 'active';
  const title =
    call.status === 'outgoing'
      ? 'Calling…'
      : call.status === 'incoming'
        ? `Incoming ${call.video ? 'video' : 'audio'} call`
        : active
          ? elapsed
          : 'Connecting…';

  return (
    <div
      className="call-overlay"
      data-status={call.status}
      data-video={call.video ? 'true' : 'false'}
      role="dialog"
      aria-modal="true"
      aria-label={`Call with ${call.peerName}`}
    >
      <div className="call-backdrop" aria-hidden="true" />

      {active && call.video ? (
        <div className="call-stage">
          <AttachStream stream={remoteStream} className="call-remote-video" />
          {!remoteStream ? (
            <div className="call-waiting">
              <Loader2 className="spin" size={28} aria-hidden="true" />
              <span>Connecting video…</span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="call-audio-stage">
          <div className={`call-avatar${active ? ' is-live' : ''}`}>
            <span>{initials(call.peerName)}</span>
          </div>
          <h2>{call.peerName}</h2>
          <p className="call-status" aria-live="polite">
            {title}
          </p>
          <span className="call-secure">
            <ShieldCheck size={14} aria-hidden="true" /> Encrypted signaling · peer-to-peer media
          </span>
        </div>
      )}

      {active && call.video ? (
        <header className="call-topbar">
          <div>
            <strong>{call.peerName}</strong>
            <span>{elapsed}</span>
          </div>
          <span className="call-secure">
            <ShieldCheck size={14} aria-hidden="true" /> End-to-end encrypted
          </span>
        </header>
      ) : null}

      {localStream && call.video ? (
        <div className="call-local-preview" data-off={!cameraOn}>
          <AttachStream stream={localStream} muted className="call-local-video" />
          {!cameraOn ? (
            <span>
              <VideoOff size={15} aria-hidden="true" /> Camera off
            </span>
          ) : null}
        </div>
      ) : null}

      {active && !call.video && remoteStream ? (
        <AttachStream stream={remoteStream} video={false} className="visually-hidden" />
      ) : null}

      {incoming ? (
        <div className="incoming-actions">
          <button
            type="button"
            className="call-action call-action--accept"
            onClick={() => void acceptCall()}
            aria-label="Accept call"
          >
            <Phone size={24} aria-hidden="true" />
            <span>Accept</span>
          </button>
          <button
            type="button"
            className="call-action call-action--end"
            onClick={() => void declineCall()}
            aria-label="Decline call"
          >
            <PhoneOff size={24} aria-hidden="true" />
            <span>Decline</span>
          </button>
        </div>
      ) : (
        <div className="call-controls">
          <button
            type="button"
            className={`call-control${muted ? ' is-off' : ''}`}
            onClick={toggleMute}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <MicOff size={21} aria-hidden="true" /> : <Mic size={21} aria-hidden="true" />}
            <span>{muted ? 'Unmute' : 'Mute'}</span>
          </button>
          {call.video ? (
            <button
              type="button"
              className={`call-control${!cameraOn ? ' is-off' : ''}`}
              onClick={toggleCamera}
              aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
              title={cameraOn ? 'Camera off' : 'Camera on'}
            >
              {cameraOn ? (
                <Video size={21} aria-hidden="true" />
              ) : (
                <VideoOff size={21} aria-hidden="true" />
              )}
              <span>{cameraOn ? 'Camera' : 'Camera off'}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="call-control call-control--end"
            onClick={() => void endCall()}
            aria-label="End call"
            title="End call"
          >
            <PhoneOff size={22} aria-hidden="true" />
            <span>End</span>
          </button>
        </div>
      )}

      {call.status === 'outgoing' || call.status === 'connecting' ? (
        <div className="call-dialing">
          <span>
            <Loader2 className="spin" size={14} aria-hidden="true" />
            {call.status === 'outgoing' ? 'Ringing securely' : 'Establishing connection'}
          </span>
          {call.status === 'outgoing' ? (
            <span className="call-dialing__hint">
              <Check size={14} aria-hidden="true" /> End-to-end encrypted
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
