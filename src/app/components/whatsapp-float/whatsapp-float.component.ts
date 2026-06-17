import { Component } from '@angular/core';

@Component({
  selector: 'app-whatsapp-float',
  template: `
    <div class="floating_btn">
      <div class="chat-bubble">
        How can we help you?
      </div>
      <a target="_blank" href="https://wa.me/923080256000?text=Hi! I'm interested in booking a workspace at WorkNest.">
        <div class="contact_icon">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">
            <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2C6.62 2 2.2 6.42 2.2 11.84c0 1.74.45 3.45 1.31 4.96L2 22l5.34-1.4a9.86 9.86 0 0 0 4.7 1.2h.01c5.42 0 9.84-4.42 9.84-9.84a9.8 9.8 0 0 0-2.84-7.05Zm-7 15.22h-.01a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3.17.83.85-3.08-.2-.32a8.14 8.14 0 0 1-1.25-4.39c0-4.5 3.66-8.16 8.16-8.16 2.18 0 4.22.85 5.76 2.39a8.1 8.1 0 0 1 2.39 5.77c0 4.5-3.66 8.16-8.16 8.16Zm4.47-6.1c-.24-.12-1.4-.69-1.62-.77-.22-.08-.38-.12-.54.12-.16.24-.62.77-.76.93-.14.16-.28.18-.52.06-.24-.12-1-.37-1.91-1.18-.71-.63-1.19-1.41-1.33-1.65-.14-.24-.01-.36.11-.48.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.41-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.69 2.58 4.09 3.62.57.25 1.02.4 1.37.51.58.18 1.1.15 1.51.09.46-.07 1.4-.57 1.6-1.12.2-.55.2-1.02.14-1.12-.06-.1-.22-.16-.46-.28Z"/>
          </svg>
        </div>
      </a>
    </div>
  `,
  styles: [`
    a {
      text-decoration: none;
    }
    
    .floating_btn {
      position: fixed;
      bottom: 30px;
      right: 30px;
      width: 200px;
      height: 60px;
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      z-index: 1000;
    }

    @keyframes pulsing {
      to {
        box-shadow: 0 0 0 30px rgba(66, 219, 135, 0);
      }
    }

    .contact_icon {
      background-color: #42db87;
      color: #fff;
      width: 60px;
      height: 60px;
      font-size: 30px;
      border-radius: 50px;
      text-align: center;
      box-shadow: 2px 2px 3px #999;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: translatey(0px);
      box-shadow: 0 0 0 0 #42db87;
      -webkit-animation: pulsing 1.25s infinite cubic-bezier(0.66, 0, 0, 1);
      -moz-animation: pulsing 1.25s infinite cubic-bezier(0.66, 0, 0, 1);
      -ms-animation: pulsing 1.25s infinite cubic-bezier(0.66, 0, 0, 1);
      animation: pulsing 1.25s infinite cubic-bezier(0.66, 0, 0, 1);
      font-weight: normal;
      font-family: sans-serif;
      text-decoration: none !important;
      transition: all 300ms ease-in-out;
    }

    .chat-bubble {
      background: white;
      color: #333;
      padding: 10px 14px;
      border-radius: 18px;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      border: 1px solid #e0e0e0;
      position: relative;
      font-family: sans-serif;
    }

    .chat-bubble::after {
      content: '';
      position: absolute;
      right: -6px;
      top: 50%;
      transform: translateY(-50%);
      width: 0;
      height: 0;
      border: 8px solid transparent;
      border-left-color: white;
    }

    .chat-bubble::before {
      content: '';
      position: absolute;
      right: -7px;
      top: 50%;
      transform: translateY(-50%);
      width: 0;
      height: 0;
      border: 8px solid transparent;
      border-left-color: #e0e0e0;
    }
  `]
})
export class WhatsappFloatComponent {}