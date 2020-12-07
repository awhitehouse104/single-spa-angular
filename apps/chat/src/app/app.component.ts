import {
  Component,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  ChangeDetectorRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { mountRootParcel, ParcelConfig } from 'single-spa';

@Component({
  selector: 'chat-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class AppComponent {
  config: ParcelConfig | null = null;
  mountRootParcel = mountRootParcel;

  constructor(private router: Router, private ref: ChangeDetectorRef) {}

  goToChatGroups(): void {
    this.router.navigateByUrl('/groups');
  }

  ngOnInit() {
    // issue 234: same parcel should mount multiple times
    // @ts-ignore
    System.import('parcel').then((parcelConfig: ParcelConfig) => {
      this.config = parcelConfig;
      this.ref.detectChanges();
    });
  }
}
