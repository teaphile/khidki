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
  Volume2,
} from 'lucide-react';
import { useCall } from '../../context/CallContext';
import { formatCallDuration } from '../../lib/format';
import { Avatar } from '../ui/Avatar';

function attachMedia(element: HTMLMediaElement | null, stream: MediaStream | null, muted: boolean) {
  if (!element) return;
  element.muted = muted;
  if (element.srcObject !== stream) {
    element.srcObject = stream;
  }
  if (stream) {
    void element.play().catch(() => undefined);
  }
}

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
    attachMedia(localVideoRef.current, localStream, true);
  }, [localStream, call.status, call.video]);

  useEffect(() => {
    attachMedia(remoteVideoRef.current, remoteStream, false);
    attachMedia(remoteAudioRef.current, remoteStream, false);
  }, [remoteStream, call.status, call.video]);

  useEffect(() => {
    if (call.status !== 'active') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [call.status]);

  if (call.status === 'idle') return null;

  const remoteHasVideo = Boolean(
    call.video && remoteStream?.getVideoTracks().some((track) => track.readyState === 'live'),
  );

  const statusLabel =
    call.status === 'incoming'
      ? call.video
        ? 'Incoming video call'
        : 'Incoming audio call'
      : call.status === 'outgoing'
        ? 'Ringing...'
        : call.status === 'connecting'
          ? 'Connecting encrypted media...'
          : call.startedAt
            ? formatCallDuration(call.startedAt, now)
            : 'Connected';

  const resumePlayback = () => {
    void remoteAudioRef.current?.play().catch(() => undefined);
    void remoteVideoRef.current?.play().catch(() => undefined);
  };

  return (
    <div
      className="call-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Call with ${call.peerName}`}
      onClick={resumePlayback}
    >
      {/* Dedicated audio sink ensures crystal-clear voice playback even when video stage isn't mounted */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="call-stage">
        {remoteHasVideo ? (
          <video ref={remoteVideoRef} className="call-remote-video" autoPlay playsInline />
        ) : (
          <div className="call-audio-stage">
            <div className="call-avatar-wrap">
              <Avatar
                name={call.peerName || 'Caller'}
                seed={call.peerId || call.peerName}
                avatarId={call.peerAvatarId}
                size="xl"
              />
            </div>
            <h2>{call.peerName}</h2>
            <p className="call-status">{statusLabel}</p>
            <span className="call-secure">
              <ShieldCheck size={15} aria-hidden="true" /> Peer-to-peer WebRTC · DTLS-SRTP encrypted
            </span>
          </div>
        )}

        {remoteHasVideo ? (
          <div className="call-topbar">
            <div>
              <strong>{call.peerName}</strong>
              <span>{statusLabel}</span>
            </div>
            <span className="call-secure">
              <ShieldCheck size={14} aria-hidden="true" /> Encrypted
            </span>
          </div>
        ) : null}

        {call.video && localStream ? (
          <div className={`call-local-preview${cameraOff ? ' is-off' : ''}`}>
            <video ref={localVideoRef} className="call-local-video" autoPlay playsInline muted />
            {cameraOff ? (
              <span>
                <VideoOff size={18} aria-hidden="true" /> Camera off
              </span>
            ) : null}
          </div>
        ) : null}

        {call.status === 'incoming' ? (
          <div className="incoming-actions">
            <button
              type="button"
              className="call-action call-action--end"
              onClick={() => void declineCall()}
              aria-label="Decline call"
            >
              <PhoneOff size={22} aria-hidden="true" />
              <span>Decline</span>
            </button>
            <button
              type="button"
              className="call-action call-action--accept"
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
          </div>
        ) : (
          <div className="call-controls">
            <button
              type="button"
              className={`call-control${micMuted ? ' is-off' : ''}`}
              onClick={toggleMic}
              aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
              title={micMuted ? 'Unmute' : 'Mute'}
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
                className={`call-control${cameraOff ? ' is-off' : ''}`}
                onClick={toggleCamera}
                aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
                title={cameraOff ? 'Camera on' : 'Camera off'}
              >
                {cameraOff ? (
                  <VideoOff size={20} aria-hidden="true" />
                ) : (
                  <Video size={20} aria-hidden="true" />
                )}
                <span>{cameraOff ? 'Camera on' : 'Camera off'}</span>
              </button>
            ) : null}

            {canFlipCamera ? (
              <button
                type="button"
                className="call-control"
                onClick={() => void switchCamera()}
                aria-label="Switch camera"
                title="Flip camera"
              >
                <SwitchCamera size={20} aria-hidden="true" />
                <span>Flip</span>
              </button>
            ) : null}

            <button
              type="button"
              className="call-control call-control--end"
              onClick={() => void endCall()}
              aria-label="End call"
              title="End call"
            >
              <PhoneOff size={21} aria-hidden="true" />
              <span>End</span>
            </button>
          </div>
        )}

        {call.status === 'outgoing' ? (
          <div className="call-dialing">
            <span>
              <Volume2 size={15} aria-hidden="true" /> Waiting for {call.peerName} to answer
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
