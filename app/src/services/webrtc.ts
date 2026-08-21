import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';

const streamURLMap = new Map<string, MediaStream>();

function addToURL(stream: MediaStream): MediaStream {
  if (stream && typeof (stream as any).toURL !== 'function') {
    (stream as any).toURL = () => {
      try {
        const existing = (stream as any).__url;
        if (existing) streamURLMap.delete(existing);
        const url = URL.createObjectURL(stream);
        (stream as any).__url = url;
        streamURLMap.set(url, stream);
        return url;
      } catch {
        return '';
      }
    };
  }
  return stream;
}

export const RTCView: React.FC<{
  streamURL: string;
  style?: any;
  objectFit?: string;
  zOrder?: number;
  pointerEvents?: 'none' | 'auto' | 'box-none' | 'box-only';
}> = ({ streamURL, style, objectFit, zOrder, pointerEvents }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current || !streamURL) return;
    const stream = streamURLMap.get(streamURL);
    if (stream && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
  }, [streamURL]);

  return React.createElement('video', {
    ref: videoRef,
    autoPlay: true,
    playsInline: true,
    style: {
      ...StyleSheet.flatten(style),
      objectFit: objectFit || 'cover',
    },
  });
};

export const mediaDevices = {
  getUserMedia: async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      return addToURL(stream);
    }
    throw new Error('getUserMedia not available');
  },
};

const NativeRTCPeerConnection =
  (typeof window !== 'undefined' &&
    ((window as any).RTCPeerConnection || (window as any).webkitRTCPeerConnection)) ||
  undefined;

class RTCPeerConnectionWrapper {
  private pc: any;
  private _ontrack: ((event: any) => void) | null = null;
  private _onicecandidate: ((event: any) => void) | null = null;
  private audioElements: HTMLAudioElement[] = [];

  constructor(config?: RTCConfiguration) {
    if (NativeRTCPeerConnection) {
      this.pc = new NativeRTCPeerConnection(config);
      this.pc.ontrack = (event: any) => {
        if (event.streams) {
          const streams = Array.from(event.streams).map(addToURL);
          streams.forEach((stream: MediaStream) => {
            if (stream.getAudioTracks().length > 0) {
              const existing = this.audioElements.find(
                (el) => (el as any).__streamId === (stream as any).id
              );
              if (!existing) {
                const audio = new Audio();
                audio.srcObject = stream;
                audio.autoplay = true;
                audio.volume = 1.0;
                audio.style.display = 'none';
                document.body.appendChild(audio);
                (audio as any).__streamId = (stream as any).id;
                this.audioElements.push(audio);
              }
            }
          });
        }
        this._ontrack?.(event);
      };
      this.pc.onicecandidate = (event: any) => {
        this._onicecandidate?.(event);
      };
    }
  }

  set onicecandidate(cb: ((event: any) => void) | null) {
    this._onicecandidate = cb;
  }

  set ontrack(cb: ((event: any) => void) | null) {
    this._ontrack = cb;
  }

  createOffer(options?: any): Promise<any> {
    return this.pc?.createOffer(options) || Promise.resolve({ type: 'offer', sdp: '' });
  }

  createAnswer(options?: any): Promise<any> {
    return this.pc?.createAnswer(options) || Promise.resolve({ type: 'answer', sdp: '' });
  }

  setLocalDescription(desc: any): Promise<void> {
    return this.pc?.setLocalDescription(desc) || Promise.resolve();
  }

  setRemoteDescription(desc: any): Promise<void> {
    return this.pc?.setRemoteDescription(desc) || Promise.resolve();
  }

  addIceCandidate(candidate: any): Promise<void> {
    return this.pc?.addIceCandidate(candidate) || Promise.resolve();
  }

  addTrack(track: MediaStreamTrack, stream: MediaStream): void {
    this.pc?.addTrack(track, stream);
  }

  getSenders(): Array<{ track: MediaStreamTrack | null; replaceTrack: (track: MediaStreamTrack | null) => Promise<void> }> {
    return this.pc?.getSenders?.() || [];
  }

  close(): void {
    this.audioElements.forEach((el) => {
      el.pause();
      el.srcObject = null;
      el.remove();
    });
    this.audioElements = [];
    this.pc?.close();
  }

  get iceConnectionState(): string {
    return this.pc?.iceConnectionState || 'new';
  }
}

export { RTCPeerConnectionWrapper as RTCPeerConnection };

const w = typeof window !== 'undefined' ? window : ({} as any);
export const RTCSessionDescription = w.RTCSessionDescription;
export const RTCIceCandidate = w.RTCIceCandidate;
export const MediaStream = w.MediaStream;
