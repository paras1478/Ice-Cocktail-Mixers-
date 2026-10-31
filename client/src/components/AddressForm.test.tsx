import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
// Leaflet needs a real browser layout; the map is covered by the geolocation tests and the manual checks.
vi.mock("./LocationMap", () => ({
  default: ({ latitude, longitude, onMove }: { latitude: number | null; longitude: number | null; onMove?: (lat: number, lng: number) => void }) => (
    <div data-testid="location-map" data-lat={latitude ?? ""} data-lng={longitude ?? ""}>
      {onMove && <button type="button" onClick={() => onMove(28.4595, 77.0266)}>mock-tap-map</button>}
    </div>
  ),
}));
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
  it("searches an address, shows matches, and only fills the form once the picked match is confirmed", async () => {
    get.mockResolvedValue({ data: { pincode: "122018", postal: { status: "not_found" }, delivery: { serviceable: false, pincode: "122018", reason: "not_covered" } } });
    post.mockResolvedValue({ data: { results: [{ latitude: 28.4312, longitude: 77.1012, line1: "12 MG Road", area: "Sector 54", city: "Gurugram", district: "Gurugram", state: "Haryana", pincode: "122018", displayName: "12 MG Road, Sector 54, Gurugram 122018" }] } });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Search delivery address"), { target: { value: "MG Road Gurugram" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));
    expect(post).toHaveBeenCalledWith("/geo/search", { query: "MG Road Gurugram" });
    fireEvent.click(await screen.findByRole("button", { name: /12 MG Road, Sector 54/ }));
    expect(state_().latitude).toBeNull(); // picking only places the pin for review
    expect(await screen.findByTestId("location-map")).toHaveAttribute("data-lat", "28.4312");
    fireEvent.click(screen.getByRole("button", { name: "Confirm delivery location" }));
    await waitFor(() => expect(state_()).toMatchObject({ latitude: 28.4312, longitude: 77.1012, pincode: "122018", district: "Gurugram", state: "Haryana" }));
  });
  it("shows the search error (e.g. not set up) and rejects too-short queries without calling the server", async () => {
    post.mockRejectedValue({ message: "Address search is not set up yet." });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Search delivery address"), { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));
    expect(await screen.findByText(/at least 3 characters/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Search delivery address"), { target: { value: "MG Road" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/ }));
    expect(await screen.findByText(/not set up yet/)).toBeInTheDocument();
  });
  it("fills the form only after the customer confirms the detected address, and keeps the coordinates", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 28.4312, longitude: 77.1012 } }) } });
    get.mockResolvedValue({ data: { pincode: "122018", postal: { status: "not_found" }, delivery: { serviceable: false, pincode: "122018", reason: "not_covered" } } });
    post.mockResolvedValue({ data: { line1: "12 MG Road", area: "Sector 54", district: "Gurgaon", city: "Gurgaon", state: "Haryana", pincode: "122018" } });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /current location/i }));
    await screen.findByTestId("gps-found");
    expect(state_().district).toBe(""); // nothing filled yet
    fireEvent.click(screen.getByRole("button", { name: "Confirm delivery location" }));
    await waitFor(() => expect(state_().district).toBe("Gurgaon"));
    expect(state_()).toMatchObject({ latitude: 28.4312, longitude: 77.1012, pincode: "122018", area: "Sector 54" });
  });
  it("still allows using the pin alone when the address cannot be detected", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 28.5, longitude: 77.2 } }) } });
    post.mockRejectedValue(new Error("Could not turn your location into an address"));
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /current location/i }));
    await screen.findByTestId("gps-found");
    expect(screen.queryByRole("button", { name: "Confirm delivery location" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm pin only" }));
    await waitFor(() => expect(state_().latitude).toBe(28.5));
  });
});

describe("map pin", () => {
  it("shows the detected pin on the map at the device's latitude and longitude, with the address and accuracy note", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 28.4312, longitude: 77.1012, accuracy: 3000 } }) } });
    get.mockResolvedValue({ data: { pincode: "122018", postal: { status: "not_found" }, delivery: { serviceable: false, pincode: "122018", reason: "not_covered" } } });
    post.mockResolvedValue({ data: { line1: "12 MG Road", area: "Sector 54", district: "Gurgaon", city: "Gurgaon", state: "Haryana", pincode: "122018" } });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /current location/i }));
    const map = await screen.findByTestId("location-map");
    expect(map).toHaveAttribute("data-lat", "28.4312");
    expect(map).toHaveAttribute("data-lng", "77.1012");
    expect(post).toHaveBeenCalledWith("/geo/reverse", { latitude: 28.4312, longitude: 77.1012 }); // the address belongs to these coordinates
    expect(screen.getByText(/Approximate location/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm pin only" }));
    await waitFor(() => expect(state_()).toMatchObject({ latitude: 28.4312, longitude: 77.1012 }));
    expect(screen.getAllByTestId("location-map")[0]).toHaveAttribute("data-lat", "28.4312"); // the saved pin is shown on the map too
  });

  it("does not offer a pin or an address for a location outside India, and says why", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 51.5, longitude: -0.12, accuracy: 30 } }) } });
    post.mockClear();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /current location/i }));
    await screen.findByTestId("gps-found");
    expect(screen.getByText(/outside India/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm pin only" })).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("shows a specific message for a timeout, with a way to continue manually", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (_ok: unknown, err: (e: unknown) => void) => err({ code: 3 }) } });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /current location/i }));
    await waitFor(() => expect(screen.getByText(/took too long/)).toBeInTheDocument());
  });
});

describe("rough (network / IP based) location", () => {
  it("shows the real coordinates and accuracy, labels it approximate, and suggests no address or pin from a city-level guess", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 25.6093, longitude: 85.1235, accuracy: 200000 } }) } });
    post.mockClear();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /current location/i }));
    await screen.findByTestId("gps-found");
    expect(screen.getByTestId("gps-coords")).toHaveTextContent("Latitude 25.6093, longitude 85.1235 · accuracy ±200 km");
    expect(screen.getByText(/Very approximate/)).toHaveTextContent(/not GPS/);
    expect(screen.getByTestId("location-map")).toHaveAttribute("data-lat", ""); // the area is shown, but no pin is placed on a city-level guess
    expect(post).not.toHaveBeenCalled(); // no reverse lookup: it would only name a landmark near the city centre
    expect(screen.queryByRole("button", { name: "Confirm delivery location" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm pin only" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });
});

describe("choosing the delivery spot manually (never a hardcoded location)", () => {
  const patnaFix = () => Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 25.609, longitude: 85.1343, accuracy: 200000 } }) } });

  it("after a rough fix, tapping the map sets the pin, the address is looked up for the TAPPED coordinates, and Confirm delivery location saves exactly those", async () => {
    patnaFix();
    get.mockResolvedValue({ data: { pincode: "122001", postal: { status: "not_found" }, delivery: { serviceable: false, pincode: "122001", reason: "not_covered" } } });
    post.mockReset();
    post.mockResolvedValue({ data: { line1: "7 Golf Course Road", area: "Sector 42", district: "Gurgaon", city: "Gurgaon", state: "Haryana", pincode: "122002" } });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /current location/i }));
    await screen.findByTestId("gps-found");
    expect(post).not.toHaveBeenCalled(); // no address is looked up for the rough city-level position
    expect(screen.getByTestId("gps-coords")).toHaveTextContent("accuracy ±200 km");
    fireEvent.click(screen.getByRole("button", { name: "mock-tap-map" })); // the customer taps their real spot
    await waitFor(() => expect(post).toHaveBeenCalledWith("/geo/reverse", { latitude: 28.4595, longitude: 77.0266 })); // the new coordinates, not 25.609 / 85.1343
    expect(screen.getByTestId("gps-coords")).toHaveTextContent("Latitude 28.4595, longitude 77.0266");
    expect(screen.getByTestId("location-map")).toHaveAttribute("data-lat", "28.4595");
    fireEvent.click(await screen.findByRole("button", { name: "Confirm delivery location" }));
    await waitFor(() => expect(state_()).toMatchObject({ latitude: 28.4595, longitude: 77.0266, line1: "7 Golf Course Road, Sector 42", area: "Sector 42", district: "Gurgaon", state: "Haryana", pincode: "122002" }));
  });

  it("Confirm delivery location replaces an older address with the one found at the selected pin, keeping house number and phone", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 28.43, longitude: 77.1, accuracy: 15 } }) } });
    get.mockResolvedValue({ data: { pincode: "400001", postal: { status: "not_found" }, delivery: { serviceable: false, pincode: "400001", reason: "not_covered" } } });
    post.mockReset();
    post.mockResolvedValue({ data: { line1: "7 Golf Course Road", area: "Sector 42", district: "Gurgaon", city: "Gurgaon", state: "Haryana", pincode: "122002" } });
    render(<Harness initial={{ ...emptyAddress, house: "12B", phone: "9876543210", line1: "Old Street", area: "Old Area", district: "Mumbai", state: "Maharashtra", pincode: "400001" }} />);
    fireEvent.click(screen.getByRole("button", { name: /current location/i }));
    await screen.findByTestId("gps-found");
    fireEvent.click(await screen.findByRole("button", { name: "Confirm delivery location" }));
    await waitFor(() => expect(state_().pincode).toBe("122002"));
    expect(state_()).toMatchObject({ house: "12B", phone: "9876543210", line1: "7 Golf Course Road, Sector 42", district: "Gurgaon", state: "Haryana", latitude: 28.43, longitude: 77.1 });
  });

  it("Choose on map shows a plain map view (not a location), makes no geolocation request, and uses the tapped spot", async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
    get.mockResolvedValue({ data: { pincode: "122002", postal: { status: "not_found" }, delivery: { serviceable: false, pincode: "122002", reason: "not_covered" } } });
    post.mockReset();
    post.mockResolvedValue({ data: { line1: "7 Golf Course Road", area: "Sector 42", district: "Gurgaon", city: "Gurgaon", state: "Haryana", pincode: "122002" } });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Choose on map" }));
    const pick = screen.getByTestId("pick-map");
    expect(pick).toHaveTextContent(/not your location/);
    expect(pick.querySelector("[data-testid=location-map]")).toHaveAttribute("data-lat", ""); // no pin and no coordinates until the customer chooses
    expect(state_().latitude).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "mock-tap-map" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/geo/reverse", { latitude: 28.4595, longitude: 77.0266 }));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm pin only" }));
    await waitFor(() => expect(state_()).toMatchObject({ latitude: 28.4595, longitude: 77.0266 }));
  });
});
