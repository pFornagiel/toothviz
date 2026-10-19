"""UF-1, variant A: portrait page, full text width, flow reads left-to-right in phase rows.

Forward wraps between rows use the right gutter; returns of alternative flows use the
left gutter and the channel above row 1, so no line crosses another.
"""
from uflib import Diagram

d = Diagram("UF-1_upload_scan")
C = [112, 317, 522, 727]
TI = 104                          # band titles start right of the incoming wrap arrow          # column centres
BX, BW = 36, 800                  # band x / width
GY = 806                          # right gutter (forward wraps)
GD, GN = 22, 8                    # left gutters: return to dialog / return to name
TD, TN = 26, 12                   # top channels: to dialog / to name

# ---- 1. open the dialog ---------------------------------------------------
y1, a1 = 105, 185
d.band("1 · Open the dialog", BX, 40, BW, 180, indent=TI)
d.node("start", "terminal", "Start", 72, y1)
d.node("home", "page", "Home page", 192, y1, w=128)
d.node("click", "user", "Click<br>'Load New Scan'", 357, y1, w=136)
d.node("dlg", "popup", "'Load New Scan'<br>dialog", 527, y1, w=140)
d.node("name", "user", "Keep default name<br>or enter own name", 707, y1, w=150)
d.node("cancel", "user", "Click 'Cancel'<br>or close dialog", 357, a1, w=136)
d.edge("start", "home", out="R", inn="L")
d.edge("home", "click", out="R", inn="L")
d.edge("click", "dlg", out="R", inn="L")
d.edge("dlg", "name", out="R", inn="L")
d.edge("dlg", "cancel", "AF-4", out="B", inn="R", pts=[(527, a1)])
d.edge("cancel", "home", out="L", inn="B", pts=[(192, a1)])

# ---- 2. provide input files ----------------------------------------------
y2, a2 = 320, 415
d.band("2 · Provide input files", BX, 236, BW, 228, indent=TI)
d.node("base", "question", "Base image<br>source?", C[0], y2, w=140)
d.node("file", "external", "Drag &amp; drop or<br>browse for file", C[1], y2)
d.node("seg", "question", "Segmentation<br>pipeline?", C[2], y2, w=156)
d.node("mask", "external", "Drag &amp; drop or<br>browse for mask", C[2], a2)
d.node("req", "question", "Required<br>inputs<br>provided?", C[3], y2, w=140, h=100)
d.node("keep", "system", "Keep 'Create'<br>disabled", C[3], a2)
d.edge("name", "base", out="B", inn="T", pts=[(707, 228), (C[0], 228)])
d.edge("base", "file", "NIfTI file /<br>DICOM dir", out="R", inn="L", lpos=-0.35, loff=(0, -26))
d.edge("file", "seg", out="R", inn="L")
d.edge("seg", "mask", "Pre-computed mask", out="B", inn="T")
d.edge("seg", "req", "None /<br>Automated DL", out="R", inn="L", loff=(0, -26))
d.edge("mask", "req", out="R", inn="L", pts=[(624, a2), (624, y2)])
d.edge("req", "keep", "No (AF-2)", out="B", inn="T")

# ---- 3. create and validate ----------------------------------------------
y3, a3 = 548, 640
d.band("3 · Create and validate", BX, 480, BW, 220, indent=TI)
d.node("create", "user", "Click 'Create'", C[0], y3)
d.node("valid", "question", "Files<br>valid?", C[1], y3, w=130)
d.node("verr", "popup", "Validation error,<br>creation aborted", C[1], a3, w=156)
d.node("uniq", "question", "Name<br>unique?", C[2], y3, w=130)
d.node("conf", "popup", "Name conflict,<br>scan not created", C[2], a3, w=156)
d.node("store", "system", "Create scan and<br>store data locally", C[3], y3, w=150)
d.edge("req", "create", "Yes", out="R", inn="T", pts=[(GY, y2), (GY, 472), (C[0], 472)], lpos=-0.9)
d.edge("create", "valid", out="R", inn="L")
d.edge("valid", "verr", "No (AF-1)", out="B", inn="T")
d.edge("valid", "uniq", "Yes", out="R", inn="L")
d.edge("uniq", "conf", "No (AF-3)", out="B", inn="T")
d.edge("uniq", "store", "Yes", out="R", inn="L")

# ---- returns of alternative flows (left gutter + top channel) -------------
d.edge("keep", "dlg", out="B", inn="T", pts=[(C[3], 455), (GD, 455), (GD, TD), (527, TD)])
d.edge("verr", "dlg", out="L", inn="T", pts=[(GD, a3), (GD, TD), (527, TD)])
d.edge("conf", "name", out="B", inn="T", pts=[(C[2], 694), (GN, 694), (GN, TN), (707, TN)])

# ---- 4. hand over to processing ------------------------------------------
y4 = 785
d.band("4 · Hand over to processing", BX, 716, BW, 140, indent=TI)
d.node("pipe", "question", "Pipeline<br>selected?", C[0], y4)
d.node("startp", "system", "Start processing<br>pipeline", C[1], y4)
d.node("proc", "page", "Processing page", C[2], y4)
d.node("end", "terminal", "End", C[3], y4)
d.edge("store", "pipe", out="B", inn="T", pts=[(C[3], 708), (C[0], 708)])
d.edge("pipe", "startp", "Yes", out="R", inn="L")
d.edge("pipe", "proc", "No", out="B", inn="B", pts=[(C[0], 843), (C[2], 843)], lpos=-0.2)
d.edge("startp", "proc", out="R", inn="L")
d.edge("proc", "end", out="R", inn="L")

d.save("UF-1_upload_scan_A.drawio")
