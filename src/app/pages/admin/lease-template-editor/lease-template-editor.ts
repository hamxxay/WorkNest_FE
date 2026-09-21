import { Component, OnInit, OnDestroy, signal, inject, AfterViewInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { LeaseTemplateService, LeaseTemplateDto } from '../../../services/lease-template.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-lease-template-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './lease-template-editor.html',
  styleUrl: './lease-template-editor.css'
})
export class LeaseTemplateEditor implements OnInit, AfterViewInit, OnDestroy {
  private templateSvc = inject(LeaseTemplateService);
  private toast = inject(ToastService);

  editor: Editor | null = null;
  loading = signal(true);
  publishing = signal(false);
  activeTemplate = signal<LeaseTemplateDto | null>(null);

  templateName = 'StandardLeaseAgreement';
  showConfirmModal = false;
  currentColor = '#0f172a';
  currentHighlight = '#fef08a';

  isSourceMode = false;
  sourceHtml = '';

  ngOnInit() {
    this.loadActiveTemplate();
  }

  ngAfterViewInit() {
    this.initEditor();
  }

  ngOnDestroy() {
    if (this.editor) {
      this.editor.destroy();
    }
  }

  initEditor() {
    const el = document.querySelector('#tiptap-editor-container');
    if (!el) return;

    this.editor = new Editor({
      element: el as HTMLElement,
      extensions: [
        StarterKit,
        Underline,
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({
          types: ['heading', 'paragraph']
        }),
        Link.configure({
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          HTMLAttributes: {
            target: '_blank',
            rel: 'noopener noreferrer'
          }
        }),
        Subscript,
        Superscript,
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        Placeholder.configure({
          placeholder: 'Write lease agreement clauses and legal terms here...'
        })
      ],
      content: this.activeTemplate()?.contentHtml || '<p>Loading template...</p>'
    });
  }

  // Color handlers
  setTextColor(color: string) {
    if (!this.editor) return;
    this.currentColor = color;
    this.editor.chain().focus().setColor(color).run();
  }

  onColorInput(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target?.value) {
      this.setTextColor(target.value);
    }
  }

  unsetColor() {
    if (!this.editor) return;
    this.editor.chain().focus().unsetColor().run();
  }

  // Highlight handlers
  setHighlightColor(color: string) {
    if (!this.editor) return;
    this.currentHighlight = color;
    this.editor.chain().focus().toggleHighlight({ color }).run();
  }

  onHighlightInput(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target?.value) {
      this.setHighlightColor(target.value);
    }
  }

  unsetHighlight() {
    if (!this.editor) return;
    this.editor.chain().focus().unsetHighlight().run();
  }

  // Link handler
  setLink() {
    if (!this.editor) return;
    const previousUrl = this.editor.getAttributes('link')['href'] || '';
    const url = window.prompt('Enter URL:', previousUrl);

    if (url === null) {
      return; // cancelled
    }

    if (url.trim() === '') {
      this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    this.editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  }

  // Clear Formatting
  clearFormatting() {
    if (!this.editor) return;
    this.editor.chain().focus().clearNodes().unsetAllMarks().run();
  }

  // Source Mode Handlers
  toggleSourceMode() {
    if (this.isSourceMode) {
      // Switching from Source to Visual
      if (this.editor) {
        this.editor.commands.setContent(this.sourceHtml || '<p></p>');
      }
      this.isSourceMode = false;
    } else {
      // Switching from Visual to Source
      if (this.editor) {
        this.sourceHtml = this.formatHtml(this.editor.getHTML());
      }
      this.isSourceMode = true;
    }
  }

  formatHtml(html: string): string {
    if (!html) return '';
    return html
      .replace(/></g, '>\n<')
      .replace(/(<\/h[1-6]>|<\/p>|<\/blockquote>|<\/table>|<\/tr>|<\/ul>|<\/ol>|<hr>|<br>)/gi, '$1\n')
      .trim();
  }

  copySource() {
    if (!this.sourceHtml) return;
    navigator.clipboard.writeText(this.sourceHtml).then(() => {
      this.toast.success('HTML source copied to clipboard!', 'Copied');
    }).catch(() => {
      this.toast.error('Could not copy to clipboard.', 'Error');
    });
  }

  loadActiveTemplate() {
    this.loading.set(true);
    this.templateSvc.getActiveTemplate(this.templateName).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (res?.isSuccessful && res.data) {
          this.activeTemplate.set(res.data);
          const html = res.data.contentHtml || '<p></p>';
          this.sourceHtml = this.formatHtml(html);
          if (this.editor) {
            this.editor.commands.setContent(html);
          }
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err?.error?.message || 'Failed to load active lease template.', 'Error');
      }
    });
  }

  openPublishConfirm() {
    const content = this.isSourceMode ? this.sourceHtml : (this.editor?.getHTML() || '');
    if (!content || content.trim() === '' || content === '<p></p>') {
      this.toast.error('Template content cannot be empty.', 'Validation Error');
      return;
    }
    this.showConfirmModal = true;
  }

  closePublishConfirm() {
    this.showConfirmModal = false;
  }

  publishTemplate() {
    let contentHtml = '';
    if (this.isSourceMode) {
      contentHtml = this.sourceHtml;
      if (this.editor) {
        this.editor.commands.setContent(contentHtml);
      }
    } else {
      if (!this.editor) return;
      contentHtml = this.editor.getHTML();
      this.sourceHtml = this.formatHtml(contentHtml);
    }

    this.publishing.set(true);
    this.showConfirmModal = false;

    this.templateSvc.publishTemplate(this.templateName, contentHtml).subscribe({
      next: (res) => {
        this.publishing.set(false);
        if (res?.isSuccessful && res.data) {
          this.activeTemplate.set(res.data);
          this.toast.success('New template version published successfully!', 'Published');
        }
      },
      error: (err) => {
        this.publishing.set(false);
        this.toast.error(err?.error?.message || 'Failed to publish template version.', 'Error');
      }
    });
  }
}
