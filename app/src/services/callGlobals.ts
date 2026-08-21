import { RTCIceCandidate } from './webrtc';

let currentPeer: RTCPeerConnection | null = null;
let pendingCandidates: any[] = [];

export function getCurrentPeer() {
  return currentPeer;
}

export function setCallPeer(pc: RTCPeerConnection | null) {
  currentPeer = pc;
}

export function addPendingCandidate(candidate: any) {
  pendingCandidates.push(candidate);
}

export function flushPendingCandidates() {
  const pending = pendingCandidates;
  pendingCandidates = [];
  pending.forEach((candidate) => {
    if (currentPeer) {
      currentPeer.addIceCandidate(new RTCIceCandidate(candidate)).catch((err) => {
        console.error('Error adding pending ICE candidate:', err);
      });
    }
  });
}

export function teardownCall() {
  if (currentPeer) {
    try {
      currentPeer.close();
    } catch (err) {
      console.error('[callGlobals] Error closing peer on teardown:', err);
    }
    currentPeer = null;
  }
  pendingCandidates = [];
}
