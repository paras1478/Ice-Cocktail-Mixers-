import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AddressForm, emptyAddress, validateAddress, type AddressDraft } from "./AddressForm";

const get = vi.fn();
const post = vi.fn();
vi.mock("../lib/api", () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  apiError: (e: { message?: string }) => ({ message: e.message ?? "error", fields: {} }),
}));

function Harness({ initial = emptyAddress }: { initial?: AddressDraft }) {
  const [v, setV] = useState(initial);
  return <><AddressForm value={v} errors={{}} onChange={(p) => setV((x) => ({ ...x, ...p }))} /><output data-testid="state">{JSON.stringify(v)}</output></>;
}
const state_ = () => JSON.parse(screen.getByTestId("state").textContent!) as AddressDraft;
const typePin = (pin: string) => fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: pin } });
const W = { timeout: 3000 };

const office = (name: string, o: object = {}) => ({ name, district: "Hazaribag", state: "Jharkhand", stateCode: "JH", block: "Sadar", ...o });
const found = (offices: object[], delivery: object, district = "Hazaribag", state = "Jharkhand", stateCode = "JH") => ({ data: { pincode: "825301", postal: { status: "found", pincode: "825301", offices, district, state, stateCode }, delivery } });
const serviceable = { serviceable: true, pincode: "825301", areaName: "Hazaribag town", city: "Hazaribag", state: "Jharkhand", etaMinutes: 50, isSample: true };
const notCovered = { serviceable: false, pincode: "825313", reason: "not_covered" };

beforeEach(() => { get.mockReset(); post.mockReset(); });

describe("validateAddress", () => {
  it("requires house, street, district, state and a valid PIN", () => {
    expect(Object.keys(validateAddress(emptyAddress)).sort()).toEqual(["district", "house", "line1", "phone", "pincode", "state"]);
    const ok = { ...emptyAddress, house: "1", line1: "Main Road", district: "Hazaribag", state: "Jharkhand", pincode: "825301", phone: "9876543210" };
    expect(validateAddress(ok)).toEqual({});
    expect(validateAddress({ ...ok, phone: "1234567890" }).phone).toMatch(/10-digit/); // must start 6-9
    expect(validateAddress({ ...ok, phone: "98765" }).phone).toMatch(/10-digit/);
  });
});

describe("PIN lookup: valid PIN", () => {
  it("shows the prompt before six digits and never calls the API for a malformed PIN", async () => {
    render(<Harness />);
    expect(screen.getByText("Enter a valid 6-digit PIN code.")).toBeInTheDocument();
    typePin("12ab");
    expect(state_().pincode).toBe("12"); // non-digits are dropped
    typePin("12345");
    await new Promise((r) => setTimeout(r, 600));
    expect(get).not.toHaveBeenCalled();
  });
  it("debounces, shows a loading state, then fills area, district and state and reports delivery", async () => {
    get.mockResolvedValue(found([office("Hazaribag Bazar")], serviceable));
    render(<Harness />);
    typePin("825301");
    expect(await screen.findByText("Looking up location…")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled(); // debounced
    await waitFor(() => expect(state_().district).toBe("Hazaribag"), W);
    expect(state_()).toMatchObject({ area: "Hazaribag Bazar", state: "Jharkhand", pincode: "825301" });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe("/pincode/825301");
    expect(screen.getByText(/Area and state detected/)).toBeInTheDocument();
    expect(screen.getByText(/Delivery available/)).toBeInTheDocument();
  });
  it("keeps the PIN as a string", async () => {
    get.mockResolvedValue(found([office("X")], serviceable));
    render(<Harness />);
    typePin("110001");
    await waitFor(() => expect(get).toHaveBeenCalled(), W);
    expect(typeof state_().pincode).toBe("string");
    expect(state_().pincode).toBe("110001");
  });
});

describe("nationwide: any state, with state code", () => {
  const cases: [string, string, string, string][] = [
    ["400001", "Maharashtra", "MH", "Mumbai"], ["600001", "Tamil Nadu", "TN", "Chennai"], ["682001", "Kerala", "KL", "Ernakulam"], ["700001", "West Bengal", "WB", "Kolkata"],
    ["190001", "Jammu & Kashmir", "JK", "Srinagar"], ["744101", "Andaman & Nicobar", "AN", "South Andaman"], ["605001", "Pondicherry", "PY", "Puducherry"], ["781001", "Assam", "AS", "Kamrup Metropolitan"],
  ];
  it.each(cases)("%s fills district, state and state code for %s", async (pin, state, code, district) => {
    get.mockResolvedValue({ data: { pincode: pin, postal: { status: "found", pincode: pin, offices: [office("Head Office", { district, state, stateCode: code })], district, state, stateCode: code }, delivery: { serviceable: false, pincode: pin, reason: "not_covered" } } });
    render(<Harness />);
    typePin(pin);
    await waitFor(() => expect(state_().state).toBe(state), W);
    expect(state_()).toMatchObject({ district, stateCode: code, area: "Head Office", pincode: pin });
    expect(screen.getByTestId("state-code")).toHaveTextContent(code);
    expect(screen.getByText("Sorry, delivery is not available in this area.")).toBeInTheDocument();
  });
  it("hides the state code once the customer edits the state themselves", async () => {
    get.mockResolvedValue(found([office("Hazaribag Bazar")], serviceable));
    render(<Harness />);
    typePin("825301");
    await waitFor(() => expect(screen.getByTestId("state-code")).toHaveTextContent("JH"), W);
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "Jharkhand State" } });
    expect(screen.queryByTestId("state-code")).toBeNull();
    expect(state_().state).toBe("Jharkhand State");
  });
});

describe("contact number", () => {
  it("accepts digits only, up to ten", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "98a76-543210999" } });
    expect(state_().phone).toBe("9876543210");
  });
});

describe("PIN lookup: several post offices", () => {
  it("leaves the area for the customer to choose, then fills it (and lets them edit it)", async () => {
    get.mockResolvedValue(found([office("Banahappa"), office("Bedam"), office("Daroo")], notCovered));
    render(<Harness />);
    typePin("825313");
    const select = await screen.findByLabelText("Select your post office / area", undefined, W);
    await waitFor(() => expect(state_().district).toBe("Hazaribag"), W);
    expect(state_().area).toBe(""); // not guessed
    fireEvent.change(select, { target: { value: "Bedam" } });
    expect(state_().area).toBe("Bedam");
    fireEvent.change(screen.getByLabelText("Area / post office"), { target: { value: "My own area" } });
    expect(state_().area).toBe("My own area");
  });
});

describe("PIN lookup: serviceability is separate from the postal result", () => {
  it("says delivery is not available for a real PIN we do not cover, while still filling the address", async () => {
    get.mockResolvedValue(found([office("Banahappa")], notCovered));
    render(<Harness />);
    typePin("825313");
    expect(await screen.findByText("Sorry, delivery is not available in this area.", undefined, W)).toBeInTheDocument();
    expect(screen.getByText(/Area and state detected/)).toBeInTheDocument();
    await waitFor(() => expect(state_().state).toBe("Jharkhand"), W);
  });
  it("reports paused coverage", async () => {
    get.mockResolvedValue(found([office("Banahappa")], { serviceable: false, pincode: "825301", reason: "paused" }));
    render(<Harness />);
    typePin("825301");
    expect(await screen.findByText(/temporarily paused/, undefined, W)).toBeInTheDocument();
  });
});

describe("PIN lookup: failures", () => {
  it("reports an unknown PIN and keeps manual entry available", async () => {
    get.mockResolvedValue({ data: { pincode: "999999", postal: { status: "not_found" }, delivery: { serviceable: false, pincode: "999999", reason: "not_covered" } } });
    render(<Harness />);
    typePin("999999");
    expect(await screen.findByText(/no record of this PIN code/, undefined, W)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("City / district"), { target: { value: "Typed" } });
    expect(state_().district).toBe("Typed");
  });
  it("shows the real message when the postal service is down, and delivery is still answered", async () => {
    get.mockResolvedValue({ data: { pincode: "825301", postal: { status: "unavailable", message: "The postal PIN lookup service is unavailable (HTTP 503). You can enter the area, district and state manually." }, delivery: serviceable } });
    render(<Harness />);
    typePin("825301");
    expect(await screen.findByText(/postal PIN lookup service is unavailable/, undefined, W)).toBeInTheDocument();
    expect(screen.getByText(/Delivery available/)).toBeInTheDocument();
    expect(screen.getByLabelText("City / district")).not.toBeDisabled();
  });
  it("says it cannot verify delivery when our API fails or times out, and retries on demand", async () => {
    get.mockRejectedValueOnce(new Error("The server took too long to respond. Please try again."));
    render(<Harness />);
    typePin("825301");
    expect(await screen.findByText("Unable to verify delivery. Please try again.", undefined, W)).toBeInTheDocument();
    expect(screen.queryByText(/Delivery available/)).toBeNull(); // never assumed serviceable
    get.mockResolvedValue(found([office("Hazaribag Bazar")], serviceable));
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByText(/Delivery available/, undefined, W)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe("PIN lookup: races and edits", () => {
  it("ignores an older response that arrives after a newer PIN was entered", async () => {
    let resolveA!: (v: unknown) => void;
    get.mockImplementation((url: string) =>
      url.endsWith("825301") ? new Promise((r) => { resolveA = r; })
        : Promise.resolve({ data: { pincode: "834001", postal: { status: "found", pincode: "834001", offices: [office("Church Road", { district: "Ranchi" })], district: "Ranchi", state: "Jharkhand" }, delivery: { ...serviceable, pincode: "834001", areaName: "Ranchi" } } }));
    render(<Harness />);
    typePin("825301");
    await waitFor(() => expect(get).toHaveBeenCalledWith("/pincode/825301", expect.anything()), W);
    typePin("834001");
    await waitFor(() => expect(state_().district).toBe("Ranchi"), W);
    resolveA(found([office("Hazaribag Bazar")], serviceable)); // the stale answer finally arrives
    await new Promise((r) => setTimeout(r, 100));
    expect(state_().district).toBe("Ranchi");
    expect(state_().area).toBe("Church Road");
  });
  it("never overwrites what the customer typed, but replaces its own earlier suggestions on a new PIN", async () => {
    get.mockImplementation((url: string) => Promise.resolve(url.endsWith("825301")
      ? found([office("Hazaribag Bazar")], serviceable)
      : { data: { pincode: "834001", postal: { status: "found", pincode: "834001", offices: [office("Church Road", { district: "Ranchi" })], district: "Ranchi", state: "Jharkhand" }, delivery: notCovered } }));
    render(<Harness initial={{ ...emptyAddress, state: "My State" }} />);
    typePin("825301");
    await waitFor(() => expect(state_().district).toBe("Hazaribag"), W);
    expect(state_().state).toBe("My State"); // customer's own value kept
    typePin("834001");
    await waitFor(() => expect(state_().district).toBe("Ranchi"), W); // auto-filled value replaced
    expect(state_().state).toBe("My State");
  });
});

describe("GPS location", () => {
  it("handles a denied permission with a clear message", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (_ok: unknown, err: (e: unknown) => void) => err({ code: 1, PERMISSION_DENIED: 1 }) } });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /current location/i }));
    await waitFor(() => expect(screen.getByText(/permission was denied/)).toBeInTheDocument());
    expect(state_().latitude).toBeNull();
  });
  it("fills the form only after the customer confirms the detected address, and keeps the coordinates", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 28.4312, longitude: 77.1012 } }) } });
    get.mockResolvedValue({ data: { pincode: "122018", postal: { status: "not_found" }, delivery: { serviceable: false, pincode: "122018", reason: "not_covered" } } });
    post.mockResolvedValue({ data: { line1: "12 MG Road", area: "Sector 54", district: "Gurgaon", city: "Gurgaon", state: "Haryana", pincode: "122018" } });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /current location/i }));
    await screen.findByTestId("gps-found");
    expect(state_().district).toBe(""); // nothing filled yet
    fireEvent.click(screen.getByRole("button", { name: "Use this address" }));
    await waitFor(() => expect(state_().district).toBe("Gurgaon"));
    expect(state_()).toMatchObject({ latitude: 28.4312, longitude: 77.1012, pincode: "122018", area: "Sector 54" });
  });
  it("still allows using the pin alone when the address cannot be detected", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 28.5, longitude: 77.2 } }) } });
    post.mockRejectedValue(new Error("Could not turn your location into an address"));
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /current location/i }));
    await screen.findByTestId("gps-found");
    expect(screen.queryByRole("button", { name: "Use this address" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use pin only" }));
    await waitFor(() => expect(state_().latitude).toBe(28.5));
  });
});
