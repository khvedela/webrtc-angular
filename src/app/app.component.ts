import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { WebrtcComponent } from "./components/webrtc/webrtc.component";

@Component({
  selector: 'app-root',
  imports: [WebrtcComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'webrtc-angular';
}
