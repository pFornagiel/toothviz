"""UF-7, variant A: portrait page, full text width, phase rows read left-to-right.

The two 'segmentation unavailable' branches (AF-1, AF-2) get their own band at the
bottom, so the main path (bands 1-3) is not interrupted by them.
"""
from uflib import Diagram

d = Diagram("UF-7_segmentation_results")
C = [112, 317, 522, 727]
BX, BW, TI = 36, 800, 126
GA2 = 852                        # outer right gutter: Failed (AF-2) -> band 4
GA1 = 20                         # left gutter: no mask (AF-1) -> band 4

# ---- 1. open the scan -----------------------------------------------------
y1 = 80
d.band("1 · Open the scan", BX, 20, BW, 120, indent=TI)
d.node("start", "terminal", "Start", 72, y1)
d.node("browse", "page", "Browse page", 220, y1)
d.node("open", "user", "Open scan", 420, y1)
d.node("status", "question", "Scan<br>status?", 640, y1, w=130, h=80)
d.edge("start", "browse", out="R", inn="L")
d.edge("browse", "open", out="R", inn="L")
d.edge("open", "status", out="R", inn="L")

# ---- 2. display the segmentation -----------------------------------------
y2 = 222
d.band("2 · Display the segmentation", BX, 156, BW, 120, indent=TI)
d.node("mask", "question", "Mask<br>present?", 140, y2, w=130)
d.node("loadm", "system", "Load volume<br>and mask", 332, y2)
d.node("view1", "page", "Viewer page", C[2], y2)
d.node("overlay", "system", "Overlay segmentation<br>on volume", C[3], y2, w=172)
d.edge("status", "mask", "Ready", out="B", inn="T", pts=[(640, 148), (140, 148)], lpos=-0.8)
d.edge("mask", "loadm", "Yes", out="R", inn="L")
d.edge("loadm", "view1", out="R", inn="L")
d.edge("view1", "overlay", out="R", inn="L")

# ---- 3. explore the teeth -------------------------------------------------
y3, b3 = 368, 462
P = [112, 274, 436, 598, 748]
GC = 822                         # inner right gutter: 'Center on tooth' loop
d.band("3 · Explore the teeth", BX, 292, BW, 252, indent=TI)
d.node("labels", "system", "Show tooth labels<br>in legend", P[0], y3, w=148)
d.node("select", "user", "Select teeth<br>(legend or<br>viewport)", P[1], y3, w=124, h=64)
d.node("upd", "system", "Update displayed<br>segmentation", P[2], y3, w=140)
d.node("eval", "user", "Evaluate<br>results", P[3], y3, w=110)
d.node("next", "question", "Next<br>action?", P[4], y3, w=120)
d.node("center", "system", "Center view on<br>selected tooth", P[2], b3, w=140)
d.node("toggle", "user", "Toggle volume /<br>segmentation", P[3], b3, w=140)
d.node("end1", "terminal", "End", P[4], b3)
d.edge("overlay", "labels", out="B", inn="T", pts=[(C[3], 284), (P[0], 284)])
d.edge("labels", "select", out="R", inn="L")
d.edge("select", "upd", out="R", inn="L")
d.edge("upd", "eval", out="R", inn="L")
d.edge("eval", "next", out="R", inn="L")
d.edge("next", "select", "Change selection", out="T", inn="T", pts=[(P[4], 320), (P[1], 320)], lpos=-0.35)
d.edge("next", "end1", "Done", out="B", inn="T")
d.edge("next", "toggle", "Toggle<br>visibility", out=(0.15, 0.65), inn="R", pts=[(P[4] - 42, b3)], lpos=-0.3, loff=(-42, 0))
d.edge("toggle", "eval", out="T", inn="B")
d.edge("next", "center", "Center on tooth", out="R", inn="B", pts=[(GC, y3), (GC, 520), (P[2], 520)], lpos=0.3)
d.edge("center", "eval", out=(0.85, 0), inn="B", pts=[(P[2] + 49, 422), (P[3], 422)])

# ---- 4. segmentation unavailable (AF-1, AF-2) ----------------------------
y4, b4, c4 = 640, 750, 850
d.band("4 · Segmentation unavailable (AF-1, AF-2)", BX, 562, BW, 330, indent=TI)
d.node("orig2", "system", "Load original<br>volume", C[0], y4)
d.node("view2", "page", "Viewer page", C[1], y4)
d.node("notice", "system", "Show 'segmentation<br>unavailable' notice", C[2], y4, w=176)
d.node("src", "question", "Source<br>image<br>available?", C[3], y4, w=140, h=96)
d.node("orig1", "system", "Load original<br>volume", C[0], b4)
d.node("view1b", "page", "Viewer page", C[1], b4)
d.node("end2", "terminal", "End", C[2], b4)
d.node("retry", "question", "Retry<br>segmen-<br>tation?", C[3], b4, w=130, h=90)
d.node("uc6", "link", "UC-6 Perform Automatic<br>Tooth Segmentation", C[3], c4, w=214, h=56)
d.edge("status", "orig2", "Failed (AF-2)", out="R", inn="T",
       pts=[(GA2, y1), (GA2, 554), (C[0], 554)], lpos=-0.9, loff=(0, -14))
d.edge("mask", "orig1", "No (AF-1)", out="L", inn="L", pts=[(GA1, y2), (GA1, b4)], lpos=-0.975, loff=(0, -14))
d.edge("orig2", "view2", out="R", inn="L")
d.edge("view2", "notice", out="R", inn="L")
d.edge("notice", "src", out="R", inn="L")
d.edge("src", "retry", "Yes", out="B", inn="T")
d.edge("src", "end2", "No", out=(0.25, 0.75), inn="T", pts=[(C[3] - 35, 705), (C[2], 705)], lpos=0.0)
d.edge("orig1", "view1b", out="R", inn="L")
d.edge("view1b", "end2", out="R", inn="L")
d.edge("retry", "end2", "No", out="L", inn="R")
d.edge("retry", "uc6", "Yes", out="B", inn="T")

d.save("UF-7_segmentation_results_A.drawio")
