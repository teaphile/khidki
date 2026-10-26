import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { CallState, Conversation, ConversationMember } from '../types';
import { useAuth } from './AuthContext';
import { useChat } from './ChatContext';
import { useToast } from './ToastContext';
import { decryptJson, derivePairwiseKey, encryptJson, randomId, signPayload } from '../lib/crypto';
import { dmPeer } from '../lib/format';
import { clearCallSignals, pollCallSignals, storeCallSignal } from '../lib/data';
import type { CallData, CallEnvelope, CallKind } from '../lib/calls';
import {
  callAad,
  callDataSchema,
  callEnvelopeSchema,
  canonicalCall,
  verifyCallEnvelope,
} from '../lib/calls';

type CallContextValue = {
  call: CallState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micMuted: boolean;
  cameraOff: boolean;
  canFlipCamera: boolean;
  startCall: (target: Conversation | string, video: boolean) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMic: () => void;
  toggleCamera: () => void;
  switchCamera: () => Promise<void>;
};

const CallContext = createContext<CallContextValue | null>(null);

const ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun.cloudflare.com:3478',
    ],
  },
];

const RING_TIMEOUT_MS = 45_000;
const SIGNAL_REPLAY_TTL_MS = 90_000;
const MAX_QUEUED_ICE = 64;

const IDLE_STATE: CallState = {
  status: 'idle',
  callId: null,
  conversationId: null,
  peerId: null,
  peerName: '',
  peerAvatarId: 'initials',
  video: false,
  startedAt: null,
  error: null,
};

function mediaErrorMessage(error: unknown, video: boolean): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return video
        ? 'Camera and microphone access was blocked. Allow permissions in your browser settings.'
        : 'Microphone access was blocked. Allow microphone permission in your browser settings.';
    }
    if (error.name === 'NotFoundError') {
      return video ? 'No camera or microphone was found.' : 'No microphone was found.';
    }
    if (error.name === 'NotReadableError') {
      return 'Your camera or microphone is already in use by another app.';
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return 'The call could not be started.';
}

type PendingOffer = {
  callId: string;
  conversationId: string;
  peer: ConversationMember;
  video: boolean;
  sdp: RTCSessionDescriptionInit;
};

export function CallProvider({ children }: { children: ReactNode }) {
  const { profile, identity } = useAuth();
  const { conversations, refreshConversations, sendUserEventTo, subscribeUserEvents } = useChat();
  const { toast } = useToast();

  const [call, setCall] = useState<CallState>(IDLE_STATE);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const callRef = useRef<CallState>(IDLE_STATE);
  const conversationsRef = useRef<Conversation[]>(conversations);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingOfferRef = useRef<PendingOffer | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const initialSignalReadyRef = useRef<Promise<void>>(Promise.resolve());
  const ringTimerRef = useRef<number | null>(null);
  const disconnectTimerRef = useRef<number | null>(null);
  const seenSignalsRef = useRef<Map<string, number>>(new Map());
  const pollCursorRef = useRef<string | null>(null);
  const handleSignalRef = useRef<(event: string, raw: unknown) => void>(() => {});

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const stopRingTimer = useCallback(() => {
    if (ringTimerRef.current !== null) {
      window.clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
    if (disconnectTimerRef.current !== null) {
      window.clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopRingTimer();
    const endedCallId = callRef.current.callId ?? pendingOfferRef.current?.callId ?? null;
    pendingOfferRef.current = null;
    pendingIceRef.current = [];
    initialSignalReadyRef.current = Promise.resolve();

    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // Ignore already-closed peer connection.
      }
    }

    const local = localStreamRef.current;
    localStreamRef.current = null;
    if (local) {
      for (const track of local.getTracks()) track.stop();
    }

    remoteStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setMicMuted(false);
    setCameraOff(false);
    setFacingMode('user');
    callRef.current = IDLE_STATE;
    setCall(IDLE_STATE);

    if (endedCallId) {
      void clearCallSignals(endedCallId).catch(() => undefined);
    }
  }, [stopRingTimer]);

  useEffect(() => cleanup, [cleanup]);

  const signalKey = useCallback(
    async (peer: ConversationMember, conversationId: string): Promise<string> => {
      if (!identity || !peer.publicKey) {
        throw new Error('This contact does not have an encryption key yet.');
      }
      return derivePairwiseKey(
        identity.ecdh.privateKey,
        peer.publicKey.ecdh,
        `call:${conversationId}`,
      );
    },
    [identity],
  );

  const sendSignal = useCallback(
    async (
      peer: ConversationMember,
      conversationId: string,
      callId: string,
      kind: CallKind,
      data: CallData,
    ) => {
      if (!profile || !identity) throw new Error('You are signed out.');
      const key = await signalKey(peer, conversationId);
      const ts = Date.now();
      const base = {
        v: 1 as const,
        kind,
        callId,
        conversationId,
        from: profile.id,
        to: peer.userId,
        ts,
      };
      const { iv, ct } = await encryptJson(key, data, callAad(base));
      const unsigned = { ...base, iv, ct };
      const sig = await signPayload(identity.sig.privateKey, canonicalCall(unsigned));
      const envelope: CallEnvelope = { ...unsigned, sig };
      const event = `call-${kind}`;

      const [realtimeRes, dbRes] = await Promise.allSettled([
        sendUserEventTo(peer.userId, event, envelope),
        storeCallSignal({
          callId,
          conversationId,
          recipientId: peer.userId,
          event,
          envelope,
        }),
      ]);

      if (realtimeRes.status === 'rejected' && dbRes.status === 'rejected') {
        throw new Error('Unable to reach your contact right now.');
      }
    },
    [identity, profile, sendUserEventTo, signalKey],
  );

  const markConnected = useCallback(
    (callId: string) => {
      stopRingTimer();
      setCall((current) =>
        current.callId === callId && current.status !== 'active'
          ? {
              ...current,
              status: 'active',
              startedAt: current.startedAt ?? Date.now(),
              error: null,
            }
          : current,
      );
    },
    [stopRingTimer],
  );

  const drainPendingIce = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current.splice(0, pendingIceRef.current.length);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore stale candidates after renegotiation.
      }
    }
  }, []);

  const createPeerConnection = useCallback(
    (peer: ConversationMember, conversationId: string, callId: string): RTCPeerConnection => {
      const pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 4,
      });
      const remote = new MediaStream();
      remoteStreamRef.current = remote;
      setRemoteStream(remote);

      pc.ontrack = (event) => {
        const tracks = event.streams[0]?.getTracks() ?? [event.track];
        for (const track of tracks) {
          if (!remote.getTracks().some((existing) => existing.id === track.id)) {
            remote.addTrack(track);
          }
        }
        const updatedStream = new MediaStream(remote.getTracks());
        remoteStreamRef.current = updatedStream;
        setRemoteStream(updatedStream);
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const candidateJson = event.candidate.toJSON();
        void initialSignalReadyRef.current
          .then(() =>
            sendSignal(peer, conversationId, callId, 'ice', {
              kind: 'ice',
              candidate: {
                candidate: candidateJson.candidate ?? '',
                sdpMid: candidateJson.sdpMid ?? null,
                sdpMLineIndex: candidateJson.sdpMLineIndex ?? null,
                usernameFragment: candidateJson.usernameFragment ?? null,
              },
            }),
          )
          .catch(() => undefined);
      };

      const checkState = () => {
        const state = pc.connectionState;
        const iceState = pc.iceConnectionState;

        if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
          if (disconnectTimerRef.current !== null) {
            window.clearTimeout(disconnectTimerRef.current);
            disconnectTimerRef.current = null;
          }
          markConnected(callId);
          return;
        }

        if (state === 'failed' || iceState === 'failed') {
          toast('The call connection dropped.', 'error');
          cleanup();
          return;
        }

        if (state === 'closed') {
          cleanup();
          return;
        }

        if (state === 'disconnected' || iceState === 'disconnected') {
          if (disconnectTimerRef.current === null) {
            disconnectTimerRef.current = window.setTimeout(() => {
              if (
                pcRef.current === pc &&
                (pc.connectionState === 'disconnected' ||
                  pc.iceConnectionState === 'disconnected' ||
                  pc.connectionState === 'failed')
              ) {
                toast('Call disconnected.', 'info');
                cleanup();
              }
            }, 6_500);
          }
        }
      };

      pc.onconnectionstatechange = checkState;
      pc.oniceconnectionstatechange = checkState;

      pcRef.current = pc;
      return pc;
    },
    [cleanup, markConnected, sendSignal, toast],
  );

  const openMedia = useCallback(
    async (video: boolean, mode: 'user' | 'environment' = 'user'): Promise<MediaStream> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Calls require HTTPS and a modern mobile or desktop browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: video
          ? {
              facingMode: { ideal: mode },
              width: { ideal: 960, max: 1280 },
              height: { ideal: 720, max: 960 },
              frameRate: { ideal: 24, max: 30 },
            }
          : false,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    },
    [],
  );

  const resolvePeer = useCallback(
    async (
      conversationId: string,
    ): Promise<{ conversation: Conversation; peer: ConversationMember } | null> => {
      if (!profile) return null;
      let conversation = conversationsRef.current.find((item) => item.id === conversationId);
      if (!conversation) {
        const refreshed = await refreshConversations(true).catch(() => []);
        conversation = refreshed.find((item) => item.id === conversationId);
      }
      if (!conversation || conversation.kind !== 'dm') return null;
      if (conversation.requestStatus === 'pending') return null;
      const peer = dmPeer(conversation, profile.id);
      if (!peer?.publicKey) return null;
      return { conversation, peer };
    },
    [profile, refreshConversations],
  );

  const startCall = useCallback(
    async (target: Conversation | string, video: boolean) => {
      if (!profile || !identity) return;
      if (callRef.current.status !== 'idle') {
        toast('You are already in a call.', 'info');
        return;
      }

      const conversation =
        typeof target === 'string'
          ? conversationsRef.current.find((item) => item.id === target)
          : target;
      const conversationId = conversation?.id ?? '';
      if (!conversation || conversation.kind !== 'dm') {
        toast('Calls are available in one-to-one chats.', 'info');
        return;
      }
      if (conversation.requestStatus === 'pending') {
        toast('Calls unlock once this message request is accepted.', 'info');
        return;
      }

      const peer = dmPeer(conversation, profile.id);
      if (!peer?.publicKey) {
        toast('This contact has not finished setting up encryption yet.', 'error');
        return;
      }

      const callId = randomId();
      pendingIceRef.current = [];

      let resolveOfferGate = () => {};
      initialSignalReadyRef.current = new Promise<void>((resolve) => {
        resolveOfferGate = resolve;
      });

      const nextState: CallState = {
        status: 'outgoing',
        callId,
        conversationId,
        peerId: peer.userId,
        peerName: peer.displayName,
        peerAvatarId: peer.avatarId,
        video,
        startedAt: null,
        error: null,
      };
      callRef.current = nextState;
      setCall(nextState);

      try {
        const stream = await openMedia(video, 'user');
        const pc = createPeerConnection(peer, conversationId, callId);
        for (const track of stream.getTracks()) pc.addTrack(track, stream);

        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: video,
        });
        await pc.setLocalDescription(offer);
        if (!offer.sdp) throw new Error('Unable to create a call offer.');

        await sendSignal(peer, conversationId, callId, 'offer', {
          kind: 'offer',
          video,
          sdp: { type: offer.type, sdp: offer.sdp },
        });
        resolveOfferGate();

        stopRingTimer();
        ringTimerRef.current = window.setTimeout(() => {
          if (callRef.current.callId === callId && callRef.current.status === 'outgoing') {
            void sendSignal(peer, conversationId, callId, 'end', {
              kind: 'end',
              reason: 'timeout',
            }).catch(() => undefined);
            toast('No answer.', 'info');
            cleanup();
          }
        }, RING_TIMEOUT_MS);
      } catch (error) {
        resolveOfferGate();
        toast(mediaErrorMessage(error, video), 'error');
        cleanup();
      }
    },
    [cleanup, createPeerConnection, identity, openMedia, profile, sendSignal, stopRingTimer, toast],
  );

  const acceptCall = useCallback(async () => {
    const offer = pendingOfferRef.current;
    if (!offer || callRef.current.status !== 'incoming') return;
    stopRingTimer();

    let resolveAnswerGate = () => {};
    initialSignalReadyRef.current = new Promise<void>((resolve) => {
      resolveAnswerGate = resolve;
    });

    setCall((current) => ({ ...current, status: 'connecting', error: null }));

    try {
      const stream = await openMedia(offer.video, 'user');
      const pc = createPeerConnection(offer.peer, offer.conversationId, offer.callId);
      for (const track of stream.getTracks()) pc.addTrack(track, stream);

      await pc.setRemoteDescription(offer.sdp);
      await drainPendingIce(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (!answer.sdp) throw new Error('Unable to answer the call.');

      await sendSignal(offer.peer, offer.conversationId, offer.callId, 'answer', {
        kind: 'answer',
        sdp: { type: answer.type, sdp: answer.sdp },
      });
      resolveAnswerGate();
      pendingOfferRef.current = null;
    } catch (error) {
      resolveAnswerGate();
      toast(mediaErrorMessage(error, offer.video), 'error');
      void sendSignal(offer.peer, offer.conversationId, offer.callId, 'decline', {
        kind: 'decline',
      }).catch(() => undefined);
      cleanup();
    }
  }, [cleanup, createPeerConnection, drainPendingIce, openMedia, sendSignal, stopRingTimer, toast]);

  const declineCall = useCallback(async () => {
    const offer = pendingOfferRef.current;
    cleanup();
    if (!offer) return;
    await sendSignal(offer.peer, offer.conversationId, offer.callId, 'decline', {
      kind: 'decline',
    }).catch(() => undefined);
  }, [cleanup, sendSignal]);

  const endCall = useCallback(async () => {
    const current = callRef.current;
    cleanup();
    if (!current.callId || !current.conversationId || !profile) return;
    const resolved = await resolvePeer(current.conversationId);
    if (!resolved) return;
    await sendSignal(resolved.peer, current.conversationId, current.callId, 'end', {
      kind: 'end',
    }).catch(() => undefined);
  }, [cleanup, profile, resolvePeer, sendSignal]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextMuted = !micMuted;
    for (const track of stream.getAudioTracks()) track.enabled = !nextMuted;
    setMicMuted(nextMuted);
  }, [micMuted]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextOff = !cameraOff;
    for (const track of stream.getVideoTracks()) track.enabled = !nextOff;
    setCameraOff(nextOff);
  }, [cameraOff]);

  const switchCamera = useCallback(async () => {
    const currentStream = localStreamRef.current;
    const pc = pcRef.current;
    if (!currentStream || !pc || !callRef.current.video) return;

    const nextMode: 'user' | 'environment' = facingMode === 'user' ? 'environment' : 'user';
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: nextMode },
          width: { ideal: 960, max: 1280 },
          height: { ideal: 720, max: 960 },
        },
        audio: false,
      });
      const newVideoTrack = replacement.getVideoTracks()[0];
      if (!newVideoTrack) return;
      newVideoTrack.enabled = !cameraOff;

      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
      }

      for (const oldTrack of currentStream.getVideoTracks()) {
        currentStream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      currentStream.addTrack(newVideoTrack);
      const updated = new MediaStream(currentStream.getTracks());
      localStreamRef.current = updated;
      setLocalStream(updated);
      setFacingMode(nextMode);
    } catch {
      toast('Unable to switch camera on this device.', 'info');
    }
  }, [cameraOff, facingMode, toast]);

  const processCallEvent = useCallback(
    async (event: string, raw: unknown) => {
      if (!event.startsWith('call-') || !profile || !identity) return;
      const parsed = callEnvelopeSchema.safeParse(raw);
      if (!parsed.success) return;
      const envelope = parsed.data;
      if (`call-${envelope.kind}` !== event || envelope.to !== profile.id) return;

      const now = Date.now();
      for (const [seenKey, seenAt] of seenSignalsRef.current) {
        if (now - seenAt > SIGNAL_REPLAY_TTL_MS) seenSignalsRef.current.delete(seenKey);
      }
      const dedupeKey = `${envelope.callId}:${envelope.kind}:${envelope.sig}`;
      if (seenSignalsRef.current.has(dedupeKey)) return;

      const resolved = await resolvePeer(envelope.conversationId);
      if (!resolved || resolved.peer.userId !== envelope.from || !resolved.peer.publicKey) {
        return;
      }

      if (!(await verifyCallEnvelope(envelope, resolved.peer.publicKey))) {
        return;
      }

      let data: CallData;
      try {
        const key = await signalKey(resolved.peer, envelope.conversationId);
        const decrypted = await decryptJson<unknown>(
          key,
          envelope.iv,
          envelope.ct,
          callAad(envelope),
        );
        const parsedData = callDataSchema.safeParse(decrypted);
        if (!parsedData.success || parsedData.data.kind !== envelope.kind) return;
        data = parsedData.data;
        seenSignalsRef.current.set(dedupeKey, now);
      } catch {
        return;
      }

      if (data.kind === 'offer') {
        if (callRef.current.status !== 'idle') {
          if (callRef.current.callId === envelope.callId) return;
          void sendSignal(resolved.peer, envelope.conversationId, envelope.callId, 'decline', {
            kind: 'decline',
            reason: 'busy',
          }).catch(() => undefined);
          return;
        }
        pendingIceRef.current = [];
        pendingOfferRef.current = {
          callId: envelope.callId,
          conversationId: envelope.conversationId,
          peer: resolved.peer,
          video: data.video,
          sdp: data.sdp,
        };
        const incoming: CallState = {
          status: 'incoming',
          callId: envelope.callId,
          conversationId: envelope.conversationId,
          peerId: resolved.peer.userId,
          peerName: resolved.peer.displayName,
          peerAvatarId: resolved.peer.avatarId,
          video: data.video,
          startedAt: null,
          error: null,
        };
        callRef.current = incoming;
        setCall(incoming);
        stopRingTimer();
        ringTimerRef.current = window.setTimeout(() => {
          if (callRef.current.callId === envelope.callId && callRef.current.status === 'incoming') {
            cleanup();
          }
        }, RING_TIMEOUT_MS);
        return;
      }

      const current = callRef.current;
      if (data.kind === 'answer') {
        if (current.callId !== envelope.callId || !pcRef.current) return;
        stopRingTimer();
        setCall((state) => ({ ...state, status: 'connecting' }));
        try {
          await pcRef.current.setRemoteDescription(data.sdp);
          await drainPendingIce(pcRef.current);
        } catch {
          toast('Unable to complete the call handshake.', 'error');
          cleanup();
        }
        return;
      }

      if (data.kind === 'ice') {
        const activeCallId = current.callId ?? pendingOfferRef.current?.callId;
        if (!activeCallId || activeCallId !== envelope.callId) return;

        const candidateInit: RTCIceCandidateInit = {
          candidate: data.candidate.candidate,
          sdpMid: data.candidate.sdpMid ?? undefined,
          sdpMLineIndex: data.candidate.sdpMLineIndex ?? undefined,
          usernameFragment: data.candidate.usernameFragment ?? undefined,
        };

        const pc = pcRef.current;
        if (!pc || !pc.remoteDescription) {
          if (pendingIceRef.current.length < MAX_QUEUED_ICE) {
            pendingIceRef.current.push(candidateInit);
          }
          return;
        }

        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
        } catch {
          // Ignore late candidate after close.
        }
        return;
      }

      if (data.kind === 'decline' || data.kind === 'end') {
        if (current.callId !== envelope.callId) return;
        toast(data.kind === 'decline' ? 'Call declined.' : 'Call ended.', 'info');
        cleanup();
      }
    },
    [
      cleanup,
      drainPendingIce,
      identity,
      profile,
      resolvePeer,
      sendSignal,
      signalKey,
      stopRingTimer,
      toast,
    ],
  );

  useEffect(() => {
    handleSignalRef.current = (event, raw) => {
      void processCallEvent(event, raw);
    };
  }, [processCallEvent]);

  useEffect(() => {
    return subscribeUserEvents((event, raw) => {
      handleSignalRef.current(event, raw);
    });
  }, [subscribeUserEvents]);

  const isBusy = call.status !== 'idle';
  useEffect(() => {
    if (!profile || !identity) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (!isBusy && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      const rows = await pollCallSignals(pollCursorRef.current);
      if (cancelled || !rows.length) return;
      for (const row of rows) {
        if (!pollCursorRef.current || row.created_at > pollCursorRef.current) {
          pollCursorRef.current = row.created_at;
        }
        handleSignalRef.current(row.event, row.envelope);
      }
    };

    void tick();
    const interval = window.setInterval(
      () => {
        void tick();
      },
      isBusy ? 1_200 : 3_800,
    );

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [identity, isBusy, profile]);

  const canFlipCamera = call.video && call.status !== 'idle';

  const value = useMemo<CallContextValue>(
    () => ({
      call,
      localStream,
      remoteStream,
      micMuted,
      cameraOff,
      canFlipCamera,
      startCall,
      acceptCall,
      declineCall,
      endCall,
      toggleMic,
      toggleCamera,
      switchCamera,
    }),
    [
      acceptCall,
      call,
      cameraOff,
      canFlipCamera,
      declineCall,
      endCall,
      localStream,
      micMuted,
      remoteStream,
      startCall,
      switchCamera,
      toggleCamera,
      toggleMic,
    ],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCall must be used inside CallProvider.');
  return context;
}
