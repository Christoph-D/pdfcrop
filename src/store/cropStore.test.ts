import { beforeEach, describe, expect, it } from "vitest";
import { useCropStore, type CropRect, type RectDelta } from "./cropStore";

function rect(id: string, x: number, y: number, w: number, h: number): CropRect {
  return { id, x, y, w, h };
}

const A = "A";
const B = "B";

beforeEach(() => {
  useCropStore.getState().clearAll();
  useCropStore.setState({
    rectsByCluster: {
      [A]: [rect("a1", 10, 10, 40, 60), rect("a2", 100, 100, 50, 50)],
      [B]: [rect("b1", 20, 20, 30, 30)],
    },
  });
});

describe("selection actions", () => {
  it("toggleSelect adds then removes a rect", () => {
    const { toggleSelect } = useCropStore.getState();
    toggleSelect("a1");
    expect(useCropStore.getState().selectedRectIds.has("a1")).toBe(true);
    toggleSelect("a1");
    expect(useCropStore.getState().selectedRectIds.has("a1")).toBe(false);
  });

  it("toggleSelect across clusters builds a global set", () => {
    const { toggleSelect } = useCropStore.getState();
    toggleSelect("a1");
    toggleSelect("b1");
    expect([...useCropStore.getState().selectedRectIds].sort()).toEqual(["a1", "b1"]);
  });

  it("selectOnly replaces the whole selection", () => {
    const { toggleSelect, selectOnly } = useCropStore.getState();
    toggleSelect("a1");
    toggleSelect("a2");
    selectOnly("b1");
    expect([...useCropStore.getState().selectedRectIds]).toEqual(["b1"]);
  });

  it("clearSelection empties the set", () => {
    const { toggleSelect, clearSelection } = useCropStore.getState();
    toggleSelect("a1");
    toggleSelect("b1");
    clearSelection();
    expect(useCropStore.getState().selectedRectIds.size).toBe(0);
  });
});

describe("removeRect prunes selection", () => {
  it("drops the removed id from selectedRectIds", () => {
    const { toggleSelect, removeRect } = useCropStore.getState();
    toggleSelect("a1");
    toggleSelect("b1");
    removeRect(A, "a1");
    expect([...useCropStore.getState().selectedRectIds]).toEqual(["b1"]);
    expect(useCropStore.getState().rectsByCluster[A]!.map((r) => r.id)).toEqual(["a2"]);
  });
});

describe("removeSelectedRects", () => {
  it("deletes every selected rect across all clusters and clears selection", () => {
    const { toggleSelect, removeSelectedRects } = useCropStore.getState();
    toggleSelect("a2");
    toggleSelect("b1");
    removeSelectedRects();
    const s = useCropStore.getState();
    expect(s.rectsByCluster[A]!.map((r) => r.id)).toEqual(["a1"]);
    expect(s.rectsByCluster[B]).toEqual([]);
    expect(s.selectedRectIds.size).toBe(0);
  });
});

describe("applyDeltaToSelectionExcept", () => {
  const dims = {
    [A]: { imgW: 200, imgH: 200 },
    [B]: { imgW: 400, imgH: 400 },
  };

  function origins(): Record<string, { x: number; y: number; w: number; h: number }> {
    const map: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const list of Object.values(useCropStore.getState().rectsByCluster)) {
      for (const r of list) map[r.id] = { x: r.x, y: r.y, w: r.w, h: r.h };
    }
    return map;
  }

  it("broadcasts a move delta to every other selected rect", () => {
    const { toggleSelect, applyDeltaToSelectionExcept } = useCropStore.getState();
    toggleSelect("a1");
    toggleSelect("a2");
    toggleSelect("b1");
    const delta: RectDelta = { dx: 5, dy: 7, dw: 0, dh: 0 };
    applyDeltaToSelectionExcept("a1", delta, origins(), dims);

    const s = useCropStore.getState();
    // source rect (a1) is updated by the panel, not here — left untouched.
    expect(s.rectsByCluster[A]!.find((r) => r.id === "a1")).toEqual(rect("a1", 10, 10, 40, 60));
    // other selected rects move by the same delta.
    expect(s.rectsByCluster[A]!.find((r) => r.id === "a2")).toEqual(rect("a2", 105, 107, 50, 50));
    expect(s.rectsByCluster[B]!.find((r) => r.id === "b1")).toEqual(rect("b1", 25, 27, 30, 30));
  });

  it("broadcasts a resize delta anchored top-left (se handle)", () => {
    const { toggleSelect, applyDeltaToSelectionExcept } = useCropStore.getState();
    toggleSelect("a1");
    toggleSelect("b1");
    const delta: RectDelta = { dx: 0, dy: 0, dw: 10, dh: 20 };
    applyDeltaToSelectionExcept("a1", delta, origins(), dims);

    const s = useCropStore.getState();
    expect(s.rectsByCluster[A]!.find((r) => r.id === "a1")).toEqual(rect("a1", 10, 10, 40, 60));
    expect(s.rectsByCluster[B]!.find((r) => r.id === "b1")).toEqual(rect("b1", 20, 20, 40, 50));
  });

  it("clamps each rect to its own cluster image bounds", () => {
    // The source (a1) is updated by the panel, not the broadcast, so it is
    // left untouched. The other selected rects move by the same delta but are
    // each clamped to their own cluster's image size.
    const { toggleSelect, applyDeltaToSelectionExcept } = useCropStore.getState();
    toggleSelect("a1");
    toggleSelect("a2");
    toggleSelect("b1");
    const delta: RectDelta = { dx: 500, dy: 0, dw: 0, dh: 0 };
    applyDeltaToSelectionExcept("a1", delta, origins(), dims);

    const s = useCropStore.getState();
    // source rect is untouched.
    expect(s.rectsByCluster[A]!.find((r) => r.id === "a1")!.x).toBe(10);
    // a2 (x=100, w=50 in a 200x200 image) clamps to 200-50 = 150.
    expect(s.rectsByCluster[A]!.find((r) => r.id === "a2")!.x).toBe(150);
    // b1 (x=20, w=30 in a 400x400 image) clamps to 400-30 = 370.
    expect(s.rectsByCluster[B]!.find((r) => r.id === "b1")!.x).toBe(370);
  });

  it("ignores rects that are not selected", () => {
    const { applyDeltaToSelectionExcept } = useCropStore.getState();
    const delta: RectDelta = { dx: 50, dy: 50, dw: 0, dh: 0 };
    applyDeltaToSelectionExcept("a1", delta, origins(), dims);

    const s = useCropStore.getState();
    expect(s.rectsByCluster[A]!.find((r) => r.id === "a2")).toEqual(rect("a2", 100, 100, 50, 50));
    expect(s.rectsByCluster[B]!.find((r) => r.id === "b1")).toEqual(rect("b1", 20, 20, 30, 30));
  });

  it("is a no-op when only the source rect is selected", () => {
    const { selectOnly, applyDeltaToSelectionExcept } = useCropStore.getState();
    selectOnly("a1");
    const before = useCropStore.getState().rectsByCluster;
    applyDeltaToSelectionExcept("a1", { dx: 99, dy: 99, dw: 99, dh: 99 }, origins(), dims);
    expect(useCropStore.getState().rectsByCluster).toBe(before);
  });
});

describe("applyDeltaToSelection", () => {
  const dims = {
    [A]: { imgW: 200, imgH: 200 },
    [B]: { imgW: 400, imgH: 400 },
  };

  it("moves every selected rect by the delta, clamped to image bounds", () => {
    const { toggleSelect, applyDeltaToSelection } = useCropStore.getState();
    toggleSelect("a1");
    toggleSelect("b1");
    applyDeltaToSelection({ dx: 5, dy: 7, dw: 0, dh: 0 }, dims);

    const s = useCropStore.getState();
    expect(s.rectsByCluster[A]!.find((r) => r.id === "a1")).toEqual(rect("a1", 15, 17, 40, 60));
    expect(s.rectsByCluster[B]!.find((r) => r.id === "b1")).toEqual(rect("b1", 25, 27, 30, 30));
    // Unselected rects are untouched.
    expect(s.rectsByCluster[A]!.find((r) => r.id === "a2")).toEqual(rect("a2", 100, 100, 50, 50));
  });

  it("clamps each move to the cluster's image bounds", () => {
    const { toggleSelect, applyDeltaToSelection } = useCropStore.getState();
    toggleSelect("a2"); // x=100, w=50 in a 200x200 image -> maxX 150
    toggleSelect("b1"); // x=20, w=30 in a 400x400 image -> maxX 370
    applyDeltaToSelection({ dx: 500, dy: 0, dw: 0, dh: 0 }, dims);

    const s = useCropStore.getState();
    expect(s.rectsByCluster[A]!.find((r) => r.id === "a2")!.x).toBe(150);
    expect(s.rectsByCluster[B]!.find((r) => r.id === "b1")!.x).toBe(370);
  });

  it("resizes every selected rect with the top-left fixed", () => {
    const { toggleSelect, applyDeltaToSelection } = useCropStore.getState();
    toggleSelect("a1"); // 10,10,40,60
    toggleSelect("b1"); // 20,20,30,30
    applyDeltaToSelection({ dx: 0, dy: 0, dw: 10, dh: -20 }, dims);

    const s = useCropStore.getState();
    expect(s.rectsByCluster[A]!.find((r) => r.id === "a1")).toEqual(rect("a1", 10, 10, 50, 40));
    expect(s.rectsByCluster[B]!.find((r) => r.id === "b1")).toEqual(rect("b1", 20, 20, 40, 10));
  });

  it("never resizes a rect below 1px", () => {
    const { toggleSelect, applyDeltaToSelection } = useCropStore.getState();
    toggleSelect("b1"); // w=30, h=30
    applyDeltaToSelection({ dx: 0, dy: 0, dw: -100, dh: -100 }, dims);

    const b = useCropStore.getState().rectsByCluster[B]!.find((r) => r.id === "b1")!;
    expect(b.w).toBe(1);
    expect(b.h).toBe(1);
  });

  it("is a no-op when nothing is selected", () => {
    const before = useCropStore.getState().rectsByCluster;
    useCropStore.getState().applyDeltaToSelection({ dx: 5, dy: 5, dw: 0, dh: 0 }, dims);
    expect(useCropStore.getState().rectsByCluster).toBe(before);
  });
});

describe("alignSelectedRects", () => {
  const dims = {
    [A]: { imgW: 200, imgH: 200 },
    [B]: { imgW: 400, imgH: 400 },
  };

  it("snaps every selected rect to the reference x/y/w/h", () => {
    const { toggleSelect, alignSelectedRects } = useCropStore.getState();
    toggleSelect("a2");
    toggleSelect("b1");
    // a1 is the reference (under the cursor) but not selected — stays put.
    alignSelectedRects({ x: 10, y: 10, w: 40, h: 60 }, dims);

    const s = useCropStore.getState();
    expect(s.rectsByCluster[A]!.find((r) => r.id === "a1")).toEqual(rect("a1", 10, 10, 40, 60));
    expect(s.rectsByCluster[A]!.find((r) => r.id === "a2")).toEqual(rect("a2", 10, 10, 40, 60));
    expect(s.rectsByCluster[B]!.find((r) => r.id === "b1")).toEqual(rect("b1", 10, 10, 40, 60));
    // Selection is preserved.
    expect([...s.selectedRectIds].sort()).toEqual(["a2", "b1"]);
  });

  it("also snaps the reference rect when it is itself selected", () => {
    const { toggleSelect, alignSelectedRects } = useCropStore.getState();
    toggleSelect("a1");
    toggleSelect("b1");
    alignSelectedRects({ x: 10, y: 10, w: 40, h: 60 }, dims);

    const s = useCropStore.getState();
    expect(s.rectsByCluster[A]!.find((r) => r.id === "a1")).toEqual(rect("a1", 10, 10, 40, 60));
    expect(s.rectsByCluster[B]!.find((r) => r.id === "b1")).toEqual(rect("b1", 10, 10, 40, 60));
  });

  it("clamps each rect into its own cluster image bounds", () => {
    const { toggleSelect, alignSelectedRects } = useCropStore.getState();
    toggleSelect("a2");
    toggleSelect("b1");
    // Reference is larger than cluster A's 200x200 image and starts past both
    // clusters' bottom-right corners (300+150=450), so both must clamp while
    // B (400x400) keeps more room than A.
    alignSelectedRects({ x: 300, y: 300, w: 150, h: 150 }, dims);

    const s = useCropStore.getState();
    // a2: clamped to a 200x200 image -> x=200-150=50, y=50, w=150, h=150.
    expect(s.rectsByCluster[A]!.find((r) => r.id === "a2")).toEqual(rect("a2", 50, 50, 150, 150));
    // b1: 300+150=450 > 400, so it also clamps -> x=400-150=250, y=250.
    expect(s.rectsByCluster[B]!.find((r) => r.id === "b1")).toEqual(rect("b1", 250, 250, 150, 150));
  });

  it("is a no-op when nothing is selected", () => {
    const before = useCropStore.getState().rectsByCluster;
    useCropStore.getState().alignSelectedRects({ x: 1, y: 2, w: 3, h: 4 }, dims);
    expect(useCropStore.getState().rectsByCluster).toBe(before);
  });
});

describe("cropStore copy/paste", () => {
  beforeEach(() => {
    useCropStore.getState().clearAll();
  });

  it("copies every selected rect (clears the clipboard first)", () => {
    useCropStore.setState({
      rectsByCluster: {
        a: [rect("r1", 10, 20, 30, 40), rect("r2", 50, 60, 70, 80)],
        b: [rect("r3", 1, 2, 3, 4)],
      },
      selectedRectIds: new Set(["r2", "r3"]),
      clipboard: [rect("stale", 0, 0, 1, 1)],
    });

    useCropStore.getState().copy();

    // Geometry only (ids dropped), order follows cluster iteration.
    expect(useCropStore.getState().clipboard).toEqual([
      { x: 50, y: 60, w: 70, h: 80 },
      { x: 1, y: 2, w: 3, h: 4 },
    ]);
  });

  it("copy with no selection clears the clipboard", () => {
    useCropStore.setState({
      rectsByCluster: { a: [rect("r1", 1, 2, 3, 4)] },
      selectedRectIds: new Set(),
      clipboard: [rect("stale", 0, 0, 1, 1)],
    });
    useCropStore.getState().copy();
    expect(useCropStore.getState().clipboard).toEqual([]);
  });

  it("pastes copies into the target cluster with fresh ids, starting unselected", () => {
    useCropStore.setState({
      rectsByCluster: { a: [rect("r1", 10, 20, 30, 40)] },
      selectedRectIds: new Set(["r1"]),
      clipboard: [rect("clip-1", 10, 20, 30, 40), rect("clip-2", 100, 200, 5, 6)],
    });

    useCropStore.getState().paste("a");

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
    expect(useCropStore.getState().selectedRectIds.has("r1")).toBe(true);
  });

  it("copies between clusters: copy from one, paste into another", () => {
    useCropStore.setState({
      rectsByCluster: { a: [rect("r1", 11, 22, 33, 44)], b: [] },
      selectedRectIds: new Set(["r1"]),
    });
    useCropStore.getState().copy();

    // Paste into cluster b.
    useCropStore.getState().paste("b");

    const b = useCropStore.getState().rectsByCluster.b!;
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ x: 11, y: 22, w: 33, h: 44 });
  });

  it("paste is a no-op when the clipboard is empty", () => {
    useCropStore.setState({
      rectsByCluster: { a: [rect("r1", 1, 2, 3, 4)] },
      clipboard: [],
    });
    useCropStore.getState().paste("a");
    expect(useCropStore.getState().rectsByCluster.a).toHaveLength(1);
  });
});
