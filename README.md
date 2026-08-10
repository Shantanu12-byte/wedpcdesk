# WebPCDeck - Custom Macro Deck Desktop Control App

WebPCDeck is a cross-platform desktop control application (specifically optimized for Windows) that lets you trigger OS-level commands (launching apps, simulating keyboard shortcuts, volume management, power states) from a responsive, real-time web interface.

It features a local Node.js Express & WebSocket backend packaged in Electron, and supports secure control from any mobile phone on the same Wi-Fi network using a 6-digit pairing code.

---

## Architecture Overview

- **Frontend**: Built with React (TypeScript + Vite) and styled with Vanilla CSS using glassmorphic dark-mode aesthetics. Communication is handled in real-time via WebSockets.
- **Backend**: An Express + WebSocket server running locally on the PC, binding to `0.0.0.0` (all interfaces) to allow LAN access, with token-based authentication and loopback auto-approval.
- **Desktop Shell**: An Electron wrapper that boots the local server, manages a Windows system tray icon (run in background, minimize-to-tray, restore), and renders the frontend frame.

---

## Features

1. **Customizable Button Grid**: Edit buttons, pick emojis/colors, assign actions, and drag-and-drop to reorder.
2. **Windows OS-Level Actions**:
   - **Launch App**: Detached spawning of executables (e.g. `notepad.exe`) or URLs.
   - **Keyboard Shortcuts**: Simulated modifier/key combinations using PowerShell and `WScript.Shell`.
   - **Volume Control**: Increase, decrease, or toggle mute.
   - **System Power**: Sleep, lock screen, minimize all windows, restart, or shutdown (with confirmation safeguards).
   - **Custom Shell Command**: Run any cmd/powershell command line.
3. **Mobile Phone Control**: Open `http://<laptop-ip>:5001` on a phone browser, type the pairing code shown on your laptop screen, and control the PC from your phone.

---

## Quick Start (Development)

1. Clone or navigate to the workspace.
2. Install all dependencies for the root, backend, and frontend:
   ```bash
   npm run install-all
   ```
3. Start the application in development mode:
   ```bash
   npm run dev
   ```
   This will concurrently run the Vite frontend server, compile the TypeScript backend on the fly, and launch the Electron application pointing to localhost.

---

## Building for Production

To compile the application into a standalone package:

1. Build the backend and the frontend production bundle:
   ```bash
   npm run build --prefix backend
   npm run build:frontend
   ```
2. Start the production build inside Electron:
   ```bash
   npm run start
   ```

---

## How to Add a New Action Type

To add a new action type to the system, follow these steps:

### 1. Update Shared Types
Open [types.ts](file:///c:/webpcdeck/shared/types.ts) and add your new action type:
```typescript
// Add type key
export type ActionType = 'launch' | 'shortcut' | 'volume' | 'power' | 'command' | 'my_new_action';

// Extend config interface if you need new parameters
export interface ActionConfig {
  type: ActionType;
  // ...
  myNewParam?: string;
}
```

### 2. Implement the Action in the Executor
Open [windows.ts](file:///c:/webpcdeck/backend/src/actions/windows.ts), map the action in the switch statement, and implement the executor function:
```typescript
case 'my_new_action':
  return this.handleNewAction(action.myNewParam);

// Add the private executor
private handleNewAction(param?: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Run shell command, spawn process, or run PowerShell script
    exec(`echo "${param}"`, (err, stdout, stderr) => {
      if (err) resolve({ success: false, error: err.message });
      else resolve({ success: true });
    });
  });
}
```

### 3. Add to the Frontend Configuration Modal
Open [EditModal.tsx](file:///c:/webpcdeck/frontend/src/components/EditModal.tsx):
- Add a option for the action in the Select dropdown:
  ```tsx
  <option value="my_new_action">My Custom Action</option>
  ```
- Render inputs matching your action parameter if selected:
  ```tsx
  {actionType === 'my_new_action' && (
    <input 
      type="text" 
      value={myNewParam} 
      onChange={(e) => setMyNewParam(e.target.value)} 
      placeholder="Parameter" 
    />
  )}
  ```
- Save the parameter in the `handleSave` callback.
