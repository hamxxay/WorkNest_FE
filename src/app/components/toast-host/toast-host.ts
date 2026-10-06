import { Component, inject } from '@angular/core';
import { ToastService } from '../../services/toast.service';

/** App-wide toast stack, rendered once in the root so public, customer and admin pages all show toasts. */
@Component({
  selector: 'app-toast-host',
  templateUrl: './toast-host.html',
  styleUrl: './toast-host.css'
})
export class ToastHost {
  toastService = inject(ToastService);
}
