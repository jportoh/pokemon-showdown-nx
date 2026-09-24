import { NgOptimizedImage } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  imports: [NgOptimizedImage, RouterLink, RouterLinkActive, RouterOutlet],
  selector: 'app-main-layout',
  host: { class: 'flex h-[720px] w-[1280px] flex-col' },
  templateUrl: './main-layout.html',
})
export class MainLayout {}
