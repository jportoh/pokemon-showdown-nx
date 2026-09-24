import { Pipe, PipeTransform } from '@angular/core';
import { usernameColor } from './username-color';

@Pipe({ name: 'usernameColor' })
export class UsernameColorPipe implements PipeTransform {
  transform(name: string): string {
    return usernameColor(name);
  }
}
