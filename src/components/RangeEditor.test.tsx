import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RangeEditor } from "./RangeEditor";

describe("RangeEditor", () => {
  it("emits changes through the callback", () => {
    const onChange = vi.fn();

    render(
      <RangeEditor
        minMinutes={8 * 60}
        maxMinutes={14 * 60}
        step={30}
        minDurationMinutes={180}
        startMinutes={9 * 60}
        endMinutes={12 * 60}
        earliestStartMinutes={8 * 60 + 30}
        allowEarlyStart
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("End"), { target: { value: "780" } });

    expect(onChange).toHaveBeenCalled();
  });
});
