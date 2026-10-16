"""UF-6, variant A: portrait page, full text width, phase rows read left-to-right."""
from uflib import Diagram

d = Diagram("UF-6_automatic_segmentation")
C = [112, 317, 522, 727]
BX, BW, TI = 36, 800, 104
GN, TN = 14, 22                  # left gutter / top channel for the retry loop

# ---- 1. start processing --------------------------------------------------
y1 = 100
d.band("1 · Start processing", BX, 40, BW, 120, indent=TI)
d.node("start", "terminal", "Start", 72, y1)
d.node("uc1", "link", "UC-1<br>Upload CBCT Scan", 245, y1, w=160)
d.node("startp", "system", "Start local<br>processing pipeline", 470, y1, w=170)
d.node("proc", "page", "Processing page", 700, y1, w=150)
d.edge("start", "uc1", out="R", inn="L")
d.edge("uc1", "startp", out="R", inn="L")
d.edge("startp", "proc", out="R", inn="L")

# ---- 2. segment the scan --------------------------------------------------
y2, a2 = 245, 345
d.band("2 · Segment the scan", BX, 176, BW, 214, indent=TI)
d.node("act", "question", "Dentist<br>action?", C[0], y2, w=140)
d.node("uc3", "link", "UC-3<br>View CBCT Scan", C[1], a2, w=150)
d.node("run", "system", "Run local<br>segmentation model", C[1], y2, w=160)
d.node("ok", "question", "Processing<br>successful?", C[2], y2, w=150)
d.node("store", "system", "Store segmentation<br>artifacts", C[3], y2, w=160)
d.node("err", "popup", "Error message,<br>status: Failed", C[2], a2, w=150)
d.edge("proc", "act", out="B", inn="T", pts=[(700, 168), (C[0], 168)])
d.edge("act", "run", "Wait", out="R", inn="L")
d.edge("act", "uc3", "Preview<br>volume", out=(0.75, 0.75), inn="L", pts=[(C[0] + 35, a2)], lpos=0.5)
d.edge("uc3", "run", out="T", inn="B")
d.edge("run", "ok", out="R", inn="L")
d.edge("ok", "store", "Yes", out="R", inn="L")
d.edge("ok", "err", "No (AF-1)", out="B", inn="T")

# ---- 3. finish or retry ---------------------------------------------------
y3, a3 = 475, 565
d.band("3 · Finish or retry", BX, 406, BW, 200, indent=TI)
d.node("stop", "system", "Stop pipeline,<br>status: Cancelled", C[0], y3, w=160)
d.node("retry", "question", "Retry<br>job?", C[1], y3, w=120)
d.node("end", "terminal", "End", C[2], y3)
d.node("ready", "system", "Set status:<br>Ready", C[3], y3)
d.node("uc7", "link", "UC-7 Visualize<br>Segmentation Results", C[3], a3, w=180, h=56)
d.edge("act", "stop", "Cancel (AF-2)", out="B", inn="T", lpos=-0.55)
d.edge("stop", "retry", out="R", inn="L")
d.edge("err", "retry", out="B", inn="T", pts=[(C[2], 398), (C[1], 398)])
d.edge("retry", "end", "No", out="R", inn="L")
d.edge("retry", "startp", "Yes", out="B", inn="T",
       pts=[(C[1], 600), (GN, 600), (GN, TN), (470, TN)], lpos=-0.95)
d.edge("store", "ready", out="B", inn="T")
d.edge("ready", "uc7", out="B", inn="T")

d.save("UF-6_automatic_segmentation_A.drawio")
