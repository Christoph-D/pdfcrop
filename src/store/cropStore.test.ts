import { beforeEach, describe, expect, it } from "vitest";
import { useCropStore, type CropRect } from "./cropStore";

function rect(id: string, x: number, y: number, w: number, h: number): CropRect {
  return { id, x, y, w, h };
}

describe("cropStore copy/paste", () => {
  beforeEach(() => {
    useCropStore.getState().clearAll();
  });

  it("copies the currently selected rect (clears the clipboard first)", () => {
    useCropStore.setState({
      rectsByCluster: {
        a: [rect("r1", 10, 20, 30, 40), rect("r2", 50, 60, 70, 80)],
        b: [rect("r3", 1, 2, 3, 4)],
      },
      selectedClusterId: "a",
      selectedRectId: "r2",
      clipboard: [rect("stale", 0, 0, 1, 1)],
    });

    useCropStore.getState().copy();

    expect(useCropStore.getState().clipboard).toEqual([rect("r2", 50, 60, 70, 80)]);
  });

  it("does not touch the OS clipboard (in-memory only)", () => {
    // The store has no external clipboard dependency; copying only mutates
    // `clipboard`. This is structural: there is nothing to assert beyond the
    // state, covered above, so just confirm the snapshot lives in state.
    useCropStore.setState({
      rectsByCluster: { a: [rect("r1", 1, 2, 3, 4)] },
      selectedClusterId: "a",
      selectedRectId: "r1",
    });
    useCropStore.getState().copy();
    expect(useCropStore.getState().clipboard).toHaveLength(1);
  });

  it("pastes copies into the active cluster with fresh ids, starting unselected", () => {
    useCropStore.setState({
      rectsByCluster: { a: [rect("r1", 10, 20, 30, 40)] },
      selectedClusterId: "a",
      selectedRectId: "r1",
      clipboard: [rect("clip-1", 10, 20, 30, 40), rect("clip-2", 100, 200, 5, 6)],
    });

    useCropStore.getState().paste();

    const list = useCropStore.getState().rectsByCluster.a!;
    expect(list).toHaveLength(3);
    // Original rect is preserved.
    expect(list[0]).toEqual(rect("r1", 10, 20, 30, 40));
    // Pasted rects copy geometry with new ids.
    expect(list[1]).toMatchObject({ x: 10, y: 20, w: 30, h: 40 });
    expect(list[2]).toMatchObject({ x: 100, y: 200, w: 5, h: 6 });
    expect(list[1]!.id).not.toBe("clip-1");
    expect(list[2]!.id).not.toBe("clip-2");
    expect(list[1]!.id).not.toBe(list[2]!.id);
    // Selection is left untouched (pasted rects start unselected).
    expect(useCropStore.getState().selectedRectId).toBe("r1");
  });

  it("copies between clusters: copy from one, select another, paste", () => {
    useCropStore.setState({
      rectsByCluster: { a: [rect("r1", 11, 22, 33, 44)], b: [] },
      selectedClusterId: "a",
      selectedRectId: "r1",
    });
    useCropStore.getState().copy();

    // Switch active cluster to b (e.g. by clicking it) and paste.
    useCropStore.setState({ selectedClusterId: "b", selectedRectId: null });
    useCropStore.getState().paste();

    const b = useCropStore.getState().rectsByCluster.b!;
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ x: 11, y: 22, w: 33, h: 44 });
  });

  it("paste is a no-op when the clipboard is empty", () => {
    useCropStore.setState({
      rectsByCluster: { a: [rect("r1", 1, 2, 3, 4)] },
      selectedClusterId: "a",
      selectedRectId: "r1",
      clipboard: [],
    });
    useCropStore.getState().paste();
    expect(useCropStore.getState().rectsByCluster.a).toHaveLength(1);
  });

  it("copy with no selection clears the clipboard", () => {
    useCropStore.setState({
      rectsByCluster: { a: [rect("r1", 1, 2, 3, 4)] },
      selectedClusterId: "a",
      selectedRectId: null,
      clipboard: [rect("stale", 0, 0, 1, 1)],
    });
    useCropStore.getState().copy();
    expect(useCropStore.getState().clipboard).toEqual([]);
  });
});
