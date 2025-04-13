import { Directive, ElementRef, Input, OnChanges, SimpleChanges } from '@angular/core';

@Directive({
  selector: '[appSrcObject]'
})
export class SrcObjectDirective implements OnChanges {
  @Input('appSrcObject') srcObject!: MediaStream | undefined;

  constructor(private el: ElementRef<HTMLVideoElement>) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['srcObject'] && this.srcObject) {
      const videoElement = this.el.nativeElement;
      videoElement.srcObject = this.srcObject;
    }
  }
}
