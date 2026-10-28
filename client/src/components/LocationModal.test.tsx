import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Layout } from "./Layout";
import { LocationProvider, useLocationCtx } from "../context/LocationContext";

const get = vi.fn();
vi.mock("../lib/api", () => ({ api: { get: (...a: unknown[]) => get(...a) }, apiError: (e: { message?: string }) => ({ message: e.message ?? "error", fields: {} }) }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: null, logout: vi.fn() }) }));
vi.mock("../context/CartContext", () => ({ useCart: () => ({ count: 0 }) }));
vi.mock("../context/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggle: vi.fn() }) }));

// The REAL LocationProvider and LocationModal are used here (the Layout test mocks the context and cannot catch hook-order crashes).
function Opener() { const l = useLocationCtx(); return <button onClick={l.openModal}>open-modal</button>; }
const renderApp = () => render(<MemoryRouter><LocationProvider><Opener /><Layout /></LocationProvider></MemoryRouter>);

const reply = (url: string) => {
  if (url === "/categories") return Promise.resolve({ data: { categories: [] } });
  if (url === "/pincode/825301") return Promise.resolve({ data: { pincode: "825301", postal: { status: "found", pincode: "825301", offices: [{ name: "Hazaribag Bazar", district: "Hazaribag", state: "Jharkhand" }], district: "Hazaribag", state: "Jharkhand" }, delivery: { serviceable: true, pincode: "825301", areaName: "Hazaribag town", city: "Hazaribag", state: "Jharkhand", etaMinutes: 50, isSample: true } } });
  if (url === "/pincode/825313") return Promise.resolve({ data: { pincode: "825313", postal: { status: "found", pincode: "825313", offices: [{ name: "Banahappa", district: "Hazaribag", state: "Jharkhand" }], district: "Hazaribag", state: "Jharkhand" }, delivery: { serviceable: false, pincode: "825313", reason: "not_covered" } } });
  return Promise.reject(new Error("The server took too long to respond. Please try again."));
};

beforeEach(() => { get.mockReset(); get.mockImplementation(reply); try { localStorage.clear(); } catch { /* ignore */ } });

describe("PIN code modal (real provider)", () => {
  it("opens without crashing, looks up automatically after six digits, and shows detected area and delivery", async () => {
    renderApp();
    fireEvent.click(screen.getByText("open-modal"));
    const input = await screen.findByLabelText("PIN code");
    expect(screen.getByText("Enter a valid 6-digit PIN code.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "825301" } });
    expect(await screen.findByText("Looking up location…")).toBeInTheDocument();
    expect(await screen.findByText(/Delivery available/, undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/Area and state detected/)).toBeInTheDocument();
  });
  it("says delivery is not available for a real PIN we do not cover", async () => {
    renderApp();
    fireEvent.click(screen.getByText("open-modal"));
    fireEvent.change(await screen.findByLabelText("PIN code"), { target: { value: "825313" } });
    expect(await screen.findByText("Sorry, delivery is not available in this area.", undefined, { timeout: 3000 })).toBeInTheDocument();
  });
  it("shows 'Unable to verify delivery' with a retry when the API fails", async () => {
    renderApp();
    fireEvent.click(screen.getByText("open-modal"));
    fireEvent.change(await screen.findByLabelText("PIN code"), { target: { value: "110001" } });
    expect((await screen.findAllByText(/Unable to verify delivery. Please try again./, undefined, { timeout: 3000 })).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: /Retry/ }).length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(screen.queryByText(/Delivery available/)).toBeNull());
  });
});
