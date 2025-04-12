import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { io, Socket } from 'socket.io-client';

@Component({
  selector: 'app-webrtc',
  imports: [],
  templateUrl: './webrtc.component.html',
  styleUrl: './webrtc.component.scss'
})
export class WebrtcComponent implements OnInit {
  @ViewChild('localVideo') localVideoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo') remoteVideoRef!: ElementRef<HTMLVideoElement>;

  private socket!: Socket;
  private pc!: RTCPeerConnection;
  private localStream!: MediaStream;

  // Using a public STUN server
  private configuration: RTCConfiguration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  constructor() { }

  async ngOnInit() {
    // Connect to the signaling server
    this.socket = io('https://webrtc-nest-production.up.railway.app');

    // Listen for messages
    this.socket.on('offer', async (offer) => {
      await this.handleOffer(offer);
    });
    this.socket.on('answer', async (answer) => {
      await this.handleAnswer(answer);
    });
    this.socket.on('ice-candidate', async (candidate) => {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch (error) {
        console.error('Error adding ICE candidate', error);
      }
    });

    // Get local video and audio stream
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.localVideoRef.nativeElement.srcObject = this.localStream;
    } catch (error) {
      console.error('Error accessing media devices.', error);
    }

    // Create peer connection and add stream tracks
    this.createPeerConnection();
  }

  createPeerConnection() {
    this.pc = new RTCPeerConnection(this.configuration);

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.pc.addTrack(track, this.localStream);
      });
    }

    // When a remote track is received, assign it to the remote video element
    this.pc.ontrack = (event) => {
      this.remoteVideoRef.nativeElement.srcObject = event.streams[0];
    };

    // Gather and send ICE candidates
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', event.candidate);
      }
    };
  }

  // Trigger call initiation (for example, via a button click)
  async startCall() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.socket.emit('offer', offer);
  }

  async handleOffer(offer: RTCSessionDescriptionInit) {
    // Create peer connection if not already available
    if (!this.pc) {
      this.createPeerConnection();
    }
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.socket.emit('answer', answer);
  }

  async handleAnswer(answer: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
}
