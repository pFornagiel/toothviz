"""UF-3, variant A: portrait page, full text width, phase rows read left-to-right."""
from uflib import Diagram

d = Diagram("UF-3_view_scan")
C = [112, 317, 522, 727]
BX, BW, TI = 36, 800, 104
GY = 812                         # right gutter: ready scans go straight to loading
GE, TE = 16, 22                  # left gutter / top channel: error returns to browse page

# ---- 1. open the scan -----------------------------------------------------
y1 = 100
d.band("1 · Open the scan", BX, 40, BW, 120, indent=TI)
d.node("start", "terminal", "Start", 72, y1)
d.node("browse", "page", "Browse page", 220, y1)
d.node("open", "user", "Open scan", 420, y1)
d.node("status", "question", "Scan<br>status?", 640, y1, w=130, h=80)
d.edge("start", "browse", out="R", inn="L")
d.edge("browse", "open", out="R", inn="L")
d.edge("open", "status", out="R", inn="L")

# ---- 2. scan still processing (AF-2) --------------------------------------
y2, a2 = 245, 330
d.band("2 · Scan still processing (AF-2)", BX, 176, BW, 196, indent=TI)
d.node("proc", "page", "Processing page", C[0], y2, w=150)
d.node("avail", "question", "Volume<br>preview<br>available?", C[1], y2, w=150, h=96)
d.node("prev", "question", "Open<br>preview?", C[2], y2, w=130)
d.node("wait", "user", "Wait for<br>pipeline", C[3], y2, w=130)
d.edge("status", "proc", "Processing (AF-2)", out="B", inn="T", pts=[(640, 168), (C[0], 168)], lpos=-0.75)
d.edge("proc", "avail", out="R", inn="L")
d.edge("avail", "prev", "Yes", out="R", inn="L")
d.edge("prev", "wait", "No", out="R", inn="L")
d.edge("avail", "wait", "No", out="B", inn="B", pts=[(C[1], a2 + 20), (C[3], a2 + 20)], lpos=-0.5)
d.edge("wait", "status", out="T", inn=(0.8, 0.7), pts=[(C[3], 116)])

# ---- 3. load the volume ---------------------------------------------------
y3, a3 = 455, 545
d.band("3 · Load the volume", BX, 388, BW, 200, indent=TI)
d.node("load", "system", "Load volumetric<br>data", C[0], y3)
d.node("loaded", "question", "Loaded<br>successfully?", C[1], y3, w=150)
d.node("viewer", "page", "Viewer page", C[2], y3)
d.node("err", "popup", "Error message", C[1], a3, w=150, h=52)
d.edge("status", "load", "Ready / Failed /<br>Cancelled", out="R", inn="T",
       pts=[(GY, y1), (GY, 380), (C[0], 380)], lpos=-0.9, loff=(0, -20))
d.edge("prev", "load", "Yes", out="B", inn="T", pts=[(C[2], 380), (C[0], 380)], lpos=-0.9)
d.edge("load", "loaded", out="R", inn="L")
d.edge("loaded", "viewer", "Yes", out="R", inn="L")
d.edge("loaded", "err", "No (AF-1)", out="B", inn="T")
d.edge("err", "browse", out="L", inn="T", pts=[(GE, a3), (GE, TE), (220, TE)])

# ---- 4. inspect the volume ------------------------------------------------
y4, a4 = 680, 775
P = [114, 276, 438, 600, 758]
d.band("4 · Inspect the volume", BX, 604, BW, 236, indent=TI)
d.node("scroll", "user", "Scroll slices /<br>rotate, zoom 3D", P[0], y4, w=140)
d.node("update", "system", "Update view<br>in real time", P[1], y4, w=124)
d.node("dbl", "question", "Double-click<br>viewport?", P[2], y4, w=150)
d.node("eval", "user", "Evaluate<br>anatomical<br>structures", P[3], y4, w=124, h=64)
d.node("cont", "question", "Continue<br>inspection?", P[4], y4, w=140)
d.node("focus", "system", "Focus single<br>viewport", P[2], a4)
d.node("end", "terminal", "End", P[4], a4)
d.edge("viewer", "scroll", out="B", inn="T", pts=[(C[2], 596), (P[0], 596)])
d.edge("scroll", "update", out="R", inn="L")
d.edge("update", "dbl", out="R", inn="L")
d.edge("dbl", "eval", "No", out="R", inn="L")
d.edge("dbl", "focus", "Yes", out="B", inn="T")
d.edge("focus", "scroll", out="L", inn="B", pts=[(P[0], a4)])
d.edge("eval", "cont", out="R", inn="L")
d.edge("cont", "end", "No", out="B", inn="T")
d.edge("cont", "scroll", "Yes", out="T", inn="T", pts=[(P[4], 596), (P[0], 596)], lpos=-0.93)

d.save("UF-3_view_scan_A.drawio")
