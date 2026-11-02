import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { PasswordInput } from "./ui";

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState("");
  return <><label htmlFor="pw">Password</label><PasswordInput id="pw" value={v} onChange={(x) => { setV(x); onChange?.(x); }} /></>;
}

describe("PasswordInput", () => {
  it("hides the password by default and the eye button shows and hides it again", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.type).toBe("password");
  });
  it("still reports what is typed, and the eye button never submits the form", () => {
    const onChange = vi.fn();
    const submit = vi.fn((e: Event) => e.preventDefault());
    const { container } = render(<form onSubmit={submit as never}><Harness onChange={onChange} /></form>);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret-123" } });
    expect(onChange).toHaveBeenCalledWith("secret-123");
    fireEvent.click(container.querySelector("button")!);
    expect(submit).not.toHaveBeenCalled();
  });
});
