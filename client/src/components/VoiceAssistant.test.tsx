import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const cfg = vi.hoisted(() => ({ value: { voice: { enabled: true } } as { voice?: { enabled: boolean } } | null }));
const auth = vi.hoisted(() => ({ value: { user: { id: "u1" }, loading: false } as { user: { id: string } | null; loading: boolean } }));
const voice = vi.hoisted(() => ({
  state: { status: "live", phase: "listening", muted: false, lines: [], products: [], error: null, cartNote: null } as Record<string, unknown>,
  start: vi.fn(), stop: vi.fn(), toggleMute: vi.fn(),
}));

vi.mock("../lib/useAppConfig", () => ({ useAppConfig: () => cfg.value }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("../context/CartContext", () => ({ useCart: () => ({ count: 3, syncFromServer: vi.fn() }) }));
vi.mock("../lib/useRealtimeVoice", () => ({ useRealtimeVoice: () => ({ ...voice.state, start: voice.start, stop: voice.stop, toggleMute: voice.toggleMute, getLevels: () => null }) }));

import { VoiceAssistant } from "./VoiceAssistant";

const ui = () => render(<MemoryRouter><VoiceAssistant /></MemoryRouter>);

describe("VoiceAssistant", () => {
  it("shows no button when the server has not configured voice", () => {
    cfg.value = { voice: { enabled: false } };
    ui();
    expect(screen.queryByTestId("voice-fab")).toBeNull();
    cfg.value = null;
  });

  it("opens, starts the conversation, and offers mute, transcript and end controls", async () => {
    cfg.value = { voice: { enabled: true } };
    voice.start.mockClear(); voice.stop.mockClear();
    ui();
    await userEvent.click(screen.getByTestId("voice-fab"));
    expect(await screen.findByRole("region", { name: /Ice/ })).toBeInTheDocument();
    expect(voice.start).toHaveBeenCalled();
    expect(screen.getByText("Listening…")).toBeInTheDocument();
    expect(screen.getByText(/Hindi, English or Hinglish/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mute microphone" }));
    expect(voice.toggleMute).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Show transcript" }));
    expect(screen.getByLabelText("Conversation transcript")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /End conversation/ }));
    expect(voice.stop).toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: /Ice/ })).toBeNull();
    expect(screen.getByTestId("voice-fab")).toBeInTheDocument();
  });

  it("asks a logged-out visitor to log in instead of starting the microphone", async () => {
    auth.value = { user: null, loading: false };
    voice.start.mockClear();
    ui();
    await userEvent.click(screen.getByTestId("voice-fab"));
    expect(await screen.findByText(/Log in to talk/)).toBeInTheDocument();
    expect(voice.start).not.toHaveBeenCalled();
    auth.value = { user: { id: "u1" }, loading: false };
  });

  it("shows a clear message and a retry button when the microphone is blocked", async () => {
    voice.state = { ...voice.state, status: "error", error: { kind: "mic-denied", message: "Microphone access is blocked. Allow it." } };
    voice.start.mockClear();
    ui();
    await userEvent.click(screen.getByTestId("voice-fab"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Microphone is blocked/);
    voice.start.mockClear();
    await userEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(voice.start).toHaveBeenCalledTimes(1);
  });

  it("lists the products the assistant mentioned, and the cart update", async () => {
    voice.state = {
      status: "live", phase: "speaking", muted: false, lines: [], error: null, cartNote: "Your cart was updated",
      products: [{ id: "p1", slug: "lemon-soda", name: "Lemon Club Soda", price: "₹60", image: null, inStock: true }],
    };
    ui();
    await userEvent.click(screen.getByTestId("voice-fab"));
    expect(await screen.findByRole("link", { name: /Lemon Club Soda/ })).toHaveAttribute("href", "/product/lemon-soda");
    expect(screen.getByRole("link", { name: /View cart \(3\)/ })).toHaveAttribute("href", "/cart");
    expect(screen.getByText("Speaking…")).toBeInTheDocument();
  });
});
