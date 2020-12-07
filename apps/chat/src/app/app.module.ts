import { NgModule } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { APP_BASE_HREF } from '@angular/common';
import { ParcelModule } from 'single-spa-angular/parcel';

import { AppRoutingModule } from './app-routing.module';

import { AppComponent } from './app.component';

@NgModule({
  imports: [BrowserAnimationsModule, AppRoutingModule, ParcelModule],
  declarations: [AppComponent],
  bootstrap: [AppComponent],
  providers: [{ provide: APP_BASE_HREF, useValue: '/chat' }],
})
export class AppModule {}
