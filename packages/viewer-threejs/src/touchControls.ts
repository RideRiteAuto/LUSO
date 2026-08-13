import type { FlightController, InteractionMode } from "./flightControls.js";

export function prefersTouchControls(params = new URLSearchParams(location.search)): boolean {
  if (params.get("touch") === "1") return true; // deterministic preview/testing override
  const coarse = matchMedia("(pointer: coarse)").matches;
  const compact = matchMedia("(max-width: 1024px), (max-height: 600px)").matches;
  return navigator.maxTouchPoints > 0 && coarse && compact;
}

export class TouchControls {
  readonly enabled = prefersTouchControls();
  private joystickPointer: number | null = null;
  private lookPointer: number | null = null;
  private lookX = 0;
  private lookY = 0;

  private readonly root = document.getElementById("mobileControls")!;
  private readonly joystick = document.getElementById("touchJoystick")!;
  private readonly knob = document.getElementById("touchJoystickKnob")!;
  private readonly lookPad = document.getElementById("touchLookPad")!;
  private readonly toolsButton = document.getElementById("touchTools") as HTMLButtonElement;
  private readonly upButton = document.getElementById("touchUp") as HTMLButtonElement;
  private readonly downButton = document.getElementById("touchDown") as HTMLButtonElement;
  private readonly boostButton = document.getElementById("touchBoost") as HTMLButtonElement;

  constructor(private readonly flight: FlightController) {
    if (!this.enabled) return;
    document.documentElement.classList.add("touch-controls-enabled");
    this.toolsButton.addEventListener("click", () => this.flight.toggleInteractionMode());
    this.joystick.addEventListener("pointerdown", this.onJoystickDown);
    this.joystick.addEventListener("pointermove", this.onJoystickMove);
    this.joystick.addEventListener("pointerup", this.onJoystickEnd);
    this.joystick.addEventListener("pointercancel", this.onJoystickEnd);
    this.lookPad.addEventListener("pointerdown", this.onLookDown);
    this.lookPad.addEventListener("pointermove", this.onLookMove);
    this.lookPad.addEventListener("pointerup", this.onLookEnd);
    this.lookPad.addEventListener("pointercancel", this.onLookEnd);
    this.bindHold(this.upButton, "up");
    this.bindHold(this.downButton, "down");
    this.bindHold(this.boostButton, "boost");
  }

  sync(mode: InteractionMode | "orbit"): void {
    if (!this.enabled) return;
    const active = mode !== "orbit";
    const navigating = mode === "navigate";
    this.root.classList.toggle("active", active);
    this.root.classList.toggle("navigating", navigating);
    this.toolsButton.textContent = navigating ? "Tools" : "Play";
    this.toolsButton.setAttribute("aria-label", navigating ? "Open world tools" : "Return to touch navigation");
    this.upButton.textContent = this.flight.currentMode === "walk" ? "Jump" : "Up";
    this.downButton.textContent = this.flight.currentMode === "walk" ? "Dive" : "Down";
    if (!navigating) this.releaseAll();
  }

  private bindHold(button: HTMLButtonElement, action: "up" | "down" | "boost"): void {
    const release = (event: PointerEvent) => {
      if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
      this.flight.setTouchAction(action, false);
      button.classList.remove("pressed");
    };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      this.flight.setTouchAction(action, true);
      button.classList.add("pressed");
    });
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
  }

  private onJoystickDown = (event: PointerEvent) => {
    event.preventDefault();
    this.joystickPointer = event.pointerId;
    this.joystick.setPointerCapture(event.pointerId);
    this.updateJoystick(event);
  };
  private onJoystickMove = (event: PointerEvent) => {
    if (event.pointerId === this.joystickPointer) this.updateJoystick(event);
  };
  private onJoystickEnd = (event: PointerEvent) => {
    if (event.pointerId !== this.joystickPointer) return;
    this.joystickPointer = null;
    this.knob.style.transform = "translate(-50%, -50%)";
    this.flight.setTouchMovement(0, 0);
  };
  private updateJoystick(event: PointerEvent): void {
    const rect = this.joystick.getBoundingClientRect();
    const radius = rect.width * 0.34;
    let dx = event.clientX - (rect.left + rect.width / 2);
    let dy = event.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy);
    if (length > radius) { dx *= radius / length; dy *= radius / length; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.flight.setTouchMovement(dx / radius, -dy / radius);
  }

  private onLookDown = (event: PointerEvent) => {
    event.preventDefault();
    if (this.lookPointer !== null) return;
    this.lookPointer = event.pointerId;
    this.lookX = event.clientX;
    this.lookY = event.clientY;
    this.lookPad.setPointerCapture(event.pointerId);
  };
  private onLookMove = (event: PointerEvent) => {
    if (event.pointerId !== this.lookPointer) return;
    this.flight.applyTouchLook(event.clientX - this.lookX, event.clientY - this.lookY);
    this.lookX = event.clientX;
    this.lookY = event.clientY;
  };
  private onLookEnd = (event: PointerEvent) => {
    if (event.pointerId === this.lookPointer) this.lookPointer = null;
  };

  private releaseAll(): void {
    this.joystickPointer = this.lookPointer = null;
    this.knob.style.transform = "translate(-50%, -50%)";
    this.flight.setTouchMovement(0, 0);
    for (const action of ["up", "down", "boost"] as const) this.flight.setTouchAction(action, false);
    for (const button of [this.upButton, this.downButton, this.boostButton]) button.classList.remove("pressed");
  }
}
