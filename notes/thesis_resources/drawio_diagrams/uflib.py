"""Tiny generator for the user-flow diagrams (draw.io XML).

Node styles are copied from UF_legend.drawio so the notation stays identical;
only layout, font size and edge routing (orthogonal instead of curved) change.
"""
from xml.sax.saxutils import escape

FONT = "fontFamily=Roboto Mono;fontSource=https%3A%2F%2Ffonts.googleapis.com%2Fcss%3Ffamily%3DRoboto%2BMono;"
NAVY, SLATE, RED, ORANGE, TEAL = "#1F2547", "#2D3450", "#E8004A", "#FBA020", "#7FD8CB"

KINDS = {
    "terminal": f"ellipse;aspect=fixed;fillColor={NAVY};strokeColor=none;fontColor=#FFFFFF;",
    "user":     f"rounded=1;arcSize=20;fillColor={RED};strokeColor=none;fontColor=#FFFFFF;",
    "external": f"rounded=1;arcSize=20;fillColor=#FFFFFF;strokeColor={SLATE};strokeWidth=3;dashed=1;dashPattern=1 1;fontColor={SLATE};",
    "system":   f"rounded=1;arcSize=20;fillColor={SLATE};strokeColor=none;fontColor=#FFFFFF;",
    "question": f"rhombus;fillColor={TEAL};strokeColor=none;fontColor={NAVY};",
    "page":     f"rounded=0;fillColor={ORANGE};strokeColor=none;fontColor={NAVY};",
    "popup":    f"shape=callout;perimeter=calloutPerimeter;rounded=1;arcSize=15;size=11;position=0.12;position2=0.12;base=14;fillColor={ORANGE};strokeColor=none;fontColor={NAVY};spacingBottom=11;",
    "link":     f"rounded=1;arcSize=20;fillColor=#FFFFFF;strokeColor={NAVY};strokeWidth=2;fontColor={NAVY};",
}
DEFAULT_SIZE = {
    "terminal": (56, 56), "question": (150, 84), "popup": (150, 64),
}
SIDES = {"L": (0, 0.5), "R": (1, 0.5), "T": (0.5, 0), "B": (0.5, 1)}


class Diagram:
    def __init__(self, name, font=13, edge_font=12, box=(140, 52)):
        self.name, self.font, self.edge_font, self.box = name, font, edge_font, box
        self.cells, self.nodes, self.mid, self._n = [], {}, {}, 0

    def _id(self, p):
        self._n += 1
        return f"{p}{self._n}"

    def node(self, nid, kind, label, cx, cy, w=None, h=None):
        dw, dh = DEFAULT_SIZE.get(kind, self.box)
        w, h = w or dw, h or dh
        mid = 0.5
        if kind == "popup":  # callout tail hangs below: centre the body (h - 11) on the row
            y = cy - (h - 11) / 2
            mid = (h - 11) / 2 / h
        else:
            y = cy - h / 2
        x = cx - w / 2
        style = KINDS[kind] + FONT + f"fontSize={self.font};whiteSpace=wrap;html=1;"
        self.nodes[nid] = (x, y, w, h)
        self.mid[nid] = mid
        self.cells.append(
            f'<mxCell id="{nid}" value="{escape(label, {chr(34): "&quot;"})}" style="{style}" vertex="1" parent="1">'
            f'<mxGeometry x="{x:.1f}" y="{y:.1f}" width="{w}" height="{h}" as="geometry"/></mxCell>')
        if kind == "link":  # the small north-east arrow in the corner
            ax, ay = x + w - 9, y + 7
            self.cells.append(
                f'<mxCell id="{nid}_ic" style="endArrow=open;endSize=4;startArrow=none;strokeColor={NAVY};strokeWidth=1.6;html=1;" edge="1" parent="1">'
                f'<mxGeometry relative="1" as="geometry"><mxPoint x="{ax - 9}" y="{ay + 9}" as="sourcePoint"/>'
                f'<mxPoint x="{ax}" y="{ay}" as="targetPoint"/></mxGeometry></mxCell>')
        return nid

    def edge(self, src, tgt, label="", out=None, inn=None, pts=(), lpos=0.0, loff=(0, 0), lalign=None):
        """out/inn: side letters L/R/T/B or (fx, fy). pts: absolute waypoints.
        lpos: label position along the edge (-1..1); loff: label offset (dx, dy)."""
        s = (f"edgeStyle=orthogonalEdgeStyle;rounded=1;arcSize=12;jettySize=14;jumpStyle=arc;jumpSize=8;endArrow=block;endFill=1;endSize=6;"
             f"strokeColor={SLATE};strokeWidth=1.3;fontColor={SLATE};labelBackgroundColor=#F2F3F7;"
             + FONT + f"fontSize={self.edge_font};html=1;")
        for key, v, n in (("exit", out, src), ("entry", inn, tgt)):
            if v:
                fx, fy = SIDES[v] if isinstance(v, str) else v
                if v in ("L", "R"):
                    fy = round(self.mid[n], 3)
                s += f"{key}X={fx};{key}Y={fy};{key}Dx=0;{key}Dy=0;"
        if lalign:
            s += f"align={lalign};"
        p = "".join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in pts)
        p = f'<Array as="points">{p}</Array>' if pts else ""
        off = f'<mxPoint x="{loff[0]}" y="{loff[1]}" as="offset"/>' if loff != (0, 0) else ""
        self.cells.append(
            f'<mxCell id="{self._id("e")}" value="{escape(label)}" style="{s}" edge="1" parent="1" source="{src}" target="{tgt}">'
            f'<mxGeometry x="{lpos}" relative="1" as="geometry">{p}{off}</mxGeometry></mxCell>')

    def band(self, title, x, y, w, h, indent=10):
        """Light background strip naming a phase of the flow (drawn behind everything)."""
        self.cells.insert(0,
            f'<mxCell id="{self._id("b")}" value="{escape(title)}" style="rounded=1;arcSize=4;absoluteArcSize=0;fillColor=#F2F3F7;strokeColor=none;'
            f'fontColor={SLATE};fontStyle=1;align=left;verticalAlign=top;spacingLeft={indent};spacingTop=4;' + FONT +
            f'fontSize={self.edge_font};whiteSpace=wrap;html=1;" vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')

    def save(self, path):
        with open(path, "w") as f:
            f.write(f'<mxfile host="app.diagrams.net"><diagram name="{self.name}"><mxGraphModel grid="1" gridSize="10" page="0">'
                    f'<root><mxCell id="0"/><mxCell id="1" parent="0"/>{"".join(self.cells)}</root></mxGraphModel></diagram></mxfile>\n')
