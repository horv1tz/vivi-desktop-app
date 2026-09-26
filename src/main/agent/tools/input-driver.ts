/** Abstraction over mouse/keyboard/window control; implementations live in ./drivers (Phase 7). */
export type MouseButton = 'left' | 'right' | 'middle'

export interface InputDriver {
  readonly name: string
  available(): Promise<boolean>
  getMousePos(): Promise<{ x: number; y: number }>
  moveMouse(x: number, y: number, smooth?: boolean): Promise<void>
  click(
    x: number | undefined,
    y: number | undefined,
    button: MouseButton,
    double: boolean,
  ): Promise<void>
  mouseDown(button: MouseButton): Promise<void>
  mouseUp(button: MouseButton): Promise<void>
  drag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    button: MouseButton,
  ): Promise<void>
  scroll(dx: number, dy: number): Promise<void>
  typeText(text: string): Promise<void>
  pressKeys(keys: string[]): Promise<void>
  focusWindow(target: { id?: number; title?: string; app?: string; pid?: number }): Promise<boolean>
  minimizeWindow?(target: {
    id?: number
    title?: string
    app?: string
    pid?: number
  }): Promise<boolean>
}
