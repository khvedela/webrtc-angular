import { Component, ElementRef, OnInit, OnDestroy, signal, ViewChild } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SrcObjectDirective } from '../../shared/directives/src-object.directive';
import {MatIconModule} from '@angular/material/icon';

interface RemoteStream {
  userId: string;
  stream?: MediaStream;
}

@Component({
  selector: 'app-webrtc',
  imports: [
    MatToolbarModule,
    MatCardModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    SrcObjectDirective,
    MatIconModule
  ],
  templateUrl: './webrtc.component.html',
  styleUrl: './webrtc.component.scss'
})
export class WebrtcComponent implements OnInit, OnDestroy {
  @ViewChild('localVideo') localVideoRef!: ElementRef<HTMLVideoElement>;

  private socket!: Socket;
  private localStream!: MediaStream;
  peers: { [key: string]: RTCPeerConnection } = {};
  remoteUsers = signal<RemoteStream[]>([]);
  roomId = 'default-room';

  // Map to store remote streams associated with user IDs.
  private remoteStreams: Map<string, MediaStream> = new Map();

  private configuration: RTCConfiguration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  isMicMuted = false; // Track microphone state

  async ngOnInit() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      this.localVideoRef.nativeElement.srcObject = this.localStream;
    } catch (error) {
      console.error('Error accessing local media devices:', error);
      return;
    }

    this.socket = io('https://webrtc-nest-production.up.railway.app', { secure: true });
    this.socket.emit('join-room', { room: this.roomId });

    this.socket.on('user-joined', async (data: { userId: string }) => {
      const remoteUserId = data.userId;
      console.log('New user joined: ', remoteUserId);

      if (this.peers[remoteUserId]) {
        this.peers[remoteUserId].close();
        delete this.peers[remoteUserId];
      }

      this.createPeerConnection(remoteUserId, true);
    });

    this.socket.on('offer', async (data: { offer: RTCSessionDescriptionInit, sender: string }) => {
      const senderId = data.sender;
      console.log('Received offer from: ', senderId);
      this.remoteUsers.update((current: RemoteStream[]): RemoteStream[] => {
        if (!current.some((u: RemoteStream) => u.userId === senderId)) {
          return [...current, { userId: senderId, stream: undefined }];
        }
        return current;
      });
      this.createPeerConnection(senderId, false);
      const peer = this.peers[senderId];
      await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      this.socket.emit('answer', { answer, target: senderId });
    });

    this.socket.on('answer', async (data: { answer: RTCSessionDescriptionInit, sender: string }) => {
      const senderId = data.sender;
      console.log('Received answer from: ', senderId);
      const peer = this.peers[senderId];
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    this.socket.on('ice-candidate', async (data: { candidate: any, sender: string }) => {
      const senderId = data.sender;
      const peer = this.peers[senderId];
      if (peer) {
        try {
          await peer.addIceCandidate(data.candidate);
        } catch (error) {
          console.error('Error adding ICE candidate: ', error);
        }
      }
    });

    this.socket.on('user-disconnected', (data: { userId: string }) => {
      const { userId } = data;
      console.log('User disconnected: ', userId);
      this.cleanupRemoteUser(userId);
    });

    this.socket.on('room-users', (users: string[]) => {
      console.log('Updated room users:', users);

      // Update remote users list and ensure streams are properly handled.
      this.remoteUsers.set(
        users.map((userId) => ({
          userId,
          stream: this.remoteStreams.get(userId) || undefined, // Retrieve the remote stream from the Map
        }))
      );

      // Clean up peer connections for users no longer in the room.
      Object.keys(this.peers).forEach((peerId) => {
        if (!users.includes(peerId)) {
          this.cleanupRemoteUser(peerId);
        }
      });
    });
  }

  ngOnDestroy() {
    if (this.socket) {
      this.socket.emit('leave-room', { room: this.roomId });
      this.socket.disconnect();
    }

    Object.values(this.peers).forEach(peer => peer.close());
    this.peers = {};
  }

  createPeerConnection(remoteUserId: string, isInitiator: boolean) {
    if (this.peers[remoteUserId]) {
      console.warn(`Peer connection already exists for user: ${remoteUserId}`);
      return;
    }

    const peer = new RTCPeerConnection(this.configuration);
    this.peers[remoteUserId] = peer;

    // Create a new MediaStream for the remote user.
    const remoteStream = new MediaStream();
    this.remoteStreams.set(remoteUserId, remoteStream);

    // Add all local tracks to the peer connection.
    this.localStream.getTracks().forEach(track => {
      peer.addTrack(track, this.localStream);
    });

    // Update remote stream when a new track is received.
    peer.ontrack = (event) => {
      console.log(`Received remote stream from ${remoteUserId}`);
      event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });

      // Debugging: Log the remote stream
      console.log(`Updated remote stream for ${remoteUserId}:`, remoteStream);

      this.remoteUsers.update((current: RemoteStream[]): RemoteStream[] => {
        const existingUser = current.find((user) => user.userId === remoteUserId);
        if (existingUser) {
          return current.map((user) =>
            user.userId === remoteUserId ? { ...user, stream: remoteStream } : user
          );
        } else {
          return [...current, { userId: remoteUserId, stream: remoteStream }];
        }
      });
    };

    // Relay ICE candidates.
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', { candidate: event.candidate, target: remoteUserId });
      }
    };

    // Handle negotiation for initiators.
    if (isInitiator) {
      peer.onnegotiationneeded = async () => {
        try {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          this.socket.emit('offer', { offer, target: remoteUserId });
        } catch (error) {
          console.error('Negotiation error with ', remoteUserId, error);
        }
      };
    }

    // Handle peer connection state changes for cleanup.
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
        console.log(`Peer connection with ${remoteUserId} closed.`);
        this.cleanupRemoteUser(remoteUserId);
      }
    };
  }

  cleanupRemoteUser(remoteUserId: string) {
    // Close and remove the peer connection.
    if (this.peers[remoteUserId]) {
      this.peers[remoteUserId].close();
      delete this.peers[remoteUserId];
    }

    // Remove the remote stream from the Map.
    this.remoteStreams.delete(remoteUserId);

    // Remove the remote user from the list.
    this.remoteUsers.update((current: RemoteStream[]) =>
      current.filter((user: RemoteStream) => user.userId !== remoteUserId)
    );
  }

  toggleMic() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        this.isMicMuted = !this.isMicMuted;
        audioTrack.enabled = !this.isMicMuted;
        console.log(`Microphone ${this.isMicMuted ? 'muted' : 'unmuted'}`);
      }
    }
  }
}