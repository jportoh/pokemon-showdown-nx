import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { markAppBooted } from './app/core/runtime/code-source';

bootstrapApplication(App, appConfig)
  .then(() => markAppBooted())
  .catch((err) => console.error(err));
