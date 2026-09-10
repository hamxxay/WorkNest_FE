import { Injectable, signal } from '@angular/core';

export interface ToastItem {
  id: number;
  type: 'error' | 'success' | 'warning' | 'info';
  title?: string;
  message: string;
  duration?: number;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  toasts = signal<ToastItem[]>([]);
  private nextId = 1;

  show(message: string, type: 'error' | 'success' | 'warning' | 'info' = 'error', title?: string, duration: number = 5000) {
    if (!message) return;
    const id = this.nextId++;
    const item: ToastItem = { id, type, title, message, duration };
    this.toasts.update(list => [item, ...list]);

    if (duration > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, duration);
    }
  }

  error(message: string, title: string = 'Error') {
    this.show(message, 'error', title);
  }

  success(message: string, title: string = 'Success') {
    this.show(message, 'success', title);
  }

  warning(message: string, title: string = 'Warning') {
    this.show(message, 'warning', title);
  }

  info(message: string, title: string = 'Information') {
    this.show(message, 'info', title);
  }

  dismiss(id: number) {
    this.toasts.update(list => list.filter(t => t.id !== id));
  }

  clear() {
    this.toasts.set([]);
  }
}
