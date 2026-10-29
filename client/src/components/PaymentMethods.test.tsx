import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PaymentMethods } from "./PaymentMethods";
import { OrderSummary } from "./OrderSummary";
import type { Quote } from "../lib/types";

describe("PaymentMethods", () => {
  it("shows UPI, card, net banking and cash on delivery as radio cards with a clear selected state", () => {
    const onChange = vi.fn();
    render(<PaymentMethods value="UPI" onChange={onChange} codOk onlineOk />);
    expect(screen.getByRole("radiogroup", { name: "Payment method" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByTestId("pay-UPI")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Google Pay, PhonePe/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pay-CARD"));
    expect(onChange).toHaveBeenCalledWith("CARD");
    fireEvent.keyDown(screen.getByTestId("pay-UPI"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("CARD"); // keyboard: arrows move between available methods
  });

  it("keeps online methods visible but disabled, with the reason, when payment is not configured, and cash on delivery keeps working", () => {
    const onChange = vi.fn();
    render(<PaymentMethods value="COD" onChange={onChange} codOk onlineOk={false} onlineNote="Online payment isn't set up for this store yet." />);
    for (const id of ["UPI", "CARD", "NETBANKING"]) expect(screen.getByTestId(`pay-${id}`)).toBeDisabled();
    expect(screen.getAllByText(/isn't set up for this store yet/)).toHaveLength(3);
    expect(screen.getByTestId("pay-COD")).toBeEnabled();
    expect(screen.getByTestId("pay-COD")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByTestId("pay-UPI"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables cash on delivery when the store does not offer it", () => {
    render(<PaymentMethods value="UPI" onChange={vi.fn()} codOk={false} onlineOk />);
    expect(screen.getByTestId("pay-COD")).toBeDisabled();
  });
});

const quote: Quote = {
  lines: [
    { productId: "a", name: "Party Ice", packSize: "5 kg", image: "/img/ice.jpg", unitMinor: 6000, quantity: 2, stock: 9 },
    { productId: "b", name: "Tonic Water", packSize: "300 ml", unitMinor: 8500, quantity: 1, stock: 9 },
  ],
  issues: [],
  totals: { subtotalMinor: 20500, discountMinor: 1000, deliveryMinor: 0, taxMinor: 3510, totalMinor: 23010 },
  discountCode: "TEN",
  discountMessage: null,
};

describe("OrderSummary", () => {
  it("lists thumbnails, names, quantities and prices, and the payable total equals the quote total", () => {
    render(<MemoryRouter><OrderSummary quote={quote} payable /></MemoryRouter>);
    expect(screen.getByTestId("summary-lines").querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("Party Ice")).toBeInTheDocument();
    expect(screen.getByText(/5 kg · Qty 2/)).toBeInTheDocument();
    expect(screen.getByAltText("Party Ice")).toHaveAttribute("src", "/img/ice.jpg");
    expect(screen.getByTestId("grand-total")).toHaveTextContent("₹230.1");
    expect(screen.getByText(/You saved/)).toHaveTextContent("10");
    expect(screen.getByText(/Secure checkout/)).toHaveTextContent("₹230.1");
  });
});
