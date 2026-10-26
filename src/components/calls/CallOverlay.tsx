import { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  ShieldCheck,
  SwitchCamera,
  Video,
  VideoOff,
} from 'lucide-react';
import { useCall } from '../../context/CallContext';
import { formatCallDuration } from '../../lib/format';
import { Avatar } from '../ui/Avatar';

export function CallOverlay() {
  const {
    call,
    localStream,
    remoteStream,
    micMuted,
    cameraOff,
    canFlipCamera,
    acceptCall,
    declineCall,
    endCall,
    toggleMic,
    toggleCamera,
    switchCamera,
  } = useCall();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const element = localVideoRef.current;
    if (!element) return;
    element.srcObject = localStream;
    if (localStream) {
      void element.play().catch(() => undefined);
    }
  }, [localStream, call.video, cameraOff]);

  useEffect(() => {
    const videoEl = remoteVideoRef.current;
    if (videoEl) {
      videoEl.srcObject = remoteStream;
      if (remoteStream) {
        void videoEl.play().catch(() => undefined);
      }
    }
    const audioEl = remoteAudioRef.current;
    if (audioEl) {
      audioEl.srcObject = remoteStream;
      if (remoteStream) {
        void audioEl.play().catch(() => undefined);
      }
    }
  }, [remoteStream, call.status]);

  useEffect(() => {
    if (call.status !== 'active') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [call.status]);

  if (call.status === 'idle') return null;

  const hasRemoteVideo =
    call.video &&
    !!remoteStream &&
    remoteStream.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted);

  const hasLocalVideo =
    call.video &&
    !cameraOff &&
    !!localStream &&
    localStream.getVideoTracks().some((track) => track.readyState === 'live');

  const subtitle =
    call.status === 'incoming'
      ? call.video
        ? 'Incoming video call'
        : 'Incoming voice call'
      : call.status === 'outgoing'
        ? 'Ringing…'
        : call.status === 'connecting'
          ? 'Connecting…'
          : call.startedAt
            ? formatCallDuration(call.startedAt, now)
            : 'Connected';

  return (
    <div
      className={`call-overlay ${hasRemoteVideo ? 'call-overlay--video' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Call with ${call.peerName}`}
    >
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="call-card">
        {call.video ? (
          <video
            ref={remoteVideoRef}
            className={`call-remote-video ${hasRemoteVideo ? 'is-live' : 'is-waiting'}`}
            autoPlay
            playsInline
          />
        ) : null}

        {!hasRemoteVideo ? (
          <div className="call-identity">
            <Avatar
              name={call.peerName || 'Contact'}
              seed={call.peerId ?? call.peerName}
              dpUrl={call.peerAvatarUrl}
              size="xl"
            />
            <h2>{call.peerName}</h2>
            <p>{subtitle}</p>
            <span className="call-encrypted-pill">
              <ShieldCheck size={13} aria-hidden="true" /> End-to-end encrypted
            </span>
          </div>
        ) : (
          <div className="call-floating-meta">
            <strong>{call.peerName}</strong>
            <span>{subtitle}</span>
          </div>
        )}

        <video
          ref={localVideoRef}
          className={`call-local-video ${hasLocalVideo ? '' : 'is-hidden'}`}
          autoPlay
          muted
          playsInline
        />

        <div className="call-controls">
          {call.status === 'incoming' ? (
            <>
              <button
                type="button"
                className="call-btn call-btn--decline"
                onClick={() => void declineCall()}
                aria-label="Decline call"
              >
                <PhoneOff size={22} aria-hidden="true" />
                <span>Decline</span>
              </button>
              <button
                type="button"
                className="call-btn call-btn--accept"
                onClick={() => void acceptCall()}
                aria-label="Accept call"
              >
                {call.video ? (
                  <Video size={22} aria-hidden="true" />
                ) : (
                  <Phone size={22} aria-hidden="true" />
                )}
                <span>Accept</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`call-btn ${micMuted ? 'is-toggled' : ''}`}
                onClick={toggleMic}
                aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {micMuted ? (
                  <MicOff size={20} aria-hidden="true" />
                ) : (
                  <Mic size={20} aria-hidden="true" />
                )}
                <span>{micMuted ? 'Unmute' : 'Mute'}</span>
              </button>

              {call.video ? (
                <button
                  type="button"
                  className={`call-btn ${cameraOff ? 'is-toggled' : ''}`}
                  onClick={toggleCamera}
                  aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
                >
                  {cameraOff ? (
                    <VideoOff size={20} aria-hidden="true" />
                  ) : (
                    <Video size={20} aria-hidden="true" />
                  )}
                  <span>{cameraOff ? 'Cam on' : 'Cam off'}</span>
                </button>
              ) : null}

              {call.video && canFlipCamera && !cameraOff ? (
                <button
                  type="button"
                  className="call-btn"
                  onClick={() => void switchCamera()}
                  aria-label="Switch front or rear camera"
                >
                  <SwitchCamera size={20} aria-hidden="true" />
                  <span>Flip</span>
                </button>
              ) : null}

              <button
                type="button"
                className="call-btn call-btn--decline"
                onClick={() => void endCall()}
                aria-label="End call"
              >
                <PhoneOff size={20} aria-hidden="true" />
                <span>End</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
