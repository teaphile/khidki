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
import type { CallState, Conversation, Identity, Profile, PublicKeyBundle } from '../types';
import { useAuth } from './AuthContext';
import { useChat } from './ChatContext';
import { useToast } from './ToastContext';
import { decryptJson, derivePairwiseKey, encryptJson, signPayload } from '../lib/crypto';
import {
  callAad,
  callDataSchema,
  callEnvelopeSchema,
  canonicalCall,
  verifyCallEnvelope,
} from '../lib/calls';
import type { CallData, CallEnvelope, CallKind } from '../lib/calls';

const EMPTY_CALL: CallState = {
  status: 'idle',
  callId: null,
  conversationId: null,
  peerId: null,
  peerName: '',
  video: false,
  startedAt: null,
  error: null,
};

const RING_TIMEOUT_MS = 45_000;
const CONNECT_TIMEOUT_MS = 30_000;
const CALL_REPLAY_TTL_MS = 180_000;

type CallContextValue = {
  call: CallState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  cameraOn: boolean;
  startCall: (conversation: Conversation, video: boolean) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
};

const CallContext = createContext<CallContextValue | null>(null);

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  const url = (import.meta.env.VITE_TURN_URL as string | undefined)?.trim();
  const username = (import.meta.env.VITE_TURN_USERNAME as string | undefined)?.trim();
  const credential = (import.meta.env.VITE_TURN_CREDENTIAL as string | undefined)?.trim();
  if (url) {
    servers.push({
      urls: url,
      username: username || undefined,
      credential: credential || undefined,
    });
  }
  return servers;
}

function CallSession({
  profile,
  identity,
  children,
}: {
  profile: Profile;
  identity: Identity;
  children: ReactNode;
}) {
  const { conversations, refreshConversations, sendUserEventTo, subscribeUserEvents } = useChat();
  const { toast } = useToast();
  const [call, setCall] = useState<CallState>(EMPTY_CALL);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);

  const callRef = useRef<CallState>(EMPTY_CALL);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerPublicRef = useRef<PublicKeyBundle | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const offerRef = useRef<RTCSessionDescriptionInit | null>(null);
  const seenEnvelopesRef = useRef<Map<string, number>>(new Map());
  const ringTimerRef = useRef<number | null>(null);
  const connectTimerRef = useRef<number | null>(null);
  const disconnectTimerRef = useRef<number | null>(null);

  const updateCall = useCallback((patch: Partial<CallState>) => {
    setCall((current) => {
      const next = { ...current, ...patch };
      callRef.current = next;
      return next;
    });
  }, []);

  const clearTimers = useCallback(() => {
    if (ringTimerRef.current !== null) window.clearTimeout(ringTimerRef.current);
    if (connectTimerRef.current !== null) window.clearTimeout(connectTimerRef.current);
    if (disconnectTimerRef.current !== null) window.clearTimeout(disconnectTimerRef.current);
    ringTimerRef.current = null;
    connectTimerRef.current = null;
    disconnectTimerRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    clearTimers();
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) track.stop();
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      for (const track of remoteStreamRef.current.getTracks()) track.stop();
      remoteStreamRef.current = null;
    }
    pendingIceRef.current = [];
    offerRef.current = null;
    peerPublicRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setMuted(false);
    setCameraOn(false);
    callRef.current = EMPTY_CALL;
    setCall(EMPTY_CALL);
  }, [clearTimers]);

  const sendSignal = useCallback(
    async (
      peerId: string,
      peerPublic: PublicKeyBundle,
      conversationId: string,
      callId: string,
      kind: CallKind,
      data: CallData,
    ): Promise<void> => {
      const ts = Date.now();
      const base = {
        v: 1 as const,
        kind,
        callId,
        conversationId,
        from: profile.id,
        to: peerId,
        ts,
      };
      const key = await derivePairwiseKey(
        identity.ecdh.privateKey,
        peerPublic.ecdh,
        `sotto-call:${callId}`,
      );
      const { iv, ct } = await encryptJson(
        key,
        callDataSchema.parse({ ...data, kind }),
        callAad(base),
      );
      const unsigned = { ...base, iv, ct };
      const signature = await signPayload(identity.sig.privateKey, canonicalCall(unsigned));
      const envelope: CallEnvelope = { ...unsigned, sig: signature };
      await sendUserEventTo(peerId, `call-${kind}`, envelope);
    },
    [identity, profile.id, sendUserEventTo],
  );

  const toastCallError = useCallback(
    (message: string) => {
      cleanup();
      toast(message, 'error');
    },
    [cleanup, toast],
  );

  const handleConnectionState = useCallback(
    (pc: RTCPeerConnection) => {
      if (pcRef.current !== pc) return;
      if (pc.connectionState === 'connected') {
        clearTimers();
        if (disconnectTimerRef.current !== null) {
          window.clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
        if (callRef.current.status !== 'active') {
          updateCall({ status: 'active', startedAt: Date.now() });
        }
        return;
      }
      if (pc.connectionState === 'failed') {
        toastCallError('The call connection failed. Try again on a more reliable network.');
        return;
      }
      if (pc.connectionState === 'disconnected') {
        if (disconnectTimerRef.current !== null) return;
        disconnectTimerRef.current = window.setTimeout(() => {
          if (pcRef.current?.connectionState === 'disconnected') {
            toastCallError('The call lost its connection.');
          }
        }, 8_000);
      }
      if (pc.connectionState === 'closed' && callRef.current.status !== 'idle') {
        cleanup();
      }
    },
    [cleanup, clearTimers, toastCallError, updateCall],
  );

  const setupPeer = useCallback(
    (stream: MediaStream, peerPublic: PublicKeyBundle, conversationId: string, callId: string) => {
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      pcRef.current = pc;
      peerPublicRef.current = peerPublic;
      for (const track of stream.getTracks()) pc.addTrack(track, stream);

      const remote = new MediaStream();
      remoteStreamRef.current = remote;
      pc.ontrack = (event) => {
        for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
          if (!remote.getTracks().some((existing) => existing.id === track.id)) {
            remote.addTrack(track);
          }
        }
        setRemoteStream(new MediaStream(remote.getTracks()));
      };

      pc.onicecandidate = (event) => {
        const candidate = event.candidate;
        if (!candidate?.candidate) return;
        if (callRef.current.callId !== callId) return;
        void sendSignal(callRef.current.peerId ?? '', peerPublic, conversationId, callId, 'ice', {
          kind: 'ice',
          candidate: {
            candidate: candidate.candidate.slice(0, 7_800),
            sdpMid: candidate.sdpMid?.slice(0, 128) ?? null,
            sdpMLineIndex:
              candidate.sdpMLineIndex === null
                ? null
                : Math.min(128, Math.max(0, candidate.sdpMLineIndex)),
            usernameFragment: candidate.usernameFragment?.slice(0, 256) ?? null,
          },
        }).catch(() => undefined);
      };

      pc.onconnectionstatechange = () => handleConnectionState(pc);
      return pc;
    },
    [handleConnectionState, sendSignal],
  );

  const drainIce = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // A stale candidate can be ignored; later candidates may still connect.
      }
    }
  }, []);

  const startCall = useCallback(
    async (conversation: Conversation, video: boolean) => {
      const initial = callRef.current;
      if (initial.status !== 'idle') {
        toast('Finish the current call first.', 'error');
        return;
      }
      if (conversation.kind !== 'dm') {
        toast('Calls are available in direct messages only.', 'error');
        return;
      }
      const peer = conversation.members.find((member) => member.userId !== profile.id);
      if (!peer?.publicKey) {
        toast('This person has not completed secure setup yet.', 'error');
        return;
      }

      const peerKey = peer.publicKey;
      const callId = crypto.randomUUID();
      peerPublicRef.current = peerKey;
      updateCall({
        status: 'outgoing',
        callId,
        conversationId: conversation.id,
        peerId: peer.userId,
        peerName: peer.displayName,
        video,
        startedAt: null,
        error: null,
      });

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: video
            ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
            : false,
        });
        if (callRef.current.callId !== callId || callRef.current.status !== 'outgoing') {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        setCameraOn(video);
        const pc = setupPeer(stream, peerKey, conversation.id, callId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (!pc.localDescription) throw new Error('Unable to prepare the call.');
        await sendSignal(peer.userId, peerKey, conversation.id, callId, 'offer', {
          kind: 'offer',
          video,
          sdp: { type: 'offer', sdp: pc.localDescription.sdp },
        });
        ringTimerRef.current = window.setTimeout(() => {
          if (callRef.current.callId !== callId) return;
          toast('No answer. The call ended.', 'info');
          const current = callRef.current;
          cleanup();
          if (current.peerId && current.conversationId) {
            void sendSignal(current.peerId, peerKey, current.conversationId, callId, 'end', {
              kind: 'end',
            }).catch(() => undefined);
          }
        }, RING_TIMEOUT_MS);
      } catch (error) {
        const message =
          error instanceof Error && /denied|permission|not found/i.test(error.message)
            ? 'Camera or microphone permission was denied.'
            : 'The call could not be started.';
        toastCallError(message);
      }
    },
    [cleanup, profile.id, sendSignal, setupPeer, toast, toastCallError, updateCall],
  );

  const acceptCall = useCallback(async () => {
    const current = callRef.current;
    if (
      current.status !== 'incoming' ||
      !current.callId ||
      !current.conversationId ||
      !current.peerId
    ) {
      return;
    }
    const peerPublic = peerPublicRef.current;
    const offer = offerRef.current;
    if (!peerPublic || !offer) return;
    const callId = current.callId;
    const conversationId = current.conversationId;
    const peerId = current.peerId;
    updateCall({ status: 'connecting' });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: current.video
          ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
          : false,
      });
      if (callRef.current.callId !== callId) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCameraOn(current.video);
      const pc = setupPeer(stream, peerPublic, conversationId, callId);
      await pc.setRemoteDescription(offer);
      await drainIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (!pc.localDescription) throw new Error('Unable to answer the call.');
      await sendSignal(peerId, peerPublic, conversationId, callId, 'answer', {
        kind: 'answer',
        sdp: { type: 'answer', sdp: pc.localDescription.sdp },
      });
      connectTimerRef.current = window.setTimeout(() => {
        if (callRef.current.callId === callId && callRef.current.status === 'connecting') {
          toastCallError('The call could not connect.');
          void sendSignal(peerId, peerPublic, conversationId, callId, 'end', {
            kind: 'end',
          }).catch(() => undefined);
        }
      }, CONNECT_TIMEOUT_MS);
    } catch {
      toastCallError('Camera or microphone permission was denied.');
      void sendSignal(peerId, peerPublic, conversationId, callId, 'decline', {
        kind: 'decline',
        reason: 'media',
      }).catch(() => undefined);
    }
  }, [drainIce, sendSignal, setupPeer, toastCallError, updateCall]);

  const declineCall = useCallback(async () => {
    const current = callRef.current;
    if (current.status !== 'incoming') return;
    const captured = { ...current, publicKey: peerPublicRef.current };
    cleanup();
    if (captured.callId && captured.peerId && captured.conversationId && captured.publicKey) {
      void sendSignal(
        captured.peerId,
        captured.publicKey,
        captured.conversationId,
        captured.callId,
        'decline',
        { kind: 'decline' },
      ).catch(() => undefined);
    }
  }, [cleanup, sendSignal]);

  const endCall = useCallback(async () => {
    const current = callRef.current;
    if (current.status === 'idle') return;
    const captured = { ...current, publicKey: peerPublicRef.current };
    cleanup();
    if (captured.callId && captured.peerId && captured.conversationId && captured.publicKey) {
      void sendSignal(
        captured.peerId,
        captured.publicKey,
        captured.conversationId,
        captured.callId,
        'end',
        { kind: 'end' },
      ).catch(() => undefined);
    }
  }, [cleanup, sendSignal]);

  const handleSignal = useCallback(
    async (event: string, payload: unknown) => {
      const parsedEnvelope = callEnvelopeSchema.safeParse(payload);
      if (!parsedEnvelope.success) return;
      const envelope = parsedEnvelope.data;
      if (event !== `call-${envelope.kind}`) return;
      if (envelope.to !== profile.id || envelope.from === profile.id) return;

      const now = Date.now();
      for (const [key, seenAt] of seenEnvelopesRef.current) {
        if (now - seenAt > CALL_REPLAY_TTL_MS) seenEnvelopesRef.current.delete(key);
      }
      const replayKey = `${envelope.callId}:${envelope.kind}:${envelope.iv}`;
      if (seenEnvelopesRef.current.has(replayKey)) return;

      let conversation = conversations.find((item) => item.id === envelope.conversationId);
      let peer = conversation?.members.find((member) => member.userId === envelope.from);
      let verified = Boolean(
        peer?.publicKey && (await verifyCallEnvelope(envelope, peer.publicKey)),
      );

      if (!verified) {
        const refreshed = await refreshConversations(true).catch(() => null);
        conversation = refreshed?.find((item) => item.id === envelope.conversationId);
        peer = conversation?.members.find((member) => member.userId === envelope.from);
        verified = Boolean(peer?.publicKey && (await verifyCallEnvelope(envelope, peer.publicKey)));
      }
      if (!conversation || !peer?.publicKey || !verified) return;
      if (conversation.kind !== 'dm') return;

      seenEnvelopesRef.current.set(replayKey, now);
      const peerKey = peer.publicKey;

      let data: CallData;
      try {
        const key = await derivePairwiseKey(
          identity.ecdh.privateKey,
          peerKey.ecdh,
          `sotto-call:${envelope.callId}`,
        );
        const decrypted = await decryptJson<unknown>(
          key,
          envelope.iv,
          envelope.ct,
          callAad(envelope),
        );
        data = callDataSchema.parse(decrypted);
      } catch {
        return;
      }
      if (data.kind !== envelope.kind) return;

      if (data.kind === 'offer') {
        if (callRef.current.status !== 'idle') {
          if (callRef.current.callId === envelope.callId) return;
          void sendSignal(peer.userId, peerKey, conversation.id, envelope.callId, 'decline', {
            kind: 'decline',
            reason: 'busy',
          }).catch(() => undefined);
          return;
        }
        offerRef.current = data.sdp;
        peerPublicRef.current = peerKey;
        updateCall({
          status: 'incoming',
          callId: envelope.callId,
          conversationId: conversation.id,
          peerId: peer.userId,
          peerName: peer.displayName,
          video: data.video,
          startedAt: null,
          error: null,
        });
        ringTimerRef.current = window.setTimeout(() => {
          if (callRef.current.callId !== envelope.callId) return;
          toast('Missed call.', 'info');
          cleanup();
          void sendSignal(peer.userId, peerKey, conversation.id, envelope.callId, 'decline', {
            kind: 'decline',
            reason: 'timeout',
          }).catch(() => undefined);
        }, RING_TIMEOUT_MS);
        return;
      }

      if (callRef.current.callId !== envelope.callId) return;
      const pc = pcRef.current;

      if (data.kind === 'answer') {
        if (
          !pc ||
          (callRef.current.status !== 'outgoing' && callRef.current.status !== 'connecting')
        ) {
          return;
        }
        try {
          await pc.setRemoteDescription(data.sdp);
          await drainIce(pc);
          if (ringTimerRef.current !== null) window.clearTimeout(ringTimerRef.current);
          updateCall({ status: 'connecting' });
          connectTimerRef.current = window.setTimeout(() => {
            if (
              callRef.current.callId === envelope.callId &&
              callRef.current.status === 'connecting'
            ) {
              toastCallError('The call could not connect.');
              void sendSignal(peer.userId, peerKey, conversation.id, envelope.callId, 'end', {
                kind: 'end',
              }).catch(() => undefined);
            }
          }, CONNECT_TIMEOUT_MS);
        } catch {
          toastCallError('The call could not connect.');
        }
        return;
      }

      if (data.kind === 'ice') {
        if (!pc) return;
        if (!pc.remoteDescription) {
          pendingIceRef.current.push(data.candidate);
          return;
        }
        try {
          await pc.addIceCandidate(data.candidate);
        } catch {
          // Ignore stale candidates.
        }
        return;
      }

      if (data.kind === 'decline') {
        toast('The call was declined.', 'info');
        cleanup();
        return;
      }

      if (data.kind === 'end') {
        toast('The call ended.', 'info');
        cleanup();
      }
    },
    [
      cleanup,
      conversations,
      drainIce,
      identity.ecdh.privateKey,
      profile.id,
      refreshConversations,
      sendSignal,
      toast,
      toastCallError,
      updateCall,
    ],
  );

  useEffect(() => {
    const unsubscribe = subscribeUserEvents((event, payload) => {
      if (event.startsWith('call-')) void handleSignal(event, payload);
    });
    return unsubscribe;
  }, [handleSignal, subscribeUserEvents]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !stream.getAudioTracks().every((track) => track.enabled);
    for (const track of stream.getAudioTracks()) track.enabled = next;
    setMuted(!next);
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !stream.getVideoTracks().every((track) => track.enabled);
    for (const track of stream.getVideoTracks()) track.enabled = next;
    setCameraOn(next);
  }, []);

  const value = useMemo<CallContextValue>(
    () => ({
      call,
      localStream,
      remoteStream,
      muted,
      cameraOn,
      startCall,
      acceptCall,
      declineCall,
      endCall,
      toggleMute,
      toggleCamera,
    }),
    [
      call,
      localStream,
      remoteStream,
      muted,
      cameraOn,
      startCall,
      acceptCall,
      declineCall,
      endCall,
      toggleMute,
      toggleCamera,
    ],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { profile, identity } = useAuth();
  if (!profile || !identity) return null;
  return (
    <CallSession profile={profile} identity={identity}>
      {children}
    </CallSession>
  );
}

export function useCall(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCall must be used inside CallProvider.');
  return context;
}
