import { Component, EventEmitter, Input, Output, Signal, TemplateRef, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/** Set / change the branch of a tour inquiry or a complaint (Manage.showItemBranch). Markup moved from
 *  manage.html; the chosen branch stays Manage's own field (two-way), and opening, closing and saving stay in Manage. */
@Component({
  selector: 'app-manage-item-branch-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './manage-item-branch-modal.html',
  // Shared popup look first, so the page's own rules override its defaults (as in Manage).
  styleUrls: ['../../../styles/form-popup.css', './manage-item-branch-modal.css']
})
export class ManageItemBranchModal {
  /** Manage's #inqIcon template (also used by the list and the other popups). */
  @Input({ required: true }) inqIcon!: TemplateRef<any>;
  /** The inquiry / complaint (Manage.itemBranchItem). */
  @Input({ required: true }) bi!: any;
  /** Manage.entity ('contacts' | 'complaints'). */
  @Input({ required: true }) entity!: string;
  /** Manage.itemBranchLine (through Manage.itemBranchLineFn). */
  @Input({ required: true }) itemBranchLine!: (item: any) => string;
  @Input({ required: true }) itemBranches!: Signal<{ id: number; name: string }[]>;
  /** Manage.itemBranchId (through Manage.itemBranchIdFn). */
  @Input({ required: true }) itemBranchId!: (item: any) => number | null;
  /** Manage.itemBranchValue, two-way. The template reads and writes it as a plain value (itemBranchValue). */
  readonly itemBranchValueModel = model<number | null>(null);
  get itemBranchValue(): number | null { return this.itemBranchValueModel(); }
  set itemBranchValue(value: number | null) { this.itemBranchValueModel.set(value); }
  @Input({ required: true }) itemBranchError!: Signal<string>;
  @Input({ required: true }) itemBranchSaving!: Signal<boolean>;
  /** Manage.closeItemBranch. */
  @Output() closeItemBranch = new EventEmitter<void>();
  /** Manage.saveItemBranch. */
  @Output() saveItemBranch = new EventEmitter<void>();
}
